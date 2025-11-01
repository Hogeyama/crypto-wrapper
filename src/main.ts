#!/usr/bin/env -S deno run -A

import { Command } from "@cliffy/command";
import { bold } from "@std/fmt/colors";
import { CommandBuilder } from "@david/dax";

import {
  getEnvInjectors,
  getGocryptfsInjectors,
  listProfileNames,
  loadProfile,
} from "./profile.ts";
import { isMounted, mountProfile, unmountProfile } from "./mount.ts";
import { expandPath } from "./path_utils.ts";
import { readPassEntry } from "./pass.ts";

const VERSION = "0.1.0";

function printListTable(
  rows: Array<{
    name: string;
    mounted: boolean;
    mountDir?: string;
    error?: string;
  }>,
): void {
  const headers = ["PROFILE", "STATUS", "MOUNT"];
  console.log(headers.join("  "));
  for (const row of rows) {
    const status = row.error ? "error" : row.mounted ? "mounted" : "unmounted";
    const mountInfo = row.error ? row.error : (row.mountDir ?? "-");
    console.log(`${row.name}  ${status}  ${mountInfo}`);
  }
}

const program = new Command()
  .name("cryptow")
  .version(VERSION)
  .description(
    "Secure wrapper around CLI tools using gocryptfs-mounted storage.",
  )
  .throwErrors();

program
  .command("list")
  .description("List configured profiles and mount status.")
  .option("--json", "Output JSON")
  .action(async ({ json }) => {
    const names = await listProfileNames();
    const rows: Array<{
      name: string;
      mounted: boolean;
      mountDir?: string;
      error?: string;
    }> = [];

    for (const name of names) {
      try {
        const profile = await loadProfile(name);
        const mounted = await isMounted(name);
        const gocMounts = getGocryptfsInjectors(profile).map(
          (injector) => injector.mountDir,
        );
        rows.push({
          name,
          mounted,
          mountDir: gocMounts.length === 0 ? undefined : gocMounts.join(", "),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({ name, mounted: false, error: message });
      }
    }

    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log(
        "No profiles found. Define profiles in ~/.config/cryptow/profiles.yaml.",
      );
      return;
    }

    printListTable(rows);
  });

program
  .command("mount <profile:string>")
  .description(
    "Mount the encrypted store for a profile without executing its command.",
  )
  .option("--dry-run", "Describe actions without executing.")
  .option("--force", "Ignore stale locks.")
  .action(async ({ dryRun = false, force = false }, profileName: string) => {
    const profile = await loadProfile(profileName);
    await mountProfile(profile, { dryRun, force });
  });

program
  .command("unmount <profile:string>")
  .description("Unmount the encrypted store for a profile.")
  .option("--dry-run", "Describe actions without executing.")
  .option("--force", "Remove stale state if needed.")
  .action(async ({ dryRun = false, force = false }, profileName: string) => {
    const profile = await loadProfile(profileName);
    await unmountProfile(profile, { dryRun, force });
  });

program
  .command("run", "Mount, execute the profile's command, and unmount afterwards.")
  .option("--dry-run", "Describe actions without executing.")
  .option("--force", "Ignore stale locks when mounting.")
  .arguments("<profile:string> [...cmdArgs:string]")
  .action(
    async function (
      this,
      { dryRun = false, force = false },
      profileName: string,
      ...cmdArgs: string[]
    ) {
      const literalArgs = this.getLiteralArgs();
      const forwardedArgs = [...cmdArgs, ...literalArgs];
      const profile = await loadProfile(profileName);
      const combinedArgs = [...profile.command, ...forwardedArgs];

      const envOverrides: Record<string, string> = {
        ...profile.env,
        CRYPTOW_PROFILE: profile.name,
      };

      const gocryptfsInjectors = getGocryptfsInjectors(profile);
      if (gocryptfsInjectors.length > 0) {
        const primary = gocryptfsInjectors[0];
        envOverrides.CRYPTOW_MOUNT = primary.mountDir;
        envOverrides.CRYPTOW_CIPHER = primary.cipherDir;
      }

      const envInjectors = getEnvInjectors(profile);

      if (dryRun) {
        await mountProfile(profile, { dryRun: true, force });
        console.log(`[dry-run] Would run command: ${combinedArgs.join(" ")}`);
        if (Object.keys(envOverrides).length > 0) {
          const dryRunEnv = { ...envOverrides };
          for (const injector of envInjectors) {
            dryRunEnv[injector.envVar] = `<pass:${injector.passwordEntry}>`;
          }
          console.log("[dry-run] Environment overrides:");
          for (const [key, value] of Object.entries(dryRunEnv)) {
            console.log(`  ${key}=${value}`);
          }
        }
        if (profile.workingDir) {
          console.log(
            `[dry-run] Working directory: ${expandPath(profile.workingDir)}`,
          );
        }
        return;
      }

      let mounted = false;
      let exitCode = 0;
      try {
        await mountProfile(profile, { force });
        mounted = true;

        for (const injector of envInjectors) {
          const secret = await readPassEntry(injector.passwordEntry);
          envOverrides[injector.envVar] = secret;
        }

        const [binary, ...args] = combinedArgs;
        if (!binary) {
          throw new Error(
            "No command specified after resolving profile and arguments.",
          );
        }

        let builder: CommandBuilder = new CommandBuilder()
          .command([binary, ...args])
          .stdin("inherit")
          .stdout("inherit")
          .stderr("inherit");

        for (const [key, value] of Object.entries(envOverrides)) {
          builder = builder.env(key, value);
        }

        if (profile.workingDir) {
          builder = builder.cwd(expandPath(profile.workingDir));
        }

        const result = await builder.noThrow();
        exitCode = result.code ?? 0;
        if (exitCode !== 0) {
          console.error(bold(`Command exited with code ${exitCode}`));
        }
      } catch (error) {
        exitCode = exitCode || 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(bold(`Error: ${message}`));
      } finally {
        if (mounted) {
          try {
            await unmountProfile(profile, { force: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
              bold(`Failed to unmount profile '${profile.name}': ${message}`),
            );
            exitCode = exitCode === 0 ? 1 : exitCode;
          }
        }
      }

      if (exitCode !== 0) {
        Deno.exit(exitCode);
      }
    },
  );

if (import.meta.main) {
  await program.parse(Deno.args);
}

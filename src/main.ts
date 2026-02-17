#!/usr/bin/env -S deno run -A

import { Command } from "@cliffy/command";
import { bold } from "@std/fmt/colors";
import { CommandBuilder, type Delay } from "@david/dax";
import {
  getEnvInjectors,
  getGocryptfsInjectors,
  listProfileNames,
  loadProfile,
} from "./profile.ts";
import {
  areMountPointsActive,
  assertGocryptfsInitialized,
  initProfile,
  mountProfile,
  unmountProfile,
} from "./mount.ts";
import { expandPath } from "./path_utils.ts";
import { readPassEntry } from "./pass.ts";

const VERSION = "0.1.0";

function isDelay(value: unknown): value is Delay {
  return typeof value === "string" && /^\d+(?:h(?:\d+m(?:\d+s)?)?|m(?:\d+s)?|s|ms)?$/.test(value);
}

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
        const gocMounts = getGocryptfsInjectors(profile).map(
          (injector) => injector.mountDir,
        );
        const mounted = await areMountPointsActive(gocMounts);
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
  .command("init <profile:string>")
  .description("Initialize gocryptfs cipher store(s) for a profile.")
  .option("--dry-run", "Describe actions without executing.")
  .option(
    "--gen-pass",
    "Generate pass entry before initializing gocryptfs.",
  )
  .action(async ({ dryRun = false, genPass = false }, profileName: string) => {
    const profile = await loadProfile(profileName);
    await initProfile(profile, { dryRun, genPass });
  });

program
  .command("mount <profile:string>")
  .description(
    "Mount the encrypted store for a profile without executing its command.",
  )
  .option("--dry-run", "Describe actions without executing.")
  .action(async ({ dryRun = false }, profileName: string) => {
    const profile = await loadProfile(profileName);
    await mountProfile(profile, { dryRun });
  });

program
  .command("unmount <profile:string>")
  .description("Unmount the encrypted store for a profile.")
  .option("--dry-run", "Describe actions without executing.")
  .action(async ({ dryRun = false }, profileName: string) => {
    const profile = await loadProfile(profileName);
    await unmountProfile(profile, { dryRun });
  });

program
  .command("run", "Mount, execute the profile's command, and unmount afterwards.")
  .option("--dry-run", "Describe actions without executing.")
  .option(
    "--timeout <duration:string>",
    "Kill command after specified duration (e.g., 30s, 5m, 1h).",
  )
  .arguments("<profile:string> [...cmdArgs:string]")
  .action(
    async function (
      this,
      { dryRun = false, timeout: rawTimeout },
      profileName: string,
      ...cmdArgs: string[]
    ) {
      const timeout = isDelay(rawTimeout) ? rawTimeout : undefined;
      const literalArgs = this.getLiteralArgs();
      const forwardedArgs = [...cmdArgs, ...literalArgs];
      const profile = await loadProfile(profileName);
      const combinedArgs = [...profile.command, ...forwardedArgs];

      const envOverrides: Record<string, string> = {
        ...profile.env,
        CRYPTOW_PROFILE: profile.name,
      };

      const gocryptfsInjectors = getGocryptfsInjectors(profile);
      const envInjectors = getEnvInjectors(profile);

      const mountDirs = gocryptfsInjectors.map((injector) => injector.mountDir);
      const alreadyMounted = await areMountPointsActive(mountDirs);

      if (dryRun) {
        if (alreadyMounted) {
          console.log(
            `[dry-run] Would reuse existing mount for profile '${profile.name}'.`,
          );
        } else {
          await mountProfile(profile, { dryRun: true });
        }
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
        if (timeout) {
          console.log(`[dry-run] Timeout: ${timeout}`);
        }
        if (profile.workingDir) {
          console.log(
            `[dry-run] Working directory: ${expandPath(profile.workingDir)}`,
          );
        }
        return;
      }

      await assertGocryptfsInitialized(profile);

      let mounted = false;
      let exitCode = 0;
      try {
        if (alreadyMounted) {
          console.log(
            `Profile '${profile.name}' is already mounted; reusing existing mount.`,
          );
        } else {
          await mountProfile(profile);
          mounted = true;
        }

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

        if (timeout) {
          builder = builder.timeout(timeout);
        }

        const result = await builder.noThrow();
        exitCode = result.code ?? 0;
        if (exitCode === 124 && timeout) {
          console.error(bold(`Command timed out after ${timeout}`));
        } else if (exitCode !== 0) {
          console.error(bold(`Command exited with code ${exitCode}`));
        }
      } catch (error) {
        exitCode = exitCode || 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(bold(`Error: ${message}`));
      } finally {
        if (mounted) {
          try {
            await unmountProfile(profile);
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

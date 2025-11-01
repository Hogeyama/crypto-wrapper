import { ensureDir } from "@std/fs/ensure-dir";
import { exists } from "@std/fs/exists";
import { dirname } from "@std/path";
import $ from "@david/dax";
import { logMessage } from "./logger.ts";
import { getGocryptfsInjectors, GocryptfsInjector, Profile } from "./profile.ts";
import { readPassEntry } from "./pass.ts";
import { lockFilePath, pidFilePath } from "./paths.ts";

export interface MountOptions {
  dryRun?: boolean;
  force?: boolean;
}

export interface UnmountOptions {
  dryRun?: boolean;
  force?: boolean;
}

async function acquireLock(
  profileName: string,
  force: boolean,
  dryRun: boolean,
): Promise<void> {
  const lockPath = lockFilePath(profileName);
  if (dryRun) {
    const existsNow = await exists(lockPath);
    if (existsNow && !force) {
      throw new Error(
        `Profile '${profileName}' appears mounted (lock exists). Use --force to override.`,
      );
    }
    return;
  }

  if (await exists(lockPath)) {
    if (!force) {
      throw new Error(
        `Profile '${profileName}' appears mounted (lock exists). Use --force to override.`,
      );
    }
    await Deno.remove(lockPath);
  }

  await ensureDir(dirname(lockPath));
  const file = await Deno.open(lockPath, { write: true, createNew: true });
  file.close();
}

async function writePidFile(
  profileName: string,
  dryRun: boolean,
): Promise<void> {
  const pidPath = pidFilePath(profileName);
  if (dryRun) {
    return;
  }
  await ensureDir(dirname(pidPath));
  const payload = JSON.stringify({
    pid: Deno.pid,
    started_at: new Date().toISOString(),
  }) + "\n";
  await Deno.writeTextFile(pidPath, payload, { create: true, append: false });
}

async function cleanupState(
  profileName: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    return;
  }
  const lockPath = lockFilePath(profileName);
  const pidPath = pidFilePath(profileName);
  if (await exists(pidPath)) {
    await Deno.remove(pidPath);
  }
  if (await exists(lockPath)) {
    await Deno.remove(lockPath);
  }
}

export async function isMounted(profileName: string): Promise<boolean> {
  return await exists(lockFilePath(profileName));
}

export async function mountProfile(
  profile: Profile,
  options: MountOptions = {},
): Promise<void> {
  const { dryRun = false, force = false } = options;

  await acquireLock(profile.name, force, dryRun);
  const gocryptfsInjectors = getGocryptfsInjectors(profile);
  const infoLines = [`Mounting profile '${profile.name}'`];

  if (gocryptfsInjectors.length === 0) {
    infoLines.push(" no gocryptfs injectors configured; nothing to mount.");
  } else {
    for (const injector of gocryptfsInjectors) {
      infoLines.push(
        ` gocryptfs -> ${injector.mountDir} (cipher: ${injector.cipherDir}, pass: ${injector.passwordEntry})`,
      );
    }
  }

  if (dryRun) {
    infoLines.push(" [dry-run] No commands executed");
    for (const line of infoLines) {
      console.log(line);
    }
    return;
  }

  const mountedInjectors: GocryptfsInjector[] = [];

  try {
    await writePidFile(profile.name, false);

    for (const injector of gocryptfsInjectors) {
      await ensureDir(injector.cipherDir);
      await ensureDir(injector.mountDir);

      const password = await readPassEntry(injector.passwordEntry);
      const tempPassFile = await Deno.makeTempFile({ prefix: "cryptow-pass-" });
      try {
        await Deno.chmod(tempPassFile, 0o600);
        await Deno.writeTextFile(tempPassFile, password + "\n");

        await $`gocryptfs -q --passfile ${tempPassFile} ${injector.cipherDir} ${injector.mountDir}`
          .stdout("inherit")
          .stderr("inherit");

        mountedInjectors.push(injector);
        await logMessage(
          "INFO",
          `Mounted '${profile.name}' to ${injector.mountDir} (cipher: ${injector.cipherDir})`,
        );
      } finally {
        await Deno.remove(tempPassFile).catch(() => {});
      }
    }

    if (gocryptfsInjectors.length === 0) {
      await logMessage(
        "INFO",
        `Mounted '${profile.name}' (no gocryptfs injectors)`,
      );
    }
  } catch (error) {
    for (const injector of mountedInjectors.reverse()) {
      try {
        await $`umount ${injector.mountDir}`
          .stdout("inherit")
          .stderr("inherit");
      } catch (_unmountError) {
        // best-effort cleanup; ignore errors here as we'll surface the original failure below
      }
    }
    await cleanupState(profile.name, false);
    const message = error instanceof Error ? error.message : String(error);
    await logMessage("ERROR", `Failed to mount '${profile.name}': ${message}`);
    throw error;
  }
}

export async function unmountProfile(
  profile: Profile,
  options: UnmountOptions = {},
): Promise<void> {
  const { dryRun = false, force = false } = options;
  const mounted = await isMounted(profile.name);
  const gocryptfsInjectors = getGocryptfsInjectors(profile);

  if (!mounted) {
    if (dryRun) {
      console.log(`Profile '${profile.name}' is not mounted.`);
      return;
    }
    if (!force) {
      throw new Error(`Profile '${profile.name}' is not mounted.`);
    }
    await cleanupState(profile.name, false);
    await logMessage(
      "WARN",
      `Cleared stale state for '${profile.name}' (force unmount).`,
    );
    return;
  }

  if (dryRun) {
    if (gocryptfsInjectors.length === 0) {
      console.log(
        `Would clear lock state for '${profile.name}' (no gocryptfs mounts).`,
      );
    } else {
      for (const injector of gocryptfsInjectors) {
        console.log(
          `Would unmount '${profile.name}' from ${injector.mountDir}`,
        );
      }
    }
    return;
  }

  try {
    for (const injector of [...gocryptfsInjectors].reverse()) {
      try {
        await $`umount ${injector.mountDir}`
          .stdout("inherit")
          .stderr("inherit");
      } catch (error) {
        if (!force) {
          const message = error instanceof Error ? error.message : String(error);
          await logMessage(
            "ERROR",
            `Failed to unmount '${profile.name}' from ${injector.mountDir}: ${message}`,
          );
          throw error;
        }

        try {
          await $`umount -l ${injector.mountDir}`
            .stdout("inherit")
            .stderr("inherit");
          await logMessage(
            "WARN",
            `Unmounted '${profile.name}' from ${injector.mountDir} using lazy umount due to previous failure.`,
          );
        } catch (_error) {
          // fall through to cleanup even if lazy umount fails when forcing
        }
      }

      try {
        await Deno.remove(injector.mountDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logMessage(
          "WARN",
          `Failed to remove mount directory '${injector.mountDir}' after umount: ${message}`,
        );
      }
    }
  } catch (error) {
    if (!force) {
      const message = error instanceof Error ? error.message : String(error);
      await logMessage(
        "ERROR",
        `Failed to unmount '${profile.name}': ${message}`,
      );
      throw error;
    }

    // force path already attempted lazy umount per injector; continue to cleanup
  }

  await cleanupState(profile.name, false);
  await logMessage("INFO", `Unmounted '${profile.name}'`);
}

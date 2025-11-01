import { join } from "@std/path";

export const homeDir = Deno.env.get("HOME");
if (!homeDir) {
  throw new Error("HOME environment variable is not set.");
}

const xdgDataHome = Deno.env.get("XDG_DATA_HOME") ?? join(homeDir, ".local", "share");
const xdgConfigHome = Deno.env.get("XDG_CONFIG_HOME") ?? join(homeDir, ".config");

export const configDir = Deno.env.get("CRYPTOW_CONFIG_DIR") ?? join(xdgConfigHome, "cryptow");
export const profilesConfigFile = join(configDir, "profiles.yaml");

export const dataDir = Deno.env.get("CRYPTOW_DATA_DIR") ?? join(xdgDataHome, "cryptow");
export const profilesDataDir = join(dataDir, "profiles");
export const mountsDir = join(dataDir, "mounts");
export const logDir = join(dataDir, "log");
export const logFile = join(logDir, "cryptow.log");

export function profileDataDir(profile: string): string {
  return join(profilesDataDir, profile);
}

export function defaultCipherDir(profile: string): string {
  return join(profileDataDir(profile), "cipher");
}

export function defaultMountDir(profile: string): string {
  return join(mountsDir, profile);
}

export function pidFilePath(profile: string): string {
  return join(profileDataDir(profile), "mount.pid");
}

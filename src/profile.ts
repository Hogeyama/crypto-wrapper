import { exists } from "@std/fs/exists";
import { ensureDir } from "@std/fs/ensure-dir";
import { parse } from "@std/yaml";
import { defaultCipherDir, defaultMountDir, profileDataDir, profilesConfigFile } from "./paths.ts";
import { expandPath } from "./path_utils.ts";

export interface Profile {
  name: string;
  command: string[];
  env: Record<string, string>;
  passwordEntry: string;
  cipherDir: string;
  mountDir: string;
  workingDir?: string;
}

interface RawProfile {
  name?: string;
  command?: string | string[];
  env?: Record<string, string>;
  password_entry?: string;
  passwordEntry?: string;
  cipher_dir?: string;
  cipherDir?: string;
  mount_dir?: string;
  mountDir?: string;
  cwd?: string;
  working_dir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readProfilesYaml(): Promise<
  { profiles: Record<string, RawProfile>; exists: boolean }
> {
  if (!(await exists(profilesConfigFile))) {
    return { profiles: {}, exists: false };
  }

  const content = await Deno.readTextFile(profilesConfigFile);
  if (content.trim().length === 0) {
    return { profiles: {}, exists: true };
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse profiles YAML at ${profilesConfigFile}: ${message}`);
  }

  let rawProfiles: unknown = parsed;
  if (isRecord(parsed) && parsed["profiles"] !== undefined) {
    rawProfiles = parsed["profiles"];
  }

  if (!isRecord(rawProfiles)) {
    throw new Error(
      `Profiles YAML at ${profilesConfigFile} must map profile names to definitions.`,
    );
  }

  const profiles: Record<string, RawProfile> = {};
  for (const [profileName, definition] of Object.entries(rawProfiles)) {
    if (!isRecord(definition)) {
      throw new Error(
        `Profile '${profileName}' must be an object-like mapping in ${profilesConfigFile}.`,
      );
    }
    profiles[profileName] = definition as RawProfile;
  }

  return { profiles, exists: true };
}

async function buildProfileFromRaw(name: string, raw: RawProfile): Promise<Profile> {
  const commandValue = raw.command;
  if (!commandValue || (Array.isArray(commandValue) && commandValue.length === 0)) {
    throw new Error(`Profile '${name}' is missing a 'command' definition.`);
  }

  const toStringArray = Array.isArray(commandValue)
    ? commandValue.map((part) => `${part}`)
    : [`${commandValue}`];
  const command = toStringArray.map((part) => expandPath(part));

  const passwordEntry = raw.passwordEntry ?? raw.password_entry;
  if (!passwordEntry) {
    throw new Error(`Profile '${name}' is missing 'password_entry'.`);
  }

  const cipherDir = expandPath(raw.cipherDir ?? raw.cipher_dir ?? defaultCipherDir(name));
  const mountDir = expandPath(raw.mountDir ?? raw.mount_dir ?? defaultMountDir(name));
  const envRaw = raw.env ?? {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRaw)) {
    env[key] = expandPath(`${value}`);
  }
  const workingDirRaw = raw.cwd ?? raw.working_dir;
  const workingDir = workingDirRaw ? expandPath(workingDirRaw) : undefined;

  await ensureDir(profileDataDir(name));

  return {
    name,
    command,
    env,
    passwordEntry,
    cipherDir,
    mountDir,
    workingDir,
  };
}

export async function listProfileNames(): Promise<string[]> {
  const { profiles, exists: yamlExists } = await readProfilesYaml();
  if (!yamlExists) {
    return [];
  }

  return Object.keys(profiles).sort();
}

export async function loadProfile(name: string): Promise<Profile> {
  const { profiles, exists: yamlExists } = await readProfilesYaml();
  if (!yamlExists) {
    throw new Error(`Profiles configuration not found at ${profilesConfigFile}`);
  }

  const raw = profiles[name];
  if (!raw) {
    throw new Error(`Profile '${name}' not found in ${profilesConfigFile}`);
  }

  return await buildProfileFromRaw(name, raw);
}

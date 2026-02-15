import { join } from "@std/path";
import { exists } from "@std/fs/exists";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@std/testing/bdd";
import {
  type CaseEnv,
  cleanupCaseEnv,
  createCaseEnv,
  createSuiteEnv,
  disposeSuiteEnv,
  initializePassStore,
  type SuiteEnv,
  writePassEntry,
} from "./helpers/e2e_env_lib.ts";
import { runCryptow, writeProfilesYaml } from "./helpers/e2e_cryptow_lib.ts";
import { logStep } from "./helpers/e2e_report_lib.ts";

let suite: SuiteEnv;
let caseEnv: CaseEnv;
let caseIndex = 0;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function q(value: string): string {
  return JSON.stringify(value);
}

function initYaml(profileName: string, mountDir: string, cipherDir: string): string {
  return [
    "profiles:",
    `  ${profileName}:`,
    '    command: ["sh", "-lc", "true"]',
    "    injectors:",
    "      - type: gocryptfs",
    `        password_entry: ${q(`gocryptfs/${profileName}`)}`,
    `        cipher_dir: ${q(cipherDir)}`,
    `        mount_dir: ${q(mountDir)}`,
    "",
  ].join("\n");
}

describe("init e2e", () => {
  beforeAll(async () => {
    suite = await createSuiteEnv(Deno.args);
    await initializePassStore(suite);
  });

  beforeEach(async () => {
    caseIndex += 1;
    caseEnv = await createCaseEnv(suite, `init-${caseIndex}`);
  });

  afterEach(async () => {
    await cleanupCaseEnv(caseEnv);
  });

  afterAll(async () => {
    await disposeSuiteEnv(suite);
  });

  it("init --gen-pass: fails when gocryptfs.conf already exists", async () => {
    const profileName = `init-conf-exists-${caseIndex}`;
    const mountDir = join(caseEnv.workDir, "mount");
    const cipherDir = join(caseEnv.workDir, "cipher");
    logStep(suite, `Preparing init test profile '${profileName}'`);
    const yaml = initYaml(profileName, mountDir, cipherDir);
    await writeProfilesYaml(caseEnv, yaml, { verbose: suite.verbose, label: caseEnv.caseName });

    logStep(suite, "Running first init --gen-pass (should succeed and create gocryptfs.conf)");
    const first = await runCryptow(suite, caseEnv, ["init", profileName, "--gen-pass"]);
    const configPath = join(cipherDir, "gocryptfs.conf");
    try {
      assertCondition(first.code === 0, "first init should succeed");
      assertCondition(await exists(configPath), `gocryptfs config should exist: ${configPath}`);
      logStep(suite, `Created gocryptfs config: ${configPath}`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${first.context}`,
      );
    }

    logStep(suite, "Running second init --gen-pass (should fail with already initialized)");
    const second = await runCryptow(suite, caseEnv, ["init", profileName, "--gen-pass"]);
    try {
      assertCondition(second.code !== 0, "second init should fail");
      const combined = `${second.stdout}\n${second.stderr}`;
      assertCondition(
        combined.includes("already initialized"),
        "expected already initialized message not found",
      );
      logStep(suite, "Verified failure reason: already initialized");
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${second.context}`,
      );
    }
  });

  it("init --gen-pass: fails when pass entry already exists", async () => {
    const profileName = `init-pass-exists-${caseIndex}`;
    const mountDir = join(caseEnv.workDir, "mount-pass");
    const cipherDir = join(caseEnv.workDir, "cipher-pass");
    const passEntry = `gocryptfs/${profileName}`;
    logStep(suite, `Preparing init test profile '${profileName}'`);
    const yaml = initYaml(profileName, mountDir, cipherDir);
    await writeProfilesYaml(caseEnv, yaml, { verbose: suite.verbose, label: caseEnv.caseName });

    logStep(suite, `Creating pre-existing pass entry to force failure: ${passEntry}`);
    await writePassEntry(suite, passEntry, "PRESET_PASS_VALUE");

    logStep(suite, "Running init --gen-pass (should fail with overwrite refusal)");
    const result = await runCryptow(suite, caseEnv, ["init", profileName, "--gen-pass"]);
    try {
      assertCondition(result.code !== 0, "init should fail when pass entry already exists");
      const combined = `${result.stdout}\n${result.stderr}`;
      assertCondition(
        combined.includes("Refusing to overwrite"),
        "expected overwrite refusal message not found",
      );
      logStep(suite, "Verified failure reason: Refusing to overwrite");
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${result.context}`,
      );
    }
  });
});

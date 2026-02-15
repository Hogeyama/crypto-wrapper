import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assertCleanupState,
  assertRunExitCode,
  assertRunLifecycle,
  type RunExpectation,
  type RunInvariantExpectation,
} from "./helpers/e2e_assertions.ts";
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
import {
  isMountActive,
  registerMountDir,
  runCryptow,
  writeProfilesYaml,
} from "./helpers/e2e_cryptow_lib.ts";
import { assertProbePayload } from "./helpers/e2e_probe.ts";

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

function buildProbeRunProfileYaml(
  profileName: string,
  probeScriptPath: string,
  outputPath: string,
  mountDir: string,
  cipherDir: string,
  envPasswordEntry: string,
): string {
  return [
    "profiles:",
    `  ${profileName}:`,
    "    command:",
    "      - deno",
    "      - run",
    "      - -A",
    "      - --quiet",
    `      - ${q(probeScriptPath)}`,
    "    env:",
    `      PROBE_OUTPUT: ${q(outputPath)}`,
    `      PROBE_MOUNT_DIR: ${q(mountDir)}`,
    "    injectors:",
    "      - type: gocryptfs",
    `        password_entry: ${q(`gocryptfs/${profileName}`)}`,
    `        cipher_dir: ${q(cipherDir)}`,
    `        mount_dir: ${q(mountDir)}`,
    "      - type: env",
    `        password_entry: ${q(envPasswordEntry)}`,
    `        env: ${q("API_TOKEN")}`,
    "",
  ].join("\n");
}

async function arrangeRunCase(
  profileName: string,
  envPasswordEntry: string,
  mountDirSuffix = "mount",
  cipherDirSuffix = "cipher",
  outputFilename = "probe.json",
): Promise<RunExpectation> {
  const mountDir = join(caseEnv.workDir, mountDirSuffix);
  const cipherDir = join(caseEnv.workDir, cipherDirSuffix);
  const outputPath = join(caseEnv.workDir, outputFilename);

  const yaml = buildProbeRunProfileYaml(
    profileName,
    suite.probeScriptPath,
    outputPath,
    mountDir,
    cipherDir,
    envPasswordEntry,
  );

  await writeProfilesYaml(caseEnv, yaml, {
    verbose: suite.verbose,
    label: caseEnv.caseName,
  });
  registerMountDir(caseEnv, mountDir);

  return {
    profileName,
    mountDir,
    cipherDir,
    outputPath,
    pidPath: join(caseEnv.dataDir, "profiles", profileName, "mount.pid"),
  };
}

function buildExitCodeRunProfileYaml(
  profileName: string,
  mountDir: string,
  cipherDir: string,
): string {
  const exitScriptPath = join(suite.repoRoot, "tests", "fixtures", "exit_with_code.ts");
  return [
    "profiles:",
    `  ${profileName}:`,
    "    command:",
    "      - deno",
    "      - run",
    "      - -A",
    `      - ${q(exitScriptPath)}`,
    "    env:",
    '      EXIT_CODE: "7"',
    "    injectors:",
    "      - type: gocryptfs",
    `        password_entry: ${q(`gocryptfs/${profileName}`)}`,
    `        cipher_dir: ${q(cipherDir)}`,
    `        mount_dir: ${q(mountDir)}`,
    "",
  ].join("\n");
}

describe("run e2e", () => {
  beforeAll(async () => {
    suite = await createSuiteEnv(Deno.args);
    await initializePassStore(suite);
  });

  beforeEach(async () => {
    caseIndex += 1;
    caseEnv = await createCaseEnv(suite, `case-${caseIndex}`);
  });

  afterEach(async () => {
    await cleanupCaseEnv(caseEnv);
  });

  afterAll(async () => {
    await disposeSuiteEnv(suite);
  });

  it("run: injects secrets, writes under mount, and cleans up with strict logs", async () => {
    const successEntry = `env/api_token_case_${caseIndex}`;
    const successToken = "TOKEN_E2E_VALUE";
    await writePassEntry(suite, successEntry, successToken);
    const exp = await arrangeRunCase("e2e-run", successEntry, "mount", "cipher", "probe.json");
    await runCryptow(suite, caseEnv, ["init", exp.profileName, "--gen-pass"]);
    const invExp: RunInvariantExpectation = {
      profileName: exp.profileName,
      mountDir: exp.mountDir,
      cipherDir: exp.cipherDir,
      pidPath: exp.pidPath,
    };

    const result = await runCryptow(suite, caseEnv, ["run", exp.profileName]);

    try {
      assertRunExitCode(suite, result, { expected: "success" });
      await assertProbePayload(suite, {
        outputPath: exp.outputPath,
        expectedApiToken: successToken,
        expectedProfile: exp.profileName,
        expectMountWriteOk: true,
      });
      await assertCleanupState(suite, caseEnv, invExp);
      await assertRunLifecycle(suite, caseEnv, invExp, { expectInitLog: true });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${result.context}`,
      );
    }
  });

  it("run: unmounts and cleans up when env injector fails", async () => {
    const missingEntry = `env/missing_token_case_${caseIndex}`;
    const exp = await arrangeRunCase(
      "e2e-run-fail",
      missingEntry,
      "mount-fail",
      "cipher-fail",
      "probe-fail.json",
    );
    await runCryptow(suite, caseEnv, ["init", exp.profileName, "--gen-pass"]);
    const invExp: RunInvariantExpectation = {
      profileName: exp.profileName,
      mountDir: exp.mountDir,
      cipherDir: exp.cipherDir,
      pidPath: exp.pidPath,
    };

    const result = await runCryptow(suite, caseEnv, ["run", exp.profileName]);

    try {
      assertRunExitCode(suite, result, { expected: "failure" });
      await assertCleanupState(suite, caseEnv, invExp);
      await assertRunLifecycle(suite, caseEnv, invExp, { expectInitLog: false });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${result.context}`,
      );
    }
  });

  it("run: reuses existing mount and leaves it mounted", async () => {
    const profileName = `e2e-run-reuse-${caseIndex}`;
    const successEntry = `env/reuse_token_case_${caseIndex}`;
    const successToken = `TOKEN_REUSE_${caseIndex}`;
    await writePassEntry(suite, successEntry, successToken);
    const exp = await arrangeRunCase(
      profileName,
      successEntry,
      "mount-reuse",
      "cipher-reuse",
      "probe-reuse.json",
    );

    await runCryptow(suite, caseEnv, ["init", exp.profileName, "--gen-pass"]);
    await runCryptow(suite, caseEnv, ["mount", exp.profileName]);
    const result = await runCryptow(suite, caseEnv, ["run", exp.profileName]);

    try {
      assertCondition(result.code === 0, "run should succeed");
      const combined = `${result.stdout}\n${result.stderr}`;
      assertCondition(
        combined.includes("is already mounted; reusing existing mount."),
        "reuse message was not found",
      );
      const active = await isMountActive(caseEnv, exp.mountDir);
      assertCondition(active, "mount should stay active after reused run");
      await assertProbePayload(suite, {
        outputPath: exp.outputPath,
        expectedApiToken: successToken,
        expectedProfile: exp.profileName,
        expectMountWriteOk: true,
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${result.context}`,
      );
    }
  });

  it("run: propagates non-zero exit code and always cleans up", async () => {
    const profileName = `e2e-run-exit-${caseIndex}`;
    const mountDir = join(caseEnv.workDir, "mount-exit");
    const cipherDir = join(caseEnv.workDir, "cipher-exit");
    const pidPath = join(caseEnv.dataDir, "profiles", profileName, "mount.pid");
    registerMountDir(caseEnv, mountDir);
    const yaml = buildExitCodeRunProfileYaml(profileName, mountDir, cipherDir);
    await writeProfilesYaml(caseEnv, yaml, {
      verbose: suite.verbose,
      label: caseEnv.caseName,
    });

    await runCryptow(suite, caseEnv, ["init", profileName, "--gen-pass"]);
    const result = await runCryptow(suite, caseEnv, ["run", profileName]);

    try {
      assertCondition(result.code === 7, `run should exit with child code 7, got ${result.code}`);
      const combined = `${result.stdout}\n${result.stderr}`;
      assertCondition(
        combined.includes("Command exited with code 7"),
        "expected exit code message was not found",
      );
      const active = await isMountActive(caseEnv, mountDir);
      assertCondition(!active, "mount should be unmounted after failed run");
      assertCondition(!(await exists(pidPath)), `PID file must be removed: ${pidPath}`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${result.context}`,
      );
    }
  });
});

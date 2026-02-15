import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import type { CaseEnv, CmdResult, SuiteEnv } from "./e2e_env_lib.ts";
import { assertUnmounted } from "./e2e_cryptow_lib.ts";
import { logStep } from "./e2e_report_lib.ts";

export interface RunExpectation {
  profileName: string;
  mountDir: string;
  cipherDir: string;
  outputPath: string;
  pidPath: string;
}

export interface RunInvariantExpectation {
  profileName: string;
  mountDir: string;
  cipherDir: string;
  pidPath: string;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertRunExitCode(
  suite: SuiteEnv,
  result: CmdResult,
  exp: { expected: "success" | "failure" },
): void {
  if (exp.expected === "success") {
    assertCondition(result.code === 0, "run should succeed");
    logStep(suite, "Run succeeded with exit code 0.");
    return;
  }
  assertCondition(result.code !== 0, "run should fail");
  logStep(suite, `Run failed as expected with exit code ${result.code}.`);
}

export async function assertCleanupState(
  suite: SuiteEnv,
  caseEnv: CaseEnv,
  exp: RunInvariantExpectation,
): Promise<void> {
  await assertUnmounted(caseEnv, exp.mountDir, "Mount directory should be unmounted.");
  assertCondition(!(await exists(exp.pidPath)), `PID file must be removed: ${exp.pidPath}`);
  logStep(suite, "PID file removed as expected.");
}

export async function assertRunLifecycle(
  suite: SuiteEnv,
  caseEnv: CaseEnv,
  exp: RunInvariantExpectation,
  options: { expectInitLog: boolean },
): Promise<void> {
  const logPath = join(caseEnv.dataDir, "log", "cryptow.log");
  assertCondition(await exists(logPath), `Log file not found: ${logPath}`);
  const logContent = await Deno.readTextFile(logPath);
  if (options.expectInitLog) {
    assertCondition(
      logContent.includes(`Initialized profile '${exp.profileName}'`),
      "Expected init log not found.",
    );
    logStep(suite, "Initialization log found as expected.");
  }
  assertCondition(
    logContent.includes(
      `Mounted '${exp.profileName}' to ${exp.mountDir} (cipher: ${exp.cipherDir})`,
    ),
    "Expected mount log not found.",
  );
  logStep(suite, "Mount log found as expected.");
  assertCondition(
    logContent.includes(`Unmounted '${exp.profileName}'`),
    "Expected unmount log not found.",
  );
  logStep(suite, "Unmount log found as expected.");
}

import { exists } from "@std/fs/exists";
import type { SuiteEnv } from "./e2e_env_lib.ts";
import { logStep } from "./e2e_report_lib.ts";

export interface E2EProbePayload {
  apiToken: string;
  profile: string;
  mountWriteOk: boolean;
}

export interface ProbeExpectation {
  outputPath: string;
  expectedApiToken: string;
  expectedProfile: string;
  expectMountWriteOk: boolean;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function readProbePayload(outputPath: string): Promise<E2EProbePayload> {
  assertCondition(await exists(outputPath), `Probe output not found: ${outputPath}`);
  const payloadRaw = await Deno.readTextFile(outputPath);
  return JSON.parse(payloadRaw) as E2EProbePayload;
}

export async function assertProbePayload(suite: SuiteEnv, exp: ProbeExpectation): Promise<void> {
  const payload = await readProbePayload(exp.outputPath);

  assertCondition(
    payload.apiToken === exp.expectedApiToken,
    "API_TOKEN was not injected correctly.",
  );
  logStep(suite, "API_TOKEN in probe output matches expected value.");
  assertCondition(
    payload.profile === exp.expectedProfile,
    "CRYPTOW_PROFILE was not injected correctly.",
  );
  logStep(suite, "CRYPTOW_PROFILE in probe output matches expected value.");
  assertCondition(
    payload.mountWriteOk === exp.expectMountWriteOk,
    "Write under mount directory failed.",
  );
  logStep(suite, "Write under mount directory succeeded as expected.");
}

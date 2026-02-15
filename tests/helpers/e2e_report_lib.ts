import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import type { CaseEnv, CmdResult, SuiteEnv } from "./e2e_env_lib.ts";

export function logStep(suite: SuiteEnv, message: string): void {
  if (!suite.verbose) {
    return;
  }
  console.log(`[e2e] ${message}`);
}

export async function buildRunContext(
  caseEnv: CaseEnv,
  label: string,
  result: CmdResult,
): Promise<string> {
  const logPath = join(caseEnv.dataDir, "log", "cryptow.log");
  const profilesPath = join(caseEnv.configDir, "profiles.yaml");

  const logContent = await exists(logPath)
    ? await Deno.readTextFile(logPath)
    : "<log file not found>";
  const profilesContent = await exists(profilesPath)
    ? await Deno.readTextFile(profilesPath)
    : "<profiles.yaml not found>";

  return [
    `[${label}] exit_code=${result.code}`,
    `[${label}] stdout:`,
    result.stdout.trim().length > 0 ? result.stdout : "<empty>",
    `[${label}] stderr:`,
    result.stderr.trim().length > 0 ? result.stderr : "<empty>",
    "[profiles.yaml]",
    profilesContent.trim().length > 0 ? profilesContent : "<empty>",
    "[cryptow.log]",
    logContent.trim().length > 0 ? logContent : "<empty>",
  ].join("\n");
}

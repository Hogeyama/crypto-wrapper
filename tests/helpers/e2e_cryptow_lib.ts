import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import type { CaseEnv, CmdResult, SuiteEnv } from "./e2e_env_lib.ts";
import { logStep } from "./e2e_report_lib.ts";

async function runCommand(
  args: string[],
  env: Record<string, string>,
  options: { cwd?: string; stdinText?: string; noThrow?: boolean } = {},
): Promise<CmdResult> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    env,
    cwd: options.cwd,
    stdin: options.stdinText === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const child = command.spawn();
  if (options.stdinText !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(options.stdinText));
    await writer.close();
  }

  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  if (!options.noThrow && output.code !== 0) {
    throw new Error(
      `Command failed (${
        args.join(" ")
      }): code=${output.code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  return { code: output.code, stdout, stderr, context: "" };
}

async function buildRunContext(
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

export async function runCryptow(
  suite: SuiteEnv,
  caseEnv: CaseEnv,
  args: string[],
  opts: { noThrow?: boolean } = {},
): Promise<CmdResult> {
  logStep(suite, `Running: cryptow ${args.join(" ")}`);
  const result = await runCommand(
    ["deno", "run", "-A", suite.mainTsPath, ...args],
    caseEnv.env,
    { cwd: suite.repoRoot, noThrow: opts.noThrow },
  );
  result.context = await buildRunContext(caseEnv, args.join(" "), result);
  return result;
}

export async function writeProfilesYaml(
  caseEnv: CaseEnv,
  yaml: string,
  opts: { verbose: boolean; label: string },
): Promise<string> {
  const profilePath = join(caseEnv.configDir, "profiles.yaml");
  await Deno.writeTextFile(profilePath, yaml);
  if (opts.verbose) {
    console.log(`[e2e] Wrote profiles.yaml for ${opts.label}: ${profilePath}:`);
    console.log(yaml);
  }
  return profilePath;
}

export function registerMountDir(caseEnv: CaseEnv, mountDir: string): void {
  caseEnv.mountDirs.add(mountDir);
}

export async function isMountActive(caseEnv: CaseEnv, mountDir: string): Promise<boolean> {
  const result = await runCommand(["mountpoint", "-q", mountDir], caseEnv.env, { noThrow: true });
  return result.code === 0;
}

export async function assertUnmounted(
  caseEnv: CaseEnv,
  mountDir: string,
  message: string,
): Promise<void> {
  const active = await isMountActive(caseEnv, mountDir);
  if (active) {
    throw new Error(message);
  }
}

export async function readCryptowLog(caseEnv: CaseEnv): Promise<string> {
  const logPath = join(caseEnv.dataDir, "log", "cryptow.log");
  if (!(await exists(logPath))) {
    return "";
  }
  return await Deno.readTextFile(logPath);
}

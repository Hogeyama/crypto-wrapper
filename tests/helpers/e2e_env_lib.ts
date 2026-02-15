import { join } from "@std/path";

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
  context: string;
}

export interface SuiteEnv {
  repoRoot: string;
  mainTsPath: string;
  probeScriptPath: string;
  rootDir: string;
  baseEnv: Record<string, string>;
  verbose: boolean;
}

export interface CaseEnv {
  caseName: string;
  caseRoot: string;
  workDir: string;
  configDir: string;
  dataDir: string;
  env: Record<string, string>;
  mountDirs: Set<string>;
}

const REQUIRED_COMMANDS = ["deno", "pass", "gpg", "gocryptfs", "umount", "mountpoint"];

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

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

function logStep(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }
  console.log(`[e2e] ${message}`);
}

async function ensureCommands(baseEnv: Record<string, string>, verbose: boolean): Promise<void> {
  logStep(verbose, `Checking required commands: ${REQUIRED_COMMANDS.join(", ")}`);
  for (const command of REQUIRED_COMMANDS) {
    const result = await runCommand(["sh", "-lc", `command -v ${command}`], baseEnv, {
      noThrow: true,
    });
    if (result.code !== 0) {
      throw new Error(`Required command not found: ${command}`);
    }
  }
}

async function initGpgAndPass(suite: SuiteEnv): Promise<void> {
  logStep(suite.verbose, "Generating temporary GPG key");
  const batchPath = await Deno.makeTempFile({ prefix: "cryptow-e2e-gpg-" });

  try {
    const batch = [
      "%no-protection",
      "Key-Type: RSA",
      "Key-Length: 2048",
      "Subkey-Type: RSA",
      "Subkey-Length: 2048",
      "Name-Real: cryptow e2e",
      "Name-Email: cryptow-e2e@example.invalid",
      "Expire-Date: 0",
      "%commit",
      "",
    ].join("\n");
    await Deno.writeTextFile(batchPath, batch);

    await runCommand(["gpg", "--batch", "--generate-key", batchPath], suite.baseEnv);
    const list = await runCommand(
      ["gpg", "--batch", "--with-colons", "--list-secret-keys"],
      suite.baseEnv,
    );

    const fingerprint = list.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("fpr:"))
      .map((line) => line.split(":")[9] ?? "")
      .find((value) => value.length > 0);

    if (!fingerprint) {
      throw new Error("Failed to read generated GPG fingerprint.");
    }

    logStep(suite.verbose, `Initializing pass store with key: ${fingerprint}`);
    await runCommand(["pass", "init", fingerprint], suite.baseEnv);
  } finally {
    await Deno.remove(batchPath).catch(() => {});
  }
}

async function isMountActive(env: Record<string, string>, mountDir: string): Promise<boolean> {
  const result = await runCommand(["mountpoint", "-q", mountDir], env, { noThrow: true });
  return result.code === 0;
}

async function forceUnmount(env: Record<string, string>, mountDir: string): Promise<void> {
  if (await isMountActive(env, mountDir)) {
    await runCommand(["umount", mountDir], env, { noThrow: true });
  }
}

export async function createSuiteEnv(args: string[]): Promise<SuiteEnv> {
  const repoRoot = join(import.meta.dirname ?? ".", "..", "..");
  const parsedArgs = new Set(args);
  const verbose = parsedArgs.has("--verbose");

  const rootDir = await Deno.makeTempDir({ prefix: "cryptow-e2e-" });
  const home = join(rootDir, "home");
  const gnupgHome = join(rootDir, "gnupg");
  const passStoreDir = join(rootDir, "pass-store");

  await Deno.mkdir(home, { recursive: true });
  await Deno.mkdir(gnupgHome, { recursive: true });
  await Deno.mkdir(passStoreDir, { recursive: true });
  await Deno.chmod(gnupgHome, 0o700);

  const baseEnv = {
    ...Deno.env.toObject(),
    HOME: home,
    GNUPGHOME: gnupgHome,
    PASSWORD_STORE_DIR: passStoreDir,
    LC_ALL: "C",
  };

  await ensureCommands(baseEnv, verbose);

  return {
    repoRoot,
    mainTsPath: join(repoRoot, "src", "main.ts"),
    probeScriptPath: join(repoRoot, "tests", "fixtures", "run_probe.ts"),
    rootDir,
    baseEnv,
    verbose,
  };
}

export async function initializePassStore(suite: SuiteEnv): Promise<void> {
  await initGpgAndPass(suite);
}

export async function writePassEntry(
  suite: SuiteEnv,
  entry: string,
  value: string,
): Promise<void> {
  logStep(suite.verbose, `Writing pass entry: ${entry}`);
  await runCommand(["pass", "insert", "-m", entry], suite.baseEnv, {
    stdinText: `${value}\n`,
  });
}

export async function createCaseEnv(suite: SuiteEnv, caseName: string): Promise<CaseEnv> {
  const safeName = caseName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const caseRoot = join(suite.rootDir, "cases", `${Date.now()}-${safeName}`);
  const xdgConfigHome = join(caseRoot, "xdg-config");
  const xdgDataHome = join(caseRoot, "xdg-data");
  const workDir = join(caseRoot, "work");
  const configDir = join(xdgConfigHome, "cryptow");
  const dataDir = join(xdgDataHome, "cryptow");

  await Deno.mkdir(configDir, { recursive: true });
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.mkdir(workDir, { recursive: true });

  logStep(suite.verbose, `Created case context: ${caseName} (${caseRoot})`);

  return {
    caseName,
    caseRoot,
    workDir,
    configDir,
    dataDir,
    env: {
      ...suite.baseEnv,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
    },
    mountDirs: new Set<string>(),
  };
}

export async function cleanupCaseEnv(caseEnv: CaseEnv): Promise<void> {
  for (const mountDir of caseEnv.mountDirs) {
    await forceUnmount(caseEnv.env, mountDir);
  }
  await Deno.remove(caseEnv.caseRoot, { recursive: true }).catch(() => {});
}

export async function disposeSuiteEnv(suite: SuiteEnv): Promise<void> {
  assertCondition(suite.rootDir.length > 0, "suite root dir is empty");
  await Deno.remove(suite.rootDir, { recursive: true }).catch(() => {});
}

import { join } from "@std/path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@std/testing/bdd";
import {
  type CaseEnv,
  cleanupCaseEnv,
  createCaseEnv,
  createSuiteEnv,
  disposeSuiteEnv,
  initializePassStore,
  type SuiteEnv,
} from "./helpers/e2e_env_lib.ts";
import {
  registerMountDir,
  runCryptow,
  runCryptowJson,
  writeProfilesYaml,
} from "./helpers/e2e_cryptow_lib.ts";
import { logStep } from "./helpers/e2e_report_lib.ts";

interface ListRow {
  name: string;
  mounted: boolean;
  mountDir?: string;
  error?: string;
}

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

function listYaml(profileName: string, mountDir: string, cipherDir: string): string {
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

describe("list e2e", () => {
  beforeAll(async () => {
    suite = await createSuiteEnv(Deno.args);
    await initializePassStore(suite);
  });

  beforeEach(async () => {
    caseIndex += 1;
    caseEnv = await createCaseEnv(suite, `list-${caseIndex}`);
  });

  afterEach(async () => {
    await cleanupCaseEnv(caseEnv);
  });

  afterAll(async () => {
    await disposeSuiteEnv(suite);
  });

  it("list/list --json: switches status between unmounted and mounted", async () => {
    const profileName = `list-profile-${caseIndex}`;
    const mountDir = join(caseEnv.workDir, "mount");
    const cipherDir = join(caseEnv.workDir, "cipher");
    logStep(suite, `Preparing list test profile '${profileName}'`);
    const yaml = listYaml(profileName, mountDir, cipherDir);
    await writeProfilesYaml(caseEnv, yaml, { verbose: suite.verbose, label: caseEnv.caseName });
    registerMountDir(caseEnv, mountDir);

    logStep(suite, "Initializing profile before list status checks");
    await runCryptow(suite, caseEnv, ["init", profileName, "--gen-pass"]);

    logStep(suite, `Expecting unmounted status in 'cryptow list' for ${profileName}`);
    const listBefore = await runCryptow(suite, caseEnv, ["list"]);
    try {
      assertCondition(listBefore.code === 0, "list should succeed");
      assertCondition(
        listBefore.stdout.includes(`${profileName}  unmounted  ${mountDir}`),
        "unmounted row not found in list output",
      );
      logStep(suite, `Verified unmounted row: ${profileName}  unmounted  ${mountDir}`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${listBefore.context}`,
      );
    }

    logStep(suite, `Mounting profile '${profileName}' to verify mounted status`);
    await runCryptow(suite, caseEnv, ["mount", profileName]);
    logStep(suite, `Expecting mounted status in 'cryptow list' for ${profileName}`);
    const listMounted = await runCryptow(suite, caseEnv, ["list"]);
    try {
      assertCondition(listMounted.code === 0, "list should succeed after mount");
      assertCondition(
        listMounted.stdout.includes(`${profileName}  mounted  ${mountDir}`),
        "mounted row not found in list output",
      );
      logStep(suite, `Verified mounted row: ${profileName}  mounted  ${mountDir}`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${listMounted.context}`,
      );
    }

    logStep(suite, "Verifying list --json fields: name/mounted/mountDir");
    const jsonOut = await runCryptowJson<ListRow[]>(suite, caseEnv, ["list", "--json"]);
    try {
      assertCondition(jsonOut.result.code === 0, "list --json should succeed");
      const row = jsonOut.payload.find((value) => value.name === profileName);
      assertCondition(Boolean(row), "target row not found in list --json output");
      assertCondition(row?.mounted === true, "mounted should be true in list --json");
      assertCondition(row?.mountDir === mountDir, "mountDir mismatch in list --json");
      logStep(
        suite,
        `Verified list --json row: name=${profileName}, mounted=true, mountDir=${mountDir}`,
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${jsonOut.result.context}`,
      );
    }
  });
});

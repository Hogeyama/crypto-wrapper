import $ from "@david/dax";

export async function readPassEntry(entry: string): Promise<string> {
  const output = await $`pass show ${entry}`.text();
  const secret = output.trimEnd();
  if (!secret) {
    throw new Error(`No secret retrieved from pass for '${entry}'.`);
  }
  return secret;
}

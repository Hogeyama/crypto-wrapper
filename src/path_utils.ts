import { join } from "@std/path/join";
import { homeDir } from "./paths.ts";

export function expandPath(input: string): string {
  if (!homeDir) {
    throw new Error("HOME environment variable is not set.");
  }

  if (input === "~") {
    return homeDir;
  }
  if (input.startsWith("~/")) {
    return join(homeDir, input.slice(2));
  }
  return input;
}

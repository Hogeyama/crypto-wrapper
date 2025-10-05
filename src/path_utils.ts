import { join } from "@std/path/join";
import { homeDir } from "./paths.ts";

export function expandPath(input: string): string {
  if (!homeDir) {
    throw new Error("HOME environment variable is not set.");
  }

  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/") || input.startsWith("~\\")) {
    const rest = input.slice(2);
    if (rest.length === 0) {
      return homeDir;
    }
    const segments = rest.split(/[\\/]+/).filter(Boolean);
    return segments.length === 0 ? homeDir : join(homeDir, ...segments);
  }

  return input;
}

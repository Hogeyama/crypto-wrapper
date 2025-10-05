import { ensureDir } from "@std/fs/ensure-dir";
import { logDir, logFile } from "./paths.ts";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export async function logMessage(level: LogLevel, message: string): Promise<void> {
  await ensureDir(logDir);
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level}] ${message}\n`;
  await Deno.writeTextFile(logFile, line, { append: true });
}

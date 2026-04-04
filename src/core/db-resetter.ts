import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../types.js";

const execAsync = promisify(exec);

const TIMEOUT_MS = 60_000;

export async function resetDatabase(
  config: Config,
): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(config.db.resetCommand, {
      cwd: config.db.resetWorkingDir || undefined,
      timeout: TIMEOUT_MS,
    });
    const output = [stdout, stderr].filter(Boolean).join("\n");
    return { success: true, output };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n");
    return { success: false, output };
  }
}

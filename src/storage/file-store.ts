import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export function getTrackerRoot(): string {
  return process.env.API_TRACKER_ROOT ?? path.join(process.cwd(), ".api-tracker");
}

function resolve(relativePath: string): string {
  return path.join(getTrackerRoot(), relativePath);
}

export async function readJson<T>(relativePath: string): Promise<T | null> {
  const filePath = resolve(relativePath);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read JSON at ${filePath}: ${(err as Error).message}`);
  }
}

export async function writeJson(relativePath: string, data: unknown): Promise<void> {
  const filePath = resolve(relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export async function removeDir(relativePath: string): Promise<void> {
  await fs.rm(resolve(relativePath), { recursive: true, force: true });
}

export async function readYaml<T>(relativePath: string): Promise<T> {
  const filePath = resolve(relativePath);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return YAML.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`YAML file not found: ${filePath}`);
    }
    throw new Error(`Failed to read YAML at ${filePath}: ${(err as Error).message}`);
  }
}

export async function exists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolve(relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function listDirs(relativePath: string): Promise<string[]> {
  const dirPath = resolve(relativePath);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to list directories at ${dirPath}: ${(err as Error).message}`);
  }
}

export async function listFiles(relativePath: string): Promise<string[]> {
  const dirPath = resolve(relativePath);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to list files at ${dirPath}: ${(err as Error).message}`);
  }
}

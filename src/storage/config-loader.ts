import type { Config } from "../types.js";
import { readYaml } from "./file-store.js";

export async function loadConfig(): Promise<Config> {
  return readYaml<Config>("config.yaml");
}

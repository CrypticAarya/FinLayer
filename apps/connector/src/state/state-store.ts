import { readFile, writeFile } from "node:fs/promises";

const STATE_FILE = "./sync-state.json";

export async function loadState<T>(): Promise<T | null> {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function saveState<T>(state: T): Promise<void> {
  await writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

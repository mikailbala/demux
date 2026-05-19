import { readFile, writeFile } from 'node:fs/promises';

export async function writeDecisions(path, decisions) {
  const payload = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...decisions,
  };
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n');
}

export async function readDecisions(path) {
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text);
}

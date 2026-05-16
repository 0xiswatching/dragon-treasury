import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const logPath = path.join(dataDir, 'logs.json');

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(logPath, 'utf8');
  } catch {
    await writeFile(logPath, '[]\n', 'utf8');
  }
}

export async function readLogs() {
  await ensureStore();
  const raw = await readFile(logPath, 'utf8');
  return JSON.parse(raw);
}

export async function appendLog(entry) {
  const logs = await readLogs();
  const nextEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry
  };
  logs.unshift(nextEntry);
  await writeFile(logPath, `${JSON.stringify(logs.slice(0, 250), null, 2)}\n`, 'utf8');
  return nextEntry;
}

export async function getStats() {
  const logs = await readLogs();
  const successfulBurns = logs.filter((log) => log.status === 'burned');
  const totals = successfulBurns.reduce(
    (acc, log) => {
      const key = log.mint ?? 'SOL';
      const amount = BigInt(log.amountRaw ?? log.lamports ?? '0');
      acc.rawByAsset[key] = (BigInt(acc.rawByAsset[key] ?? '0') + amount).toString();
      acc.events += 1;
      return acc;
    },
    { events: 0, rawByAsset: {} }
  );

  return {
    ...totals,
    lastBurnAt: successfulBurns[0]?.createdAt ?? null,
    logs
  };
}

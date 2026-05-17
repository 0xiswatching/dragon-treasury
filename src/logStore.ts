import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BurnStatus = 'burned' | 'failed' | 'skipped';
export type DragonMode = 'simulate' | 'live';

export type BurnLog = {
  id: string;
  createdAt: string;
  status: BurnStatus;
  mode: DragonMode;
  source: string;
  trigger?: string;
  destination?: string;
  mint?: string;
  amountRaw?: string;
  lamports?: string;
  decimals?: number | null;
  lamportsClaimed?: string | null;
  lamportsSpent?: string | null;
  claimSignature?: string | null;
  buySignature?: string | null;
  burnSignature?: string | null;
  error?: string;
};

export type NewBurnLog = Omit<BurnLog, 'id' | 'createdAt'>;

export type BurnStats = {
  events: number;
  rawByAsset: Record<string, string>;
  lastBurnAt: string | null;
  logs: BurnLog[];
};

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

function parseLogs(raw: string): BurnLog[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Log store is invalid: expected an array.');
  }

  return parsed as BurnLog[];
}

export async function readLogs(): Promise<BurnLog[]> {
  await ensureStore();
  const raw = await readFile(logPath, 'utf8');
  return parseLogs(raw);
}

export async function appendLog(entry: NewBurnLog): Promise<BurnLog> {
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

export async function getStats(): Promise<BurnStats> {
  const logs = await readLogs();
  const successfulBurns = logs.filter((log) => log.status === 'burned');
  const totals = successfulBurns.reduce<Pick<BurnStats, 'events' | 'rawByAsset'>>(
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

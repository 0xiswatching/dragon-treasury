import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { loadConfig } from './config.js';
import { appendLog, getStats, readLogs } from './logStore.js';
import type { BurnLog, DragonMode } from './logStore.js';
import { claimPumpfunFees } from './pumpfunClaim.js';
import { getConnection, getKeypair, sendToDeadWallet } from './solanaBurn.js';

const config = loadConfig();
const app = express();
let claimInProgress = false;
let lastClaimAttemptAt: string | null = null;
let lastSuccessfulClaimAt: string | null = null;
let nextAutoClaimAt: string | null = config.autoClaimEnabled
  ? new Date(Date.now() + config.claimIntervalMs).toISOString()
  : null;

function getMode(): DragonMode {
  return config.mode;
}

function getSchedulerState() {
  return {
    autoClaimEnabled: config.autoClaimEnabled,
    claimIntervalMinutes: config.claimIntervalMinutes,
    claimInProgress,
    lastClaimAttemptAt,
    lastSuccessfulClaimAt,
    nextAutoClaimAt
  };
}

app.use(
  cors({
    origin: config.frontendOrigins
  })
);
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    mode: getMode(),
    ...getSchedulerState()
  });
});

app.get('/api/logs', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await readLogs());
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      ...(await getStats()),
      ...getSchedulerState()
    });
  } catch (error) {
    next(error);
  }
});

async function claimAndBurn(source = 'auto'): Promise<BurnLog> {
  if (claimInProgress) {
    lastClaimAttemptAt = new Date().toISOString();
    return appendLog({
      status: 'skipped',
      mode: getMode(),
      source: 'pump.fun fees',
      trigger: source,
      error: 'Previous claim cycle is still running.'
    });
  }

  claimInProgress = true;
  lastClaimAttemptAt = new Date().toISOString();
  try {
    const live = getMode() === 'live';
    const connection = live ? getConnection() : undefined;
    const keypair = live ? getKeypair() : undefined;
    const claim = await claimPumpfunFees({ connection, keypair });
    const burn = live && connection && keypair
      ? await sendToDeadWallet({ ...claim, connection, keypair })
      : {
          signature: 'simulated-dead-wallet-transfer',
          mint: claim.mint,
          amountRaw: claim.amountRaw,
          lamports: claim.lamports
        };

    const log = await appendLog({
      status: 'burned',
      mode: live ? 'live' : 'simulate',
      source: 'pump.fun fees',
      trigger: source,
      destination: config.deadWallet,
      mint: claim.mint ?? burn.mint,
      amountRaw: claim.amountRaw ?? burn.amountRaw,
      lamports: claim.lamports ?? burn.lamports,
      decimals: claim.decimals ?? null,
      lamportsClaimed: claim.lamportsClaimed ?? null,
      lamportsSpent: claim.lamportsSpent ?? null,
      claimSignature: claim.claimSignature ?? null,
      buySignature: claim.buySignature ?? null,
      burnSignature: burn.signature
    });
    lastSuccessfulClaimAt = log.createdAt;
    return log;
  } catch (error) {
    return await appendLog({
      status: 'failed',
      mode: getMode(),
      source: 'pump.fun fees',
      trigger: source,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    claimInProgress = false;
  }
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    status: 'failed',
    error: error instanceof Error ? error.message : String(error)
  });
});

app.listen(config.port, config.host, () => {
  console.log(`Dragon backend listening on http://${config.host}:${config.port}`);
  if (config.autoClaimEnabled) {
    console.log(`Auto claim enabled every ${config.claimIntervalMinutes} minute(s).`);
    if (config.runClaimOnStart) {
      claimAndBurn('startup')
        .then((log) => {
          if (log.status === 'burned') lastSuccessfulClaimAt = log.createdAt;
        })
        .catch((error) => console.error(error));
    }
    setInterval(() => {
      nextAutoClaimAt = new Date(Date.now() + config.claimIntervalMs).toISOString();
      claimAndBurn('interval')
        .then((log) => {
          if (log.status === 'burned') lastSuccessfulClaimAt = log.createdAt;
        })
        .catch((error) => console.error(error));
    }, config.claimIntervalMs);
  }
});

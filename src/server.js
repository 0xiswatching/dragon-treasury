import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { appendLog, getStats, readLogs } from './logStore.js';
import { claimPumpfunFees } from './pumpfunClaim.js';
import { getConnection, getKeypair, sendToDeadWallet } from './solanaBurn.js';

const app = express();
const port = Number(process.env.PORT ?? 8795);
const host = process.env.HOST ?? '0.0.0.0';
const claimIntervalMinutes = Number(process.env.CLAIM_INTERVAL_MINUTES ?? 5);
const claimIntervalMs = Math.max(1, claimIntervalMinutes) * 60_000;
const autoClaimEnabled = process.env.AUTO_CLAIM_ENABLED !== 'false';
let claimInProgress = false;
let lastAutoClaimAt = null;
let nextAutoClaimAt = autoClaimEnabled
  ? new Date(Date.now() + claimIntervalMs).toISOString()
  : null;

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(',') ?? ['http://localhost:5180']
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.DRAGON_MODE === 'live' ? 'live' : 'simulate',
    autoClaimEnabled,
    claimIntervalMinutes,
    lastAutoClaimAt,
    nextAutoClaimAt
  });
});

app.get('/api/logs', async (_req, res, next) => {
  try {
    res.json(await readLogs());
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', async (_req, res, next) => {
  try {
    res.json({
      ...(await getStats()),
      autoClaimEnabled,
      claimIntervalMinutes,
      lastAutoClaimAt,
      nextAutoClaimAt
    });
  } catch (error) {
    next(error);
  }
});

async function claimAndBurn(source = 'auto') {
  if (claimInProgress) {
    return appendLog({
      status: 'skipped',
      mode: process.env.DRAGON_MODE === 'live' ? 'live' : 'simulate',
      source: 'pump.fun fees',
      trigger: source,
      error: 'Previous claim cycle is still running.'
    });
  }

  claimInProgress = true;
  try {
    const live = process.env.DRAGON_MODE === 'live';
    const connection = live ? getConnection() : null;
    const keypair = live ? getKeypair() : null;
    const claim = await claimPumpfunFees({ connection, keypair });
    const burn = live
      ? await sendToDeadWallet({ ...claim, connection, keypair })
      : {
          signature: 'simulated-dead-wallet-transfer',
          mint: claim.mint,
          amountRaw: claim.amountRaw,
          lamports: claim.lamports
        };

    return await appendLog({
      status: 'burned',
      mode: live ? 'live' : 'simulate',
      source: 'pump.fun fees',
      trigger: source,
      destination: process.env.DEAD_WALLET ?? '1nc1nerator11111111111111111111111111111111',
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
  } catch (error) {
    return await appendLog({
      status: 'failed',
      mode: process.env.DRAGON_MODE === 'live' ? 'live' : 'simulate',
      source: 'pump.fun fees',
      trigger: source,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    claimInProgress = false;
    lastAutoClaimAt = new Date().toISOString();
  }
}

app.post('/api/claim-and-burn', async (_req, res) => {
  const entry = await claimAndBurn('manual-api');
  res.status(entry.status === 'failed' ? 500 : 201).json(entry);
});

app.use((error, _req, res, _next) => {
  res.status(500).json({
    status: 'failed',
    error: error instanceof Error ? error.message : String(error)
  });
});

app.listen(port, host, () => {
  console.log(`Dragon backend listening on http://${host}:${port}`);
  if (autoClaimEnabled) {
    console.log(`Auto claim enabled every ${claimIntervalMinutes} minute(s).`);
    if (process.env.RUN_CLAIM_ON_START === 'true') {
      claimAndBurn('startup').catch((error) => console.error(error));
    }
    setInterval(() => {
      nextAutoClaimAt = new Date(Date.now() + claimIntervalMs).toISOString();
      claimAndBurn('interval').catch((error) => console.error(error));
    }, claimIntervalMs);
  }
});

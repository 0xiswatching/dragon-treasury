import 'dotenv/config';
import type { DragonMode } from './logStore.js';

type DragonConfig = {
  mode: DragonMode;
  port: number;
  host: string;
  frontendOrigins: string[];
  autoClaimEnabled: boolean;
  claimIntervalMinutes: number;
  claimIntervalMs: number;
  runClaimOnStart: boolean;
  deadWallet: string;
  drgnDecimals: number;
  pumpDevApiUrl: string;
  pumpDevClaimPriorityFee: number;
  pumpDevTradePriorityFee: number;
  buybackSlippage: number;
  buybackBps: number;
  solReserveLamports: number;
};

function readNumber(name: string, fallback: number, options: { min?: number; max?: number } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }

  if (options.min != null && value < options.min) {
    throw new Error(`${name} must be greater than or equal to ${options.min}.`);
  }

  if (options.max != null && value > options.max) {
    throw new Error(`${name} must be less than or equal to ${options.max}.`);
  }

  return value;
}

function readInteger(name: string, fallback: number, options: { min?: number; max?: number } = {}) {
  const value = readNumber(name, fallback, options);

  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  return value;
}

function readBoolean(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false".`);
}

export function loadConfig(): DragonConfig {
  const mode = process.env.DRAGON_MODE === 'live' ? 'live' : 'simulate';
  const claimIntervalMinutes = readNumber('CLAIM_INTERVAL_MINUTES', 5, { min: 1 });

  if (mode === 'live') {
    if (!process.env.SOLANA_SECRET_KEY) {
      throw new Error('SOLANA_SECRET_KEY is required in live mode.');
    }

    if (!process.env.DRGN_MINT) {
      throw new Error('DRGN_MINT is required in live mode.');
    }
  }

  return {
    mode,
    port: readInteger('PORT', 8795, { min: 1, max: 65_535 }),
    host: process.env.HOST ?? '0.0.0.0',
    frontendOrigins: process.env.FRONTEND_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [
      'http://localhost:5180'
    ],
    autoClaimEnabled: readBoolean('AUTO_CLAIM_ENABLED', true),
    claimIntervalMinutes,
    claimIntervalMs: claimIntervalMinutes * 60_000,
    runClaimOnStart: readBoolean('RUN_CLAIM_ON_START', false),
    deadWallet: process.env.DEAD_WALLET ?? '1nc1nerator11111111111111111111111111111111',
    drgnDecimals: readInteger('DRGN_DECIMALS', 6, { min: 0, max: 18 }),
    pumpDevApiUrl: process.env.PUMPDEV_API_URL ?? 'https://pumpdev.io',
    pumpDevClaimPriorityFee: readNumber('PUMPDEV_CLAIM_PRIORITY_FEE', 0.0001, { min: 0 }),
    pumpDevTradePriorityFee: readNumber('PUMPDEV_TRADE_PRIORITY_FEE', 0.0005, { min: 0 }),
    buybackSlippage: readNumber('BUYBACK_SLIPPAGE', 15, { min: 0 }),
    buybackBps: readInteger('BUYBACK_BPS', 9500, { min: 0, max: 10_000 }),
    solReserveLamports: readInteger('SOL_RESERVE_LAMPORTS', 20_000_000, { min: 0 })
  };
}

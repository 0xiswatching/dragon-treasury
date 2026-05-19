import { LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import type { Connection, Keypair } from '@solana/web3.js';
import {
  getTokenAccountBalance,
  getTokenProgramId,
  getWalletTokenAccount
} from './solanaBurn.js';
import { loadConfig } from './config.js';

const config = loadConfig();

type PumpfunFlowInput = {
  connection?: Connection | null;
  keypair?: Keypair | null;
};

type LivePumpfunFlowInput = {
  connection: Connection;
  keypair: Keypair;
};

export type PumpfunClaimResult = {
  mode: 'simulate' | 'live';
  mint: string;
  amountRaw: string;
  lamports?: string;
  decimals: number;
  lamportsClaimed: string;
  lamportsSpent: string;
  claimSignature: string;
  buySignature: string | null;
};

type ClaimCreatorFeesResult = {
  signature: string;
  lamportsClaimed: number;
};

type BuyBackResult = {
  mint: string;
  amountRaw: string;
  buySignature: string | null;
  lamportsSpent: string;
};

async function postPumpDev(path: string, body: Record<string, unknown>): Promise<Uint8Array> {
  const response = await fetch(`${config.pumpDevApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PumpDev ${path} failed: ${response.status} ${text}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function signAndSendTransaction({
  connection,
  keypair,
  bytes
}: LivePumpfunFlowInput & { bytes: Uint8Array }): Promise<string> {
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([keypair]);
  return await connection.sendTransaction(tx, { skipPreflight: false });
}

async function claimCreatorFees({
  connection,
  keypair
}: LivePumpfunFlowInput): Promise<ClaimCreatorFeesResult> {
  const body: Record<string, unknown> = {
    publicKey: keypair.publicKey.toBase58(),
    priorityFee: config.pumpDevClaimPriorityFee
  };

  if (process.env.PUMPFUN_FEE_SHARING_MINT) {
    body.mint = process.env.PUMPFUN_FEE_SHARING_MINT;
  }

  const before = await connection.getBalance(keypair.publicKey, 'confirmed');
  const bytes = await postPumpDev('/api/claim-account', body);
  const signature = await signAndSendTransaction({ connection, keypair, bytes });
  await connection.confirmTransaction(signature, 'confirmed');
  const after = await connection.getBalance(keypair.publicKey, 'confirmed');

  return {
    signature,
    lamportsClaimed: Math.max(0, after - before)
  };
}

async function buyBackDrgn({
  connection,
  keypair,
  lamportsClaimed
}: LivePumpfunFlowInput & { lamportsClaimed: number }): Promise<BuyBackResult> {
  const mint = process.env.DRGN_MINT;
  if (!mint) {
    throw new Error('DRGN_MINT is required for live buybacks.');
  }

  const lamportsToSpend = Math.floor(
    Math.max(0, lamportsClaimed - config.solReserveLamports) * (config.buybackBps / 10_000)
  );

  if (lamportsToSpend <= 0) {
    return {
      mint,
      amountRaw: '0',
      buySignature: null,
      lamportsSpent: '0'
    };
  }

  const tokenProgramId = await getTokenProgramId({ connection, mint });
  const tokenAccount = getWalletTokenAccount({
    owner: keypair.publicKey,
    mint,
    tokenProgramId
  });
  const before = await getTokenAccountBalance({ connection, tokenAccount });
  const bytes = await postPumpDev('/api/trade-local', {
    publicKey: keypair.publicKey.toBase58(),
    action: 'buy',
    mint,
    amount: lamportsToSpend / LAMPORTS_PER_SOL,
    denominatedInSol: 'true',
    slippage: config.buybackSlippage,
    priorityFee: config.pumpDevTradePriorityFee
  });
  const signature = await signAndSendTransaction({ connection, keypair, bytes });
  await connection.confirmTransaction(signature, 'confirmed');
  const after = await getTokenAccountBalance({ connection, tokenAccount });

  return {
    mint,
    amountRaw: (after - before).toString(),
    buySignature: signature,
    lamportsSpent: String(lamportsToSpend)
  };
}

export async function claimPumpfunFees({
  connection,
  keypair
}: PumpfunFlowInput = {}): Promise<PumpfunClaimResult> {
  if (config.mode !== 'live') {
    return {
      mode: 'simulate',
      mint: process.env.DRGN_MINT || process.env.BURN_MINT || 'DRGN',
      amountRaw: process.env.BURN_AMOUNT_RAW || String(777_000_000),
      decimals: config.drgnDecimals,
      lamportsClaimed: process.env.BURN_SOL_LAMPORTS || String(50_000_000),
      lamportsSpent: process.env.BURN_SOL_LAMPORTS || String(50_000_000),
      claimSignature: 'simulated-pumpdev-claim-account',
      buySignature: 'simulated-pumpdev-buyback'
    };
  }

  if (!connection || !keypair) {
    throw new Error('connection and keypair are required for live PumpDev flow.');
  }

  const claim = await claimCreatorFees({ connection, keypair });
  const buyback = await buyBackDrgn({
    connection,
    keypair,
    lamportsClaimed: claim.lamportsClaimed
  });

  return {
    mode: 'live',
    mint: buyback.mint,
    amountRaw: buyback.amountRaw,
    decimals: config.drgnDecimals,
    lamportsClaimed: String(claim.lamportsClaimed),
    lamportsSpent: buyback.lamportsSpent,
    claimSignature: claim.signature,
    buySignature: buyback.buySignature
  };
}

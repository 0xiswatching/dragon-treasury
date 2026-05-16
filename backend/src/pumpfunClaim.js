import { LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import {
  getTokenAccountBalance,
  getTokenProgramId,
  getWalletTokenAccount
} from './solanaBurn.js';

const PUMPDEV_API_URL = process.env.PUMPDEV_API_URL ?? 'https://pumpdev.io';

async function postPumpDev(path, body) {
  const response = await fetch(`${PUMPDEV_API_URL}${path}`, {
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

async function signAndSendTransaction({ connection, keypair, bytes }) {
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([keypair]);
  return await connection.sendTransaction(tx, { skipPreflight: false });
}

async function claimCreatorFees({ connection, keypair }) {
  const body = {
    publicKey: keypair.publicKey.toBase58(),
    priorityFee: Number(process.env.PUMPDEV_CLAIM_PRIORITY_FEE ?? 0.0001)
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

async function buyBackDrgn({ connection, keypair, lamportsClaimed }) {
  const mint = process.env.DRGN_MINT;
  if (!mint) {
    throw new Error('DRGN_MINT is required for live buybacks.');
  }

  const reserveLamports = Number(process.env.SOL_RESERVE_LAMPORTS ?? 20_000_000);
  const buybackBps = Number(process.env.BUYBACK_BPS ?? 9500);
  const lamportsToSpend = Math.floor(Math.max(0, lamportsClaimed - reserveLamports) * (buybackBps / 10_000));

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
    slippage: Number(process.env.BUYBACK_SLIPPAGE ?? 15),
    priorityFee: Number(process.env.PUMPDEV_TRADE_PRIORITY_FEE ?? 0.0005)
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

export async function claimPumpfunFees({ connection, keypair } = {}) {
  if (process.env.DRAGON_MODE !== 'live') {
    return {
      mode: 'simulate',
      mint: process.env.DRGN_MINT || process.env.BURN_MINT || 'DRGN',
      amountRaw: process.env.BURN_AMOUNT_RAW || String(777_000_000),
      decimals: Number(process.env.DRGN_DECIMALS ?? 6),
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
    decimals: Number(process.env.DRGN_DECIMALS ?? 6),
    lamportsClaimed: String(claim.lamportsClaimed),
    lamportsSpent: buyback.lamportsSpent,
    claimSignature: claim.signature,
    buySignature: buyback.buySignature
  };
}

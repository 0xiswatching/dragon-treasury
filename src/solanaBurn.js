import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync
} from '@solana/spl-token';
import bs58 from 'bs58';

const DEFAULT_DEAD_WALLET = '1nc1nerator11111111111111111111111111111111';

export function getKeypair() {
  const secret = process.env.SOLANA_SECRET_KEY;
  if (!secret) {
    throw new Error('SOLANA_SECRET_KEY is required for live burns.');
  }

  if (secret.trim().startsWith('[')) {
    const parsed = JSON.parse(secret);
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  return Keypair.fromSecretKey(bs58.decode(secret));
}

export function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
}

export async function getTokenProgramId({ connection, mint }) {
  const mintKey = new PublicKey(mint);
  const mintAccount = await connection.getAccountInfo(mintKey, 'confirmed');
  if (!mintAccount) {
    throw new Error(`Mint account not found: ${mint}`);
  }

  if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID;
  }

  if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }

  throw new Error(`Unsupported token program for mint ${mint}: ${mintAccount.owner.toBase58()}`);
}

export function getWalletTokenAccount({ owner, mint, tokenProgramId = TOKEN_2022_PROGRAM_ID }) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    owner,
    false,
    tokenProgramId
  );
}

export async function getTokenAccountBalance({ connection, tokenAccount }) {
  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

export async function sendToDeadWallet({ mint, amountRaw, lamports, connection, keypair }) {
  const activeConnection = connection ?? getConnection();
  const payer = keypair ?? getKeypair();
  const deadWallet = new PublicKey(process.env.DEAD_WALLET ?? DEFAULT_DEAD_WALLET);

  if (lamports) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: deadWallet,
        lamports: Number(lamports)
      })
    );
    const signature = await sendAndConfirmTransaction(activeConnection, tx, [payer]);
    return {
      signature,
      lamports: String(lamports),
      displayAmount: (Number(lamports) / LAMPORTS_PER_SOL).toLocaleString(undefined, {
        maximumFractionDigits: 9
      })
    };
  }

  if (!mint || !amountRaw) {
    throw new Error('A token mint and amountRaw, or SOL lamports, are required.');
  }

  if (BigInt(amountRaw) <= 0n) {
    throw new Error('Bought-back token amount is zero; nothing to send to the dead wallet.');
  }

  const mintKey = new PublicKey(mint);
  const tokenProgramId = await getTokenProgramId({ connection: activeConnection, mint });
  const sourceAta = getAssociatedTokenAddressSync(
    mintKey,
    payer.publicKey,
    false,
    tokenProgramId
  );
  const deadAta = getAssociatedTokenAddressSync(
    mintKey,
    deadWallet,
    true,
    tokenProgramId
  );

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      deadAta,
      deadWallet,
      mintKey,
      tokenProgramId
    ),
    createTransferInstruction(
      sourceAta,
      deadAta,
      payer.publicKey,
      BigInt(amountRaw),
      [],
      tokenProgramId
    )
  );

  const signature = await sendAndConfirmTransaction(activeConnection, tx, [payer]);
  return { signature, mint, amountRaw: String(amountRaw) };
}

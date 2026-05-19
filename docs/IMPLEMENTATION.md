# Dragon Treasury Implementation Guide

This document explains how to implement a Dragon-style treasury system: claim Pump.fun/PumpDev creator fees, use a configurable share of the claimed SOL to buy back a target SPL token, and transfer the bought tokens to a dead wallet with public transaction logs.

This is not a token supply burn instruction. The system creates a verifiable dead-wallet transfer trail. Tokens remain on-chain, but they are moved to an address intended to be unrecoverable.

## Architecture

The system has four core parts:

1. **Scheduler**
   - Runs inside the Node.js backend.
   - Starts an interval based on `CLAIM_INTERVAL_MINUTES`.
   - Optionally runs once at startup with `RUN_CLAIM_ON_START=true`.
   - Prevents overlapping claim cycles with an in-memory `claimInProgress` lock.

2. **PumpDev flow**
   - Calls PumpDev claim endpoint to create a claim transaction.
   - Signs and sends that transaction with the configured Solana treasury wallet.
   - Calculates how much SOL was claimed by comparing wallet balance before and after claim confirmation.
   - Calls PumpDev trade-local endpoint to create a buy transaction for the configured token mint.
   - Signs and sends the buy transaction.
   - Calculates bought token amount by comparing the wallet's associated token account balance before and after the buy.

3. **Dead-wallet transfer**
   - Resolves the token program for the mint: SPL Token or Token-2022.
   - Derives the wallet ATA and dead-wallet ATA.
   - Adds an idempotent instruction to create the dead-wallet ATA if needed.
   - Transfers the bought token amount to the dead-wallet ATA.

4. **Telemetry and logs**
   - Stores local JSON logs at `data/logs.json`.
   - Writes logs through `logs.json.tmp` and renames into place.
   - Keeps the newest 250 events.
   - Exposes JSON endpoints for dashboards and monitoring.

## Runtime Flow

Each cycle follows this sequence:

1. Check `claimInProgress`.
2. If another cycle is active, append a `skipped` log and stop.
3. Load Solana connection and signing key in live mode.
4. Request a PumpDev claim transaction.
5. Sign and submit the claim transaction.
6. Confirm the claim transaction.
7. Compute `lamportsClaimed = max(0, balanceAfterClaim - balanceBeforeClaim)`.
8. Compute buyback spend:

   ```text
   availableLamports = max(0, lamportsClaimed - SOL_RESERVE_LAMPORTS)
   lamportsToSpend = floor(availableLamports * BUYBACK_BPS / 10000)
   ```

9. If `lamportsToSpend` is zero, return a zero buyback result.
10. Resolve the token program for `DRGN_MINT`.
11. Read wallet token balance before buyback.
12. Request a PumpDev local buy transaction with SOL-denominated amount.
13. Sign, submit, and confirm the buy transaction.
14. Read wallet token balance after buyback.
15. Compute `amountRaw = tokenBalanceAfter - tokenBalanceBefore`.
16. Transfer `amountRaw` tokens to the configured dead wallet.
17. Append a `burned` log containing claim, buyback, and dead-wallet signatures.
18. Clear `claimInProgress`.

## Required Environment

Minimum simulation setup:

```env
DRAGON_MODE=simulate
PORT=8795
HOST=0.0.0.0
FRONTEND_ORIGIN=http://localhost:5180
AUTO_CLAIM_ENABLED=true
CLAIM_INTERVAL_MINUTES=5
RUN_CLAIM_ON_START=false
```

Minimum live setup:

```env
DRAGON_MODE=live
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_SECRET_KEY=
DRGN_MINT=
DRGN_DECIMALS=6
DEAD_WALLET=1nc1nerator11111111111111111111111111111111
BUYBACK_BPS=9500
SOL_RESERVE_LAMPORTS=20000000
BUYBACK_SLIPPAGE=15
PUMPDEV_API_URL=https://pumpdev.io
PUMPDEV_CLAIM_PRIORITY_FEE=0.0001
PUMPDEV_TRADE_PRIORITY_FEE=0.0005
```

Use a dedicated treasury wallet. Do not reuse a wallet that holds unrelated funds.

## Configuration Validation

Validate configuration at process startup. Do not wait until a scheduled live transaction is already in progress.

Recommended constraints:

| Variable | Constraint |
| --- | --- |
| `PORT` | integer from `1` to `65535` |
| `CLAIM_INTERVAL_MINUTES` | finite number greater than or equal to `1` |
| `AUTO_CLAIM_ENABLED` | exact string `true` or `false` |
| `RUN_CLAIM_ON_START` | exact string `true` or `false` |
| `DRGN_DECIMALS` | integer from `0` to `18` |
| `BUYBACK_BPS` | integer from `0` to `10000` |
| `SOL_RESERVE_LAMPORTS` | integer greater than or equal to `0` |
| `BUYBACK_SLIPPAGE` | finite number greater than or equal to `0` |
| PumpDev priority fees | finite number greater than or equal to `0` |

In live mode, require:

- `SOLANA_SECRET_KEY`
- `DRGN_MINT`
- `SOLANA_RPC_URL`, unless you intentionally accept the default public RPC

## Wallet Key Handling

Support two formats:

1. Base58-encoded secret key.
2. JSON array secret key, for example `[1,2,3,...]`.

Implementation notes:

- Parse JSON-array keys with `JSON.parse` and `Uint8Array.from`.
- Parse base58 keys with `bs58.decode`.
- Create the signer with `Keypair.fromSecretKey`.
- Never expose the secret key in logs, frontend payloads, errors, or Git history.

## Solana Token Handling

The token mint may use either SPL Token or Token-2022. Detect this by fetching the mint account and checking its owner:

- `TOKEN_PROGRAM_ID`
- `TOKEN_2022_PROGRAM_ID`

Use the detected program ID everywhere:

- wallet ATA derivation
- dead-wallet ATA derivation
- idempotent ATA creation
- transfer instruction

For dead-wallet ATA derivation, allow owner off curve:

```ts
getAssociatedTokenAddressSync(mintKey, deadWallet, true, tokenProgramId)
```

## PumpDev Integration

Claim creator fees:

```http
POST /api/claim-account
Content-Type: application/json
```

Typical body:

```json
{
  "publicKey": "TREASURY_WALLET_PUBLIC_KEY",
  "priorityFee": 0.0001
}
```

If fee sharing mint is required, include:

```json
{
  "mint": "PUMPFUN_FEE_SHARING_MINT"
}
```

Buy back the target token:

```http
POST /api/trade-local
Content-Type: application/json
```

Typical body:

```json
{
  "publicKey": "TREASURY_WALLET_PUBLIC_KEY",
  "action": "buy",
  "mint": "TARGET_TOKEN_MINT",
  "amount": 0.05,
  "denominatedInSol": "true",
  "slippage": 15,
  "priorityFee": 0.0005
}
```

Both endpoints return serialized transaction bytes. Deserialize with `VersionedTransaction.deserialize`, sign with the treasury keypair, and send through the configured RPC connection.

## API Contract

Expose these read-only endpoints:

```http
GET /api/health
```

Response fields:

```json
{
  "ok": true,
  "mode": "simulate",
  "autoClaimEnabled": true,
  "claimIntervalMinutes": 5,
  "claimInProgress": false,
  "lastClaimAttemptAt": null,
  "lastSuccessfulClaimAt": null,
  "nextAutoClaimAt": "2026-05-19T00:00:00.000Z"
}
```

```http
GET /api/stats
```

Response fields:

```json
{
  "events": 1,
  "rawByAsset": {
    "TOKEN_MINT": "777000000"
  },
  "lastBurnAt": "2026-05-19T00:00:00.000Z",
  "logs": [],
  "autoClaimEnabled": true,
  "claimIntervalMinutes": 5,
  "claimInProgress": false,
  "lastClaimAttemptAt": "2026-05-19T00:00:00.000Z",
  "lastSuccessfulClaimAt": "2026-05-19T00:00:00.000Z",
  "nextAutoClaimAt": "2026-05-19T00:05:00.000Z"
}
```

```http
GET /api/logs
```

Returns an array of log entries.

Do not expose a public manual trigger route unless it is authenticated, rate limited, and protected against repeated transaction submission.

## Log Schema

Recommended log object:

```json
{
  "id": "uuid",
  "createdAt": "2026-05-19T00:00:00.000Z",
  "status": "burned",
  "mode": "live",
  "source": "pump.fun fees",
  "trigger": "interval",
  "destination": "DEAD_WALLET",
  "mint": "TOKEN_MINT",
  "amountRaw": "777000000",
  "lamports": null,
  "decimals": 6,
  "lamportsClaimed": "50000000",
  "lamportsSpent": "28500000",
  "claimSignature": "CLAIM_TX",
  "buySignature": "BUY_TX",
  "burnSignature": "DEAD_WALLET_TRANSFER_TX"
}
```

Failure log:

```json
{
  "id": "uuid",
  "createdAt": "2026-05-19T00:00:00.000Z",
  "status": "failed",
  "mode": "live",
  "source": "pump.fun fees",
  "trigger": "interval",
  "error": "error message"
}
```

Skipped log:

```json
{
  "id": "uuid",
  "createdAt": "2026-05-19T00:00:00.000Z",
  "status": "skipped",
  "mode": "live",
  "source": "pump.fun fees",
  "trigger": "interval",
  "error": "Previous claim cycle is still running."
}
```

## Dashboard Implementation

A dashboard only needs `/api/stats`.

Display:

- total bought-back token amount by mint
- latest claimed SOL
- latest spent SOL
- event count
- last successful transfer time
- scheduler status
- recent logs with transaction signatures
- mint address
- dead-wallet destination
- GitHub and social links

Token formatting:

```text
display = amountRaw / 10^decimals
```

Keep raw strings in API responses. Convert to display strings in the frontend to avoid precision loss.

## Security Checklist

- Use a dedicated treasury wallet.
- Keep only enough SOL for operating reserve and expected fees.
- Store secrets outside Git.
- Do not serve `.env`, logs containing secrets, or private keys.
- Restrict CORS with `FRONTEND_ORIGIN`.
- Use a private or paid RPC in live mode.
- Start with `DRAGON_MODE=simulate`.
- Test with `RUN_CLAIM_ON_START=true` only in simulation first.
- Confirm the mint, decimals, dead wallet, buyback basis points, reserve, and slippage before live mode.
- Monitor the first live cycle manually.
- Do not expose a public write endpoint that can trigger claims.

## Deployment Checklist

1. Install Node.js 18 or newer.
2. Clone the repository.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Fill in live-mode settings.
6. Run `npm run typecheck`.
7. Run `npm run build`.
8. Start with `DRAGON_MODE=simulate`.
9. Verify `/api/health`.
10. Verify `/api/stats`.
11. Switch to `DRAGON_MODE=live` only after confirming wallet, mint, and RPC.
12. Run under a process manager such as systemd or PM2.
13. Configure reverse proxy and TLS if exposing publicly.
14. Watch logs and transaction signatures after deployment.

## Failure Modes

Common failures and mitigations:

| Failure | Cause | Mitigation |
| --- | --- | --- |
| Claim request fails | PumpDev unavailable or rejected payload | Log failure and retry next interval |
| Transaction confirmation stalls | RPC congestion or blockhash expiry | Use reliable RPC and monitor send/confirm errors |
| Buyback amount is zero | Claimed SOL did not exceed reserve | Log zero buyback or skip dead-wallet transfer |
| Token account missing | ATA not created yet | Derive ATA and use idempotent ATA creation |
| Unsupported token program | Mint owner is not SPL Token or Token-2022 | Fail before transfer |
| JSON log corruption | Process interrupted during write | Write temp file and rename |
| Repeated overlapping cycles | Interval shorter than transaction runtime | Use claim lock and skipped logs |

## Recommended Extensions

- Store logs in SQLite or Postgres for long-running deployments.
- Add authenticated manual trigger endpoint for operators.
- Add webhook notifications for failed cycles.
- Add RPC health checks to `/api/health`.
- Add Prometheus metrics.
- Add tests for config validation, log aggregation, and zero-buyback behavior.
- Confirm transactions with blockhash and `lastValidBlockHeight`.
- Add explorer links for claim, buyback, and dead-wallet transfer signatures.

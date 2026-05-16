# Dragon Treasury System

Dragon Treasury is a small Node.js backend for running a Pump.fun creator-fee buyback and burn flow on Solana.

The service can run in two modes:

- `simulate`: uses fake claim, buyback, and burn values so you can test the API and logs without spending funds.
- `live`: claims Pump.fun/PumpDev creator fees, buys the configured token, and sends the bought tokens to a dead wallet.

Use live mode carefully. It signs transactions with the configured wallet and can move real SOL and tokens.

## What It Does

On each claim cycle, the backend:

1. Claims available creator fees through PumpDev.
2. Uses the claimed SOL, minus a reserve, to buy the configured token.
3. Transfers the bought tokens to the configured dead wallet.
4. Stores a local JSON log with transaction signatures and amounts.

The project exposes JSON endpoints that a dashboard, script, or monitoring tool can read.

## Project Layout

```text
src/server.js        Express API, scheduler, and claim loop
src/pumpfunClaim.js  PumpDev claim and buyback transaction flow
src/solanaBurn.js    Solana wallet, token account, and burn transfer helpers
src/logStore.js      Local JSON log store
```

## Requirements

- Node.js 18 or newer
- npm
- A Solana RPC endpoint for live mode
- A funded Solana wallet for live mode

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Start in simulation mode:

```bash
npm run dev
```

The API listens on `http://localhost:8795` by default.

## Environment

Common settings:

| Variable | Default | Notes |
| --- | --- | --- |
| `DRAGON_MODE` | `simulate` | Set to `live` only when the wallet and mint are ready. |
| `PORT` | `8795` | Backend HTTP port. |
| `HOST` | `0.0.0.0` | Backend bind address. |
| `FRONTEND_ORIGIN` | `http://localhost:5180` | Comma-separated CORS allowlist. |
| `AUTO_CLAIM_ENABLED` | `true` | Set to `false` to disable the interval loop. |
| `CLAIM_INTERVAL_MINUTES` | `5` | Delay between automatic claim cycles. |
| `RUN_CLAIM_ON_START` | `false` | Set to `true` to run one cycle at startup. |

Live-mode settings:

| Variable | Notes |
| --- | --- |
| `SOLANA_SECRET_KEY` | Wallet secret key as a base58 string or JSON array. Required in live mode. |
| `SOLANA_RPC_URL` | RPC endpoint. Defaults to Solana mainnet public RPC. |
| `DRGN_MINT` | Token mint to buy back and burn. Required for live buybacks. |
| `DRGN_DECIMALS` | Token decimals used for log metadata. |
| `DEAD_WALLET` | Burn destination. Defaults to `1nc1nerator11111111111111111111111111111111`. |
| `PUMPFUN_FEE_SHARING_MINT` | Optional Pump.fun fee-sharing mint passed to PumpDev. |
| `BUYBACK_BPS` | Share of claimable SOL used for buyback after reserve. `9500` means 95%. |
| `SOL_RESERVE_LAMPORTS` | SOL left in the wallet before calculating the buyback amount. |
| `BUYBACK_SLIPPAGE` | Slippage value sent to PumpDev trade-local. |
| `PUMPDEV_CLAIM_PRIORITY_FEE` | Priority fee for claim transactions. |
| `PUMPDEV_TRADE_PRIORITY_FEE` | Priority fee for buyback transactions. |

Simulation-only settings:

| Variable | Notes |
| --- | --- |
| `BURN_MINT` | Fake mint label used in simulation logs. |
| `BURN_AMOUNT_RAW` | Fake token amount used in simulation logs. |
| `BURN_SOL_LAMPORTS` | Fake SOL amount used in simulation logs. |

## API

```http
GET /api/health
```

Returns service mode, scheduler state, and basic health.

```http
GET /api/stats
```

Returns aggregate burn stats and recent logs.

```http
GET /api/logs
```

Returns stored claim and burn events.

```http
POST /api/claim-and-burn
```

Runs one manual claim cycle. In `simulate` mode this records a fake event. In `live` mode it signs and submits real transactions.

## Data

Logs are stored at `data/logs.json`. The file is created automatically and is ignored by Git so local runtime history is not committed.

## Safety Checklist Before Live Mode

- Test `/api/claim-and-burn` in `simulate` mode first.
- Use a dedicated wallet with only the funds needed for this service.
- Confirm `DRGN_MINT`, `DEAD_WALLET`, and `SOLANA_RPC_URL`.
- Start with a conservative `BUYBACK_BPS`, reserve, and interval.
- Watch the logs and transaction signatures during the first live cycle.

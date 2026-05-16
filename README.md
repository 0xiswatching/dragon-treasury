# Dragon Treasury System 🐉

This repository serves as an educational reference for building a fully automated "buyback and burn" (or "void transfer") treasury system on the Solana blockchain, specifically tailored for tokens launched via Pump.fun.

## Overview

The Dragon Treasury doesn't rely on hidden burn switches or centralized human execution. Instead, it is an automated backend engine that runs on a timed flight cycle to:

1. **Claim Fee Treasure:** Interacts with the Pump.fun API to claim accrued creator fees (in SOL).
2. **Buyback:** Uses the claimed SOL to automatically buy back the native token (e.g., $DRGN) from the market.
3. **Eject to the Void:** Transfers the bought-back tokens to an irretrievable "dead wallet" (the incinerator).
4. **Log & Verify:** Records every transaction signature, creating an on-chain, verifiable trail into the void.

This repository focuses on the backend implementation of this logic.

## Architecture & Code Structure

The core engine is located in the `backend/src/` folder:

*   **`server.js`**: The main Express application that acts as the scheduler and API endpoint for the treasury. It handles the continuous loops (the "flight cycle") and provides telemetry data (stats/logs).
*   **`pumpfunClaim.js`**: Contains the logic for interacting with the PumpDev API to claim trading fees and execute the buyback swap using a designated slippage and priority fee.
*   **`solanaBurn.js`**: Handles the direct Solana blockchain interactions. It resolves token program IDs (supporting both SPL Token and Token-2022 standards), determines associated token accounts (ATAs), and securely signs the transfer of tokens to the dead wallet (`1nc1nerator11111111111111111111111111111111`).
*   **`logStore.js`**: A lightweight local JSON datastore used to maintain the history of treasury events, allowing for frontend dashboards to easily read the "Mission Logs".

## Educational Value

Developers can study this codebase to learn how to:

*   Construct and serialize/deserialize versioned transactions on Solana.
*   Work programmatically with both SPL-Token and Token-2022 programs.
*   Calculate Associated Token Accounts (ATAs) and craft Idempotent ATA creation instructions within complex transactions.
*   Integrate with the Pump.fun / PumpDev ecosystem for automated fee claiming and trading.
*   Securely manage a hot wallet environment in a Node.js process using environment variables and `bs58` keypair decoding.

## Local Setup

To run this backend locally:

1. Copy `.env.example` (or configure your own `.env` in `backend/`) with your `SOLANA_SECRET_KEY`, `DRGN_MINT`, etc.
2. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
3. Start the engine in simulation or live mode:
   ```bash
   DRAGON_MODE=simulate npm start
   ```

*Note: The frontend dashboard logic has been excluded from this educational repository.*
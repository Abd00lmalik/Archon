# Oris

Oris is a full-stack Web3 dApp for **verifiable work provenance** on the ARC ecosystem.

Agents cannot self-claim work history. Credentials are minted only when a client-approved job lifecycle completes on-chain.

## What Oris Does

- Clients create jobs on-chain.
- Agents accept jobs and submit deliverables.
- Clients approve completed jobs.
- A hook contract triggers credential issuance.
- Credentials become permanent, queryable on-chain records tied to `(agent, jobId)`.

Tagline: **Verifiable work. On-chain.**

---

## Architecture

### Smart Contracts (`/contracts`)

- `MockERC8183Job.sol`
  - Job lifecycle: `createJob`, `acceptJob`, `submitDeliverable`, `approveJob`
- `CredentialHook.sol`
  - Hook bridge called on job completion
- `MockERC8004ValidationRegistry.sol`
  - Credential registry and verification methods

### Frontend (`/frontend`)

- Next.js App Router + TypeScript
- ethers v6 wallet + contract interaction layer
- Real-time listeners for job and credential events
- Premium Oris theme + custom logo system

---

## Key Flow

1. Client creates job
2. Agent accepts job
3. Agent submits deliverable proof
4. Client approves job
5. Hook calls registry
6. Credential appears in profile and is verifiable on-chain

---

## Project Structure

```text
.
+- contracts/
¦  +- contracts/
¦  +- scripts/
¦  +- test/
¦  +- hardhat.config.ts
+- frontend/
¦  +- public/
¦  ¦  +- logo.svg
¦  ¦  +- logo-icon.svg
¦  ¦  +- favicon.ico
¦  +- src/
¦  +- next.config.ts
+- scripts/
¦  +- dev.mjs
+- package.json
+- README.md
```

---

## Local Development

From repo root:

```bash
npm install
npm run dev
```

`npm run dev` will:

- reuse/start local Hardhat RPC (`127.0.0.1:8545`)
- deploy contracts
- write generated frontend contract config
- start Next.js dev server

Note: if port `3000` is occupied, Next.js automatically chooses another available port.

---

## Manual Commands

```bash
# Start local chain
npm run chain

# Deploy contracts to local chain
npm run deploy:contracts

# Start frontend only
npm run dev:frontend

# Build frontend
npm run build --workspace frontend

# Run contract tests
npm test
```

---

## Arc Testnet Deployment

Create `contracts/.env`:

```bash
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

Deploy:

```bash
npm run deploy:arc
```

This writes deployment output to:

- `contracts/deployments/arcTestnet.json`
- `frontend/src/lib/generated/contracts.json`

---

## Frontend Environment

Production env template (`frontend/.env.production`):

```bash
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_CHAIN_ID=5042002
NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_CHAIN_ID=5042002
```

---

## Verification & Quality Checks

```bash
cd frontend && npx tsc --noEmit
npm run build --workspace frontend
npm test
```

---

## Branding Assets

- Main mark: `frontend/public/logo.svg`
- Icon mark: `frontend/public/logo-icon.svg`
- Favicon: `frontend/public/favicon.ico`

---

## License

MIT
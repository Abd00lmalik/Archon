# AgriChain Settlement - Solana Integration

## Why Solana Is Needed

AgriChain Settlement is a Solana product because the core workflow depends on fast, low-cost, programmable settlement. The product is not just a dashboard for shipment data. The most important state transition is payment settlement: an importer funds escrow, shipment conditions are verified, and funds are released to the exporter with an auditable transaction trail.

Solana is a strong fit because it supports low-fee token transfers, wallet-based user actions, fast confirmation, programmatic escrow logic, and transaction receipts that can be linked directly to shipment records.

## Wallets

The MVP will use Solana wallet connection for exporter, importer, and verifier actions. Users will connect through common Solana wallets such as Phantom or Solflare using Solana wallet adapter tooling.

Wallets will be used to:

- Identify the exporter receiving settlement.
- Identify the importer funding escrow.
- Sign transaction requests.
- Show the connected user's role and shipment responsibilities.
- Link settlement receipts to real wallet addresses.

## SPL Token Payments

The importer will fund a shipment-specific escrow using an SPL token. For the MVP and demo, this can use a devnet SPL token or stablecoin-style test token. The production direction would be stablecoin settlement, such as USDC or another accepted Solana stablecoin.

The payment flow will include:

- Token mint selection for the demo environment.
- Importer token account detection or creation.
- Escrow funding transaction.
- Balance and payment status updates in the dashboard.
- Exporter payout transaction after verification.

## Escrow Logic

Each shipment will have an escrow state connected to a specific shipment ID. The escrow record will track:

- Shipment reference.
- Importer wallet.
- Exporter wallet.
- Verifier wallet or release authority.
- Token mint.
- Escrow amount.
- Funding status.
- Verification status.
- Release status.
- Relevant transaction signatures.

The MVP can implement escrow in the simplest secure form that is realistic for a one-month build. The target design is a shipment-specific escrow vault controlled by program logic or a constrained release authority. Funds are not released until the required verification step is completed. The important product behavior is that payment release is tied to shipment conditions and produces a visible on-chain settlement event.

## Transaction Receipts

The app will display and store Solana transaction signatures for the major workflow events:

- Shipment creation or registration event, if represented on-chain.
- Document hash registration.
- Escrow funding.
- Verification or release approval.
- Escrow payout to exporter.

The settlement receipt will include transaction signatures, wallet addresses, shipment status, token amount, document hashes, release timestamp, and links to a Solana explorer. This gives the exporter and importer a shared proof of settlement.

## Shipment-Linked Settlement

The central Solana integration is shipment-linked settlement. Payment state will not live separately from the trade workflow. Each escrow will be attached to a shipment record, and each release will correspond to verified document and delivery conditions.

This makes the MVP meaningfully on-chain because the shipment workflow depends on Solana transactions for escrow funding, release, and settlement proof.


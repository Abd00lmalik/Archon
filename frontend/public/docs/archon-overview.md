# Archon Overview

Archon is a multi-source on-chain reputation platform built on Arc testnet. It turns real contribution into verifiable credentials and then aggregates those credentials into a weighted reputation score. Instead of relying on screenshots, endorsements, or platform-controlled databases, Archon records proof of work through contract-enforced workflows.

At the center of the system are three layers:

1. **Source contracts** verify different kinds of work.
2. **CredentialHook** receives completion calls from registered source contracts.
3. **ERC8004ValidationRegistry** stores permanent credential records.

A credential contains the agent wallet, activity ID, source type, issuer, timestamp, validity flag, and weight. Reputation is the sum of credential weights, capped at 2000 points. Current tiers are:
- Surveyor (0�99)
- Draftsman (100�299)
- Architect (300�599)
- Master Builder (600�999)
- Keystone (1000�1499)
- Arc Founder (1500+)

## Sources of Credentials

Archon currently supports six source types at contract level:
- **Tasks (`ERC8183Job`)**: client posts USDC pool, contributors submit links, client approves/rejects, approved contributor claims reward + credential.
- **Agentic Tasks (`AgentTaskSource`)**: structured tasks with input/output and validation, then reward + credential claim.
- **Community (`CommunitySource`)**: users submit applications, active moderators approve/reject, approved recipient claims credential.
- **Peer Attestation (`PeerAttestationSource`)**: high-trust social vouching, gated to wallets with weighted score >= 1000.
- **DAO Governance (`DAOGovernanceSource`)**: trustless credential claim when user has voted in approved governor contract.
- **GitHub (`GitHubSource`)**: verifier-reviewed flow exists on-chain; current frontend guides users through task deliverables instead of direct GitHub claim UI.

## USDC and Escrow

USDC is used in regular tasks, agentic tasks, and milestone contracts.
- Task/job and agentic-task rewards are escrowed upfront in their contracts.
- On payout, platform fee is split first, then net is paid to contributor.
- Job and agent-task platform fee target is configured at 1000 bps (10%) in current deployment config.
- Treasury in current deployment config is `0x25265b9dBEb6c653b0CA281110Bb0697a9685107`.

Milestone contracts (`/milestones` route, labeled �Smart Contracts� in page header) support multi-milestone escrow and disputes. If a dispute is raised within 48 hours of submission, three arbitrators vote; majority outcome decides payout vs refund. If the client is inactive for 48 hours and no dispute exists, freelancer can auto-release.

## Anti-Gaming Design

Archon enforces multiple controls:
- Source-operator approval in `SourceRegistry`
- Minimum stake per job
- Time locks (`MIN_JOB_DURATION`, `MIN_REVIEW_DELAY`)
- Global 6-hour credential cooldown
- Per-job approval cap and per-submission reward allocation checks
- Suspicion score signals for fast/high-volume patterns
- Strict peer attestation limits (weekly caps, mutual-attestation block, minimum note length)

## Deployment Snapshot (from generated contracts config)

- Network: `arc_mainnet`
- Chain ID: `5042`
- RPC URL: `https://rpc.mainnet.arc.io`
- Explorer: `https://explorer.arc.io`
- USDC: `0x3600000000000000000000000000000000000000`

Key deployed addresses include SourceRegistry, ValidationRegistry, CredentialHook, ERC8183Job, AgentTaskSource, CommunitySource, PeerAttestationSource, DAOGovernanceSource, GitHubSource, and MilestoneEscrow.

In short: Archon is designed to make reputation portable, auditable, and economically grounded, while keeping verification logic transparent at contract level.

# Archon

Archon is an on-chain provenance dApp that turns completed work into verifiable credentials.

Instead of trusting self-reported reputation, Archon binds proof of completion to blockchain state transitions:

1. A client creates a job.
2. An agent accepts and submits a deliverable.
3. The client approves the submission.
4. A hook contract mints a credential in a registry.
5. Anyone can verify that `(agentAddress, jobId)` has an issued credential.

## Core Problem Solved

In agent and freelancer ecosystems, reputation can be fabricated by off-chain claims. Archon removes that trust gap by making credential issuance a contract-enforced consequence of a completed job lifecycle.

## On-Chain System Design

Archon uses three contracts with separated responsibilities.

### 1) `ERC8183Job.sol` (Job Lifecycle Contract)

This contract owns job state and enforces lifecycle transitions.

#### Job Model

Each job stores:

- `jobId`: monotonically increasing identifier
- `client`: address that created the job
- `agent`: address that accepted the job
- `title`: job title
- `description`: job description
- `deliverableHash` (or deliverable reference string): agent-submitted work reference
- `status`: enum state
- `createdAt`: creation timestamp
- `approvedAt`: approval timestamp

#### State Machine

- `Open` -> initial state after `createJob`
- `InProgress` -> after `acceptJob`
- `Submitted` -> after `submitDeliverable`
- `Approved` -> after `approveJob`
- `Rejected` -> optional terminal path

#### State Transition Rules

- `createJob(...)`
  - caller becomes `client`
  - initializes state to `Open`
- `acceptJob(jobId)`
  - allowed only when job is `Open`
  - sets `agent = msg.sender`
  - moves to `InProgress`
- `submitDeliverable(jobId, deliverableRef)`
  - allowed only by assigned `agent`
  - allowed only when state is `InProgress`
  - stores deliverable reference
  - moves to `Submitted`
- `approveJob(jobId)`
  - allowed only by `client`
  - allowed only when state is `Submitted`
  - sets `approvedAt`
  - moves to `Approved`
  - triggers hook call to mint credential

### 2) `CredentialHook.sol` (Completion Hook)

This contract is the trust bridge between job completion and credential minting.

Responsibilities:

- Accept completion calls from authorized job contracts only
- Forward mint requests to the validation registry
- Prevent arbitrary addresses from issuing credentials directly

Typical guarded flow:

- Job contract calls `onJobComplete(agent, jobId)`
- Hook validates caller authorization
- Hook calls registry `issue(agent, jobId)`

### 3) `ERC8004ValidationRegistry.sol` (Credential Registry)

This contract persists and exposes credential truth.

#### Credential Model

Each credential includes:

- `credentialId`
- `agent`
- `jobId`
- `issuedAt`
- `issuedBy` (hook/issuer)
- `valid`

#### Key Mappings

- `credentialsByAgent[address] -> uint256[]`
  - list of job IDs or credential references tied to an agent
- `credentialId[agent][jobId] -> uint256`
  - uniqueness guard for `(agent, jobId)`
- `credentials[credentialId] -> Credential`

#### Registry Guarantees

- No duplicate credential for same `(agent, jobId)` pair
- Queryable existence via `hasCredential(agent, jobId)`
- Indexed retrieval via `getCredentialsByAgent(agent)`

## Credential Issuance Pipeline

The critical pipeline is deterministic and contract-enforced:

1. `createJob` emits `JobCreated`
2. `acceptJob` emits `JobAccepted`
3. `submitDeliverable` emits `DeliverableSubmitted`
4. `approveJob` emits `JobApproved`
5. `approveJob` calls hook `onJobComplete`
6. hook calls registry `issue`
7. registry emits `CredentialIssued`

The credential only exists if the full sequence executed successfully on-chain.

## Frontend Architecture

Frontend is a Next.js + TypeScript app with ethers v6 and wallet-driven execution.

### Contract Access Layer (`frontend/lib/contracts.ts`)

This module centralizes:

- contract instantiation
- typed fetchers (`fetchAllJobs`, `fetchJob`, `fetchCredentialsForAgent`)
- transaction wrappers (`txCreateJob`, `txSubmitDeliverable`, `txApproveJob`)
- event parsing from transaction receipts

It normalizes tuple-like contract outputs into app-friendly models (`Job`, `Credential`).

### Wallet and Network Layer

Wallet context and layout components coordinate:

- account connect/disconnect
- chain awareness
- wrong-network detection
- network switching UX

### Event Layer (`frontend/lib/events.ts`)

Real-time listeners subscribe to contract events so UI updates without manual refresh.

- new jobs appear on the home feed
- job status updates propagate on detail pages
- newly minted credentials appear in profile timeline

## UI Route Responsibilities

- Home: read and stream job feed
- Create Job: write `createJob` transactions
- Submit Work: write `submitDeliverable` transactions
- Approve Job: write `approveJob` transactions and surface resulting credential info
- Profile: aggregate credentials and verification state per wallet
- Job Detail: display lifecycle progress and live status

## Verification Model

Archon supports two complementary verification paths:

1. State verification (primary):
   - `hasCredential(agent, jobId)` must return `true`
2. Record verification:
   - retrieve credential object and inspect issuer, timestamps, validity

This enables third parties to validate provenance directly from chain state.

## Security and Integrity Properties

- Lifecycle gating prevents out-of-order actions
- Role checks prevent unauthorized submission/approval
- Issuer authorization restricts minting to approved hook path
- Duplicate guard prevents replay issuance for same work
- Event trail provides auditable lifecycle history

## Scalability Notes

Current design is MVP-first and intentionally simple:

- Registry and lifecycle logic are explicit and readable
- Frontend reads are bounded and event-assisted
- Architecture is ready for future upgrades (DID binding, richer metadata, cross-chain mirrors)

## Why Archon Is Trust-Minimizing

Archon does not ask users to trust a platform database or self-attestation.

Reputation is derived from:

- explicit on-chain workflow completion,
- contract-enforced authority boundaries,
- immutable credential records tied to wallet identity.

That makes Archon suitable as a verifiable provenance primitive for agent ecosystems, DAOs, and on-chain labor markets.


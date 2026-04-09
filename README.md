# Archon: Multi-Source On-Chain Reputation

Archon is a multi-source on-chain reputation platform built on the Arc Testnet. It enables users to earn verifiable credentials through task completion, agentic workflows, community contributions, peer attestations, and DAO governance participation.

**Live App:** [https://archon-dapp.vercel.app](https://archon-dapp.vercel.app)

**Network:** Arc Testnet (Chain ID: 5042002)

---

## Deployed Contracts (Arc Testnet)

| Contract | Address |

| :--- | :--- |

| SourceRegistry | `0xa25C501C62e60EF1F03c37400b4FBDf2775d18Bf` |

| ValidationRegistry | `0xCC2813327a5e2ce43a7bf78ed59d2D21BBB66b1B` |

| CredentialHook | `0x23d66b8eb42Cc1f51F37b879A3dbC15252684Db2` |

| ERC8183Job | `0xE57DE7e8dA52e76f8Ab9b88697306Ef49Fa633b9` |

| GitHubSource | `0xa67851a3DaFF1a3082e30ab1E5bd0B3fDBE21b55` |

| CommunitySource | `0x0a7c1B0dB4Cc6bE3A95e5BC1B99065b91b725353` |

| AgentTaskSource | `0xbE7e13b78DA31b1249B52083C4B4eF02FE9a6A21` |

| PeerAttestationSource | `0x6A42a8bFeBE96E94d06C5bcBfA303E984f85Ae27` |

| DAOGovernanceSource | `0xe42Bf6A67899a82E2AA7DE9DE74f8a30a338f457` |

| MilestoneEscrow | `0xb958a8CC159D8E2d079E7f26B9D3E6E8340D5d78` |

| USDC (Arc ERC-20) | `0x3600000000000000000000000000000000000000` |

| Platform Treasury | `0x25265b9dBEb6c653b0CA281110Bb0697a9685107` |

---

## Navigation Guide

* `/` — Tasks home feed, global stats, and open task listings.

* `/earn` — Overview of all credential sources and scoring mechanics.

* `/tasks` — Agentic tasks hub (Available, Active, and Post Task).

* `/my-work` — Personal dashboard for posted and accepted work.

* `/milestones` — Dedicated contracts page for milestone escrow and disputes.

* `/profile` — Wallet profile, reputation score, tiers, and credentials timeline.

* `/apply` — Application portal to become an approved operator.

* `/community` — Community applications and moderator review interface.

* `/attest` — Peer vouching system (Keystone-gated).

* `/governance` — Portal to claim governance participation credentials.

* `/create-job` — Task creation interface (Approved operators only).

* `/job/[jobId]` — Task lifecycle management (Submission, Review, and Claims).

---

## The Problem

Most reputation is easy to fake. Screenshots, self-written profiles, and unverifiable claims are the norm. Good contributors get under-credited. Clients pay for low-quality work. AI agent operators have no way to prove their systems are reliable.

Archon fixes this by enforcing real work events through smart contracts. Credentials are issued by contracts, not people — making them auditable, permanent, and trustless.

---

## How It Works

Every credential source in Archon follows the same pattern:
Real work performed → Contract verifies completion → Credential minted to wallet → Reputation score updated
Credentials are stored as on-chain records keyed to your wallet address. There is no transfer function. There is no delete function. Your reputation trail is append-only and permanent.

---

## Five Ways to Earn Credentials

### 1. Complete Tasks — +100 pts + USDC
Browse open tasks, accept one, submit a deliverable link, and get approved by the task creator. USDC reward is released from escrow on approval.

### 2. Agentic Tasks — +130 pts + USDC
Structured tasks designed for autonomous or semi-autonomous completion. Submit a verifiable output, get validated, claim USDC and credential.

### 3. Community Work — +50 to +120 pts
Apply for a community credential by describing your contribution. Platform moderators review and approve. No USDC — reputation only.

| Activity | Points |
|---|---|
| Helped a community member | 50 |
| Moderated community spaces | 80 |
| Created educational content | 90 |
| Reported a verified bug | 100 |
| Organized a community event | 120 |

### 4. Peer Vouching — +60 pts
Keystone tier members (1000+ pts) can vouch for contributors they have worked with. Attestations are permanent, public, and rate-limited to prevent gaming.

### 5. DAO Governance — +90 pts
Prove you voted on an approved DAO proposal. Verified trustlessly by reading the governor contract directly — no reviewer needed.

---

## Reputation Tiers

| Tier | Points Required | Unlocks |
|---|---|---|
| Surveyor | 0 | — |
| Draftsman | 100 | — |
| Architect | 300 | — |
| Master Builder | 600 | — |
| Keystone | 1000 | Peer attestation |
| Arc Founder | 1500 | — |

Score = sum of all credential weights, capped at 2000.

---

## Milestone Contracts

For formal client-freelancer agreements with staged USDC escrow:

- Client proposes a project with up to 20 milestones
- Each milestone is funded separately to reduce upfront risk
- Freelancer submits deliverable per milestone
- Client approves and funds are released (minus 10% platform fee)
- If client does not respond within 48 hours, freelancer can auto-release
- Disputes go to a panel of 3 approved arbitrators — majority vote decides

---

## Getting Started

### Set Up MetaMask

Add Arc Testnet to MetaMask manually:

| Field | Value |
|---|---|
| Network Name | Arc Testnet |
| RPC URL | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| Currency Symbol | USDC |
| Block Explorer | https://testnet.arcscan.app |

Get testnet USDC from the faucet: **faucet.arc.network**

## USER WHO WANTS TO COMPLETE TASKS AND EARN CREDENTIALS

**Step 1: Connect wallet**

Open home page (/).
Click Connect Wallet in nav.
Approve MetaMask connection.
You now see open task cards with title, reward pool, deadline, and winner cap.
How to read a task card:

Title line: #jobId + title
Reward line: X USDC pool · up to Y winners
Deadline line: local time display
Activity lines: accepted/submissions/approved counts
Buttons: View Job, View & Apply (or View My Submission if you already submitted)

**Step 2: Click a task**

Click View & Apply or View Job.
You land on /job/[jobId].
If you are not the creator, you see agent view (“Your Submission” panel).

**Step 3: Click Accept Task**

Click Accept Task.
MetaMask opens with a transaction to call acceptJob(jobId).
Confirm transaction.
After confirmation, page updates to show submission form.

**Step 4: Submit deliverable**

Enter a URL in “Deliverable Link.”
URL must start with http:// or https://.
Good submission examples:
GitHub PR link
Deployed app link
Notion/public doc link
IPFS gateway URL
Click Submit Work.
MetaMask opens transaction for submitDeliverable(jobId, link).

**Step 5: Wait for review**

Status becomes “Awaiting review.”
Your submitted URL is shown as clickable link.
Creator reviews from their creator view on same task page.

**Step 6: Get approved**

If approved, task page shows approved state.
You see:
Allocated reward amount.
Net amount you receive after platform fee.
Why net is lower:
Platform fee is deducted from allocated reward (default 10% in deployment config).

**Step 7: Click Claim**

Click Claim USDC + Credential.
MetaMask opens claim transaction (claimCredential(jobId)).
On success:
USDC sent to your wallet.
Credential minted via hook + registry.

**Step 8: Check profile**

Open /profile.
New credential appears in timeline.
Score increases by source weight (for job tasks: +100).
Tier and progress bar update automatically.

 ## TASK CREATOR WHO WANTS TO POST A TASK

**Step 1: Apply**

Go to /apply.
You see two cards:
Complete tasks and earn.
Post tasks for others.
Click “Apply to Post Tasks.”

**Step 2: Fill application form**

Name or organization.
What tasks you plan to post.
Profile link (must be valid URL).
Why approve you (minimum 100 chars).
Submit with MetaMask transaction to applyToOperate("task", profileURI).

**Step 3: Wait for approval**

Status shows Pending until approved.
Approval is an admin action on SourceRegistry.
Important repo note: requested approve-operator.ts script is not present in current snapshot, so approval is done by direct contract call or custom script.

**Step 4: Open Create Task page**

Go to /create-job.
Fill fields:
Task title
Description
Deadline
Reward pool in USDC
Max Approvals (how many winners can be approved, 1–20)

**Step 5: Step 1 of 2 — Approve USDC**

If allowance is lower than reward, UI shows Step 1 panel.
You click “Approve X.XX USDC.”
MetaMask opens approve(spender, amount) on USDC.
This gives contract permission to move escrow amount.

**Step 6: Step 2 of 2 — Create Task**

After approval confirms, UI shows “USDC Approved.”
Post Task button unlocks.
Click Post Task.
MetaMask opens task creation transaction.
Task is created with an on-chain job ID.

**Step 7: Task is live**

Status message includes Task ID.
Task appears on home feed.
Share /job/[jobId] link with contributors.

**Step 8: Review submissions**

Open task detail as creator.
You see creator review panel (different from agent panel).
Each submission shows:
Agent wallet
Clickable deliverable URL
Timestamp
Status badge
Suspicion score
Agent completed-count signal

**Step 9: Approve with custom reward**

Enter reward amount per submission (USDC input).
UI shows:
Remaining pool
Agent net payout after fee
Platform fee amount
Allocated total vs total pool
Click Approve.
MetaMask submits approveSubmission(jobId, agent, rewardAmount).

**Step 10: Close lifecycle**

When maxApprovals reached, further approvals are blocked.
If pool has unspent funds and deadline has passed, creator can call refund path (refundExpiredJob) for refundable remainder.
Funds reserved for already approved-but-unclaimed submissions are not refundable.

## AI AGENT OPERATOR WHO WANTS TO POST AGENTIC TASKS

**What is an agentic task:**

Structured task with machine-usable input/output patterns.
Built for programmatic execution or agent workflows.
Different from open browse-and-submit human task flow.
**Step 1: Get operator approval**

Contract requires SourceRegistry approval for source type agent_task.
Current /apply page submits only task applications.
So agent_task approval is currently an admin contract operation (CLI/direct call).

**Step 2: Go to Agentic Tasks page**

Open /tasks.
Choose “Post a Task” tab.

**Step 3: Fill task form**

Task title.
Task description.
Input Data (optional link, often IPFS CID or structured input reference).
Reward in USDC (min 5).
Deadline date/time.

**Step 4: Two-step USDC flow**

If allowance is low, approve USDC first.
Then post task transaction is enabled.
Same escrow permission pattern as regular tasks.

**Step 5: Task appears in Available Tasks**

Open Tasks tab shows claimable tasks with reward/deadline.

**Step 6: Agent claims**

Claim transaction calls claimTask(taskId).
On-chain effects:
assignedAgent set
status becomes InProgress

**Step 7: Agent submits output**

In My Tasks → In Progress section, submit output link/hash.
Calls submitOutput(taskId, outputHash).

**Step 8: Await validation**

Status moves to OutputSubmitted.
Contract enforces validation delay.
Validation requires poster or approved agent_task operator.
Current frontend does not expose a dedicated validate button; validation may need direct contract interaction depending on operator flow.

**Step 9: Claim reward and credential**

Once task status is Validated, claim button appears.
Agent clicks Claim USDC + Credential.
Contract pays reward minus fee and mints 130-point credential.

## USER WHO WANTS A COMMUNITY CREDENTIAL

**Step 1: Open Community page**

Go to /community.
Read Moderation Team panel showing active moderators.

**Step 2: Choose category**

Review 5 activity cards:
Helped a community member
Moderated spaces
Created educational content
Organized event
Reported verified bug

**Step 3: Submit application**

Fill contribution description (50+ chars minimum).
Choose platform.
Add optional evidence link.
Choose activity type.
Submit application transaction.

**Step 4: Pending state**

Application appears in “Your Applications.”
Status badge is Pending.
Message says review usually within 48 hours.

**Step 5: Moderator review**

Active moderators can review in moderator panel on same page.
They approve or reject with notes.

**Step 6: Approved state**

Status changes to Approved.
Claim Credential button appears once matching awarded activity is available.

**Step 7: Claim credential**

Click Claim Credential.
MetaMask confirms claim transaction.
Credential appears on profile.

**Step 8: Rejected state**

Rejection note is shown.
User can submit a new application with better evidence/new activity.

# CLIENT, FREELANCER USING SMART CONTRACTS (MILESTONES)

**What Contracts page is for:**

/milestones is for formal two-party agreements.
Unlike open tasks, this is client-to-specific-freelancer milestone escrow.

## CLIENT FLOW — PROPOSING PROJECT

**Step 1: Open New Contract tab**
Go to /milestones.
Click New Contract.

**Step 2: Enter freelancer wallet**

Paste freelancer address.

**Step 3: Build milestones**

Click Add Milestone.
For each milestone enter:
Title
Description
Amount (USDC, minimum practical threshold is usually 5 in UI)
Deadline
You can add up to 20 milestones.

**Step 4: Review total**

UI updates total structure as you add milestones.

**Step 5: Create project**

Click Create Project.
MetaMask confirms proposeProject(...).
Project ID and milestone list become available.

**Step 6: Fund milestone**

Click Fund Milestone.
If needed, approve USDC first.
Then fund transaction locks milestone amount into escrow contract.

**Step 7: Fund next milestones progressively**

Each milestone is funded separately.
This reduces upfront risk and keeps staged control.

## FREELANCER FLOW — WORKING MILESTONES

**Step 1: Open My Contracts**

Freelancer sees project milestones in stepper-like grouped view.

**Step 2: Wait for funded status**

Only funded milestones should be worked/submitted.

**Step 3: Submit deliverable**

Enter deliverable link/hash.
Submit transaction updates milestone status to Submitted.

**Step 4: Wait for client action**

Client has 48-hour dispute window after submission.
CLIENT REVIEW

**Step 5: Approve or Dispute**

Approve releases funds (minus fee).
Dispute requires reason with minimum length.
IF CLIENT DOES NOT ACT (48h)

**Step 5 alternate: Auto-release**

Freelancer gets Auto-Release option after window expires (if no dispute).
This prevents funds being locked by silent clients.
IF DISPUTED

**Step 5 alternate: Raise dispute**

Dispute status set.
Three arbitrators assigned from approved arbitrator list.

**Step 6: Disputes tab**

Shows reason, vote count, and outcome state.
Assigned arbitrators can vote.

**Step 7: Voting**

Each assigned arbitrator can vote once: Favor Freelancer or Favor Client.
Majority of 3 decides outcome.

**Step 8: Resolution**

Favor Freelancer majority: payout to freelancer.
Favor Client majority: refund to client.

 ## USER WHO WANTS TO GIVE OR RECEIVE PEER ATTESTATIONS

**Step 1: Eligibility**

Only score >= 1000 (Keystone) can give attestations.
Below that, page shows current score and remaining points needed.

**Step 2: Go to Attest page**

Open /attest.
Use Give Attestation tab if eligible.

**Step 3: Fill attestation**

Recipient wallet address.
Category.
Note (50+ chars, max 200) with specific factual context.

**Step 4: Read permanent warning**

Attestation is public and on-chain.
It cannot be undone.

**Step 5: Submit**

MetaMask confirms attest transaction.

**Step 6: Recipient view**

Recipient sees entry in Received tab.
Credential is minted during attest transaction itself (no separate recipient claim step in contract).
Weekly/collusion limits:

Max 2 attestations given per 7 days.
Max 1 received per 7 days.
Mutual attestation blocked (if they attested you before, you cannot attest them back).

## USER WHO WANTS DAO GOVERNANCE CREDENTIAL

**What this is:**

Proof that your wallet voted in a specific proposal on an approved DAO governor.

**Step 1: Open governance page**
Go to /governance.

**Step 2: Enter governor**
Input governor contract address.
Governor must be in approved list on chain (added by admin).

**Step 3: Enter proposal ID**

Input the numeric proposal ID.

**Step 4: Verify and Claim**
Click Verify and Claim.
MetaMask confirms transaction.

**Step 5: On-chain check**
Contract checks governor’s hasVoted(proposalId, wallet).
**Step 6: Result**

If voted and eligible: credential minted immediately.
If not: clear revert error (not voted, governor not approved, already claimed, etc.).

# THE ARC TECHNOLOGY EXPLAINED

## What Arc is in this app
Arc is the blockchain network Archon is configured for in deployment and frontend config.

## Arc USDC model in this codebase

USDC ERC-20 contract address in config: 0x3600000000000000000000000000000000000000.
Network currency in wallet-add flow is labeled USDC.
This is unusual compared to ETH gas model and is part of Arc UX style in this project.

## 18-decimal vs 6-decimal distinction

Wallet/native display uses 18 decimals for network currency metadata.
ERC-20 transfer math in app/contracts uses 6 decimals for USDC amounts.
In frontend:
parse functions use 6-decimals for reward math.
display format uses 6-decimal units for token balances.
Users should know this to avoid entering wrong unit assumptions.

## ERC-8004 in Archon

ERC8004ValidationRegistry is the credential registry model in this project.
It stores credential records with source type and weight.
It is not a tradable NFT flow; it is validation-focused credential issuance.

## ERC-8183 in Archon

ERC8183Job structures task lifecycle and proof-of-completion.
It enforces workflow from task creation to claim and credential minting.
5.6 Arc testnet values from current code

Chain ID: 5042002
RPC in app/deploy config: https://rpc.testnet.arc.network
Explorer: https://testnet.arcscan.app
USDC ERC-20: 0x3600000000000000000000000000000000000000

## Local Development

### Prerequisites

- Node.js 18+
- MetaMask browser extension

### Setup

```bash
# Clone
git clone https://github.com/Abd00lmalik/Archon.git
cd Archon

# Install contract dependencies
cd contracts && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### Environment

Copy and configure environment files:

```bash
# Contracts
cp contracts/.env.example contracts/.env

# Frontend
cp frontend/.env.local.example frontend/.env.local
```

Required values in `contracts/.env`:
DEPLOYER_PRIVATE_KEY=0x...
ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
PLATFORM_TREASURY=0x25265b9dBEb6c653b0CA281110Bb0697a9685107
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
### Run Locally

**Terminal 1 — Start local blockchain:**
```bash
cd contracts && npx hardhat node
```

**Terminal 2 — Deploy contracts:**
```bash
cd contracts && npx hardhat run scripts/deploy.ts --network localhost
```

**Terminal 3 — Start frontend:**
```bash
cd frontend && npm run dev
```

Open http://localhost:3000 and connect MetaMask to `localhost:8545` (Chain ID 31337).

### Deploy to Arc Testnet

```bash
cd contracts && npx hardhat run scripts/deploy.ts --network arc_testnet
```

### Run Tests

```bash
cd contracts && npx hardhat test
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Arc Testnet (EVM-compatible, USDC-native) |
| Contracts | Solidity 0.8.20, Hardhat, OpenZeppelin |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Web3 | ethers.js v6, RainbowKit, wagmi |
| Currency | USDC (ERC-20, 6 decimals) |
| Storage | IPFS for deliverable content |
| Treasury | Safe multisig |

---

## Architecture
User action
│
Source Contract (ERC8183Job / AgentTaskSource / CommunitySource / etc.)
│  verifies work completed
CredentialHook.onActivityComplete(agent, activityId, sourceType, weight)
│  only callable by registered source contracts
ERC8004ValidationRegistry.issue(agent, activityId, sourceType, weight)
│  only callable by authorized hook
Permanent credential record stored on Arc

## License

MIT

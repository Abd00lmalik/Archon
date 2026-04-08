Archon is a multi-source on-chain reputation platform on Arc Testnet.
Users earn verifiable credentials from tasks, agentic tasks, community work, peer attestations, DAO governance participation, and milestone contracts with escrow/disputes.

Live App: https://archon-dapp.vercel.app
Network: Arc Testnet (Chain ID: 5042002)

Deployed Contracts (Arc Testnet)
Contract	Address
SourceRegistry	0xa25C501C62e60EF1F03c37400b4FBDf2775d18Bf
ValidationRegistry	0xCC2813327a5e2ce43a7bf78ed59d2D21BBB66b1B
CredentialHook	0x23d66b8eb42Cc1f51F37b879A3dbC15252684Db2
ERC8183Job	0xE57DE7e8dA52e76f8Ab9b88697306Ef49Fa633b9
GitHubSource	0xa67851a3DaFF1a3082e30ab1E5bd0B3fDBE21b55
CommunitySource	0x0a7c1B0dB4Cc6bE3A95e5BC1B99065b91b725353
AgentTaskSource	0xbE7e13b78DA31b1249B52083C4B4eF02FE9a6A21
PeerAttestationSource	0x6A42a8bFeBE96E94d06C5bcBfA303E984f85Ae27
DAOGovernanceSource	0xe42Bf6A67899a82E2AA7DE9DE74f8a30a338f457
MilestoneEscrow	0xb958a8CC159D8E2d079E7f26B9D3E6E8340D5d78
USDC (Arc ERC-20)	0x3600000000000000000000000000000000000000
Platform Treasury	0x25265b9dBEb6c653b0CA281110Bb0697a9685107
Navigation Guide
/ — Tasks home feed, stats, and open task listings.
/earn — Explains all credential sources and scoring.
/tasks — Agentic tasks hub (available, my tasks, post task).
/my-work — Personal dashboard for posted/accepted work.
/milestones — Contracts page for milestone escrow and disputes.
/profile — Wallet profile, score, tiers, and credentials.
/apply — Apply to become an approved operator.
/community — Community applications and moderator review.
/attest — Peer vouching (Keystone-gated).
/governance — Claim governance participation credentials.
/create-job — Create a task (approved operators only).
/job/[jobId] — Task detail and submission/review lifecycle.
1.1 What problem Archon solves
Today, most “proof of work” is easy to fake:

People can claim they completed work with screenshots or unverifiable links.
Freelancers and agent operators can overstate their history.
Clients and communities struggle to know who is actually reliable.
Good contributors get under-credited because trust is based on reputation theater, not verified evidence. Who gets hurt without this:
Contributors who do real work but cannot prove it in a way everyone trusts.
Clients who pay for low-quality work due to fake reputation.
Communities and DAO ecosystems that need trusted contributors but cannot verify quality history.
AI-agent operators trying to build credibility for autonomous systems. How Archon fixes it:
Real work events are enforced by smart contracts.
Successful completion mints immutable credentials to a wallet.
Reputation score is computed from on-chain credentials, not from self-written profiles. 4.Verification is public and reproducible by anyone.
1.2 What a reputation credential is (plain English)
A credential in Archon is a permanent on-chain record saying: “This wallet completed this specific verified activity from this source, at this time, with this score weight.”

Why Archon credentials cannot be faked: Only authorized issuer contracts can mint into the validation registry. The hook contract only accepts calls from registered source contracts. Source contracts enforce real workflow checks (deadlines, approvals, status transitions, anti-spam rules). Why they cannot be transferred: Credentials are stored as records keyed to wallet address in the registry. There is no transfer function like an NFT marketplace transfer. Why they cannot be deleted: Registry does not expose a delete/revoke endpoint in this code snapshot. Credentials are append-only issuance records. Difference from CV/LinkedIn: CV/LinkedIn is self-asserted and editable. Archon credentials are contract-issued and auditable. CV says “I did X”; Archon lets anyone verify “chain state proves this wallet did X.”

1.3 What Arc is, and why Archon runs on it
Arc is the target blockchain network Archon is configured to use in this repo (Arc Testnet, chain ID 5042002). Archon is built on Arc because:

The stack is USDC-native in UX. Contract and frontend configs are already pinned to Arc testnet addresses. The app’s transaction and network checks are all wired to Arc chain ID and Arc explorer endpoints.

THE FIVE WAYS TO EARN CREDENTIALS
Source 1: Completing Tasks (ERC8183Job) Open task marketplace where creators escrow USDC, contributors submit deliverables, and approved work mints credentials. What user does: Accept task, submit deliverable URL, wait for creator approval, then claim reward + credential. Who verifies and how: Human verifier (task creator) approves/rejects submission on-chain; contract enforces timing and allocation rules. Payout: USDC payout plus reputation credential. Reputation value: 100 points per claimed approved task. Anti-gaming controls: Only approved operators can create tasks (SourceRegistry check for job or task). Minimum stake (minJobStake, default 5 USDC in 6-decimals). Deadline lock (MIN_JOB_DURATION). Review delay (MIN_REVIEW_DELAY). Global claim cooldown (CREDENTIAL_COOLDOWN, 6 hours). Max approvals per task set by creator (1–20). Creator must allocate specific reward per approval and cannot exceed escrow. Client cannot accept own task. Suspicion scoring view (fast completion + high-volume signal).

Source 2: Agentic Tasks (AgentTaskSource) Structured tasks designed for autonomous or semi-autonomous completion with output validation and USDC payout. What user does: Claim task, submit output hash/link, wait for validation, then claim reward + credential. Who verifies and how: Task poster or approved agent_task operator validates output on-chain. Payout: USDC payout plus reputation credential. Reputation value: 130 points per validated claimed task. Anti-gaming controls: Only approved agent_task operators can post. Poster cannot claim their own task. Deadline checks and minimum task duration. Validation delay before approval. 6-hour credential cooldown. Expired-task refund path for poster.

Source 3: Community Work (CommunitySource) Community contribution applications reviewed by active moderators and turned into claimable credentials. **What user does: **Submit application with description + platform + optional evidence link; if approved, claim credential. Who verifies and how: Human moderators (must be active in CommunitySource, and approved for community in SourceRegistry). Payout: Reputation only (no USDC transfer). Reputation value: Discord Help: 50 **Moderation: **80 Content Creation: 90 **Event Organization: **120 Bug Report: 100 Anti-gaming controls: Application requires 50+ character contribution description. Moderator role is controlled and revocable. Moderator cannot self-award in direct award flow. Credential claim has 6-hour cooldown.

Source 4: Peer Vouching (PeerAttestationSource) High-trust endorsements from top-tier members that mint reputation for the recipient. What user does: Eligible user submits recipient + category + detailed note. Who verifies and how: Smart-contract eligibility and limits; no central reviewer. Payout: Reputation only. Reputation value: 60 points. Anti-gaming controls: Only users with weighted score >= 1000 (Keystone) can attest. No self-attestation. Weekly limit: 2 given. Weekly receive limit: 1. Mutual attestation block (hasAttestedBefore[recipient][attester]). Note length 50–200 chars. Credential mints immediately to recipient on attest call.

Source 5: DAO Governance Participation (DAOGovernanceSource) Trustless proof that a wallet voted in an approved DAO governor contract. **What user does: **Enter governor contract + proposal ID and claim. Who verifies and how: Smart contract checks hasVoted(proposalId, wallet) directly from governor contract. Payout: Reputation only. Reputation value: 90 points. Anti-gaming controls: Governor contract must be admin-approved. Wallet must have actually voted. One claim per wallet-governor-proposal tuple. 6-hour credential cooldown.

REPUTATION SCORE AND TIERS
3.1 Score formula Score is the sum of credential weights across all credentials, capped at 2000.

3.2 Tier thresholds in code (reputation.ts)

Surveyor: 0–99 Draftsman: 100–299 Architect: 300–599 Master Builder: 600–999 Keystone: 1000–1499 Arc Founder: 1500+

3.3 What tiers unlock

Keystone (1000+) unlocks ability to GIVE peer attestations. Other tiers are progression/credibility milestones shown in UI, but the explicit contract-gated unlock in this code is Keystone for attestations.

3.4 2000 cap meaning The score cannot increase past 2000 even if more credentials are minted. This avoids runaway score inflation and keeps tiers meaningful.

3.5 Score breakdown by source type The frontend computes per-source totals (Tasks, Agent Tasks, Community, Peer, Governance, etc.) by summing credential weight grouped by normalized source type.

STEP-BY-STEP GUIDES FOR EVERY USER TYPE
USER WHO WANTS TO COMPLETE TASKS AND EARN CREDENTIALS

Step 1: Connect wallet

Open home page (/). Click Connect Wallet in nav. Approve MetaMask connection. You now see open task cards with title, reward pool, deadline, and winner cap. How to read a task card:

Title line: #jobId + title Reward line: X USDC pool · up to Y winners Deadline line: local time display Activity lines: accepted/submissions/approved counts Buttons: View Job, View & Apply (or View My Submission if you already submitted) Step 2: Click a task

Click View & Apply or View Job. You land on /job/[jobId]. If you are not the creator, you see agent view (“Your Submission” panel). Step 3: Click Accept Task

Click Accept Task. MetaMask opens with a transaction to call acceptJob(jobId). Confirm transaction. After confirmation, page updates to show submission form. Step 4: Submit deliverable

Enter a URL in “Deliverable Link.” URL must start with http:// or https://. Good submission examples: GitHub PR link Deployed app link Notion/public doc link IPFS gateway URL Click Submit Work. MetaMask opens transaction for submitDeliverable(jobId, link). Step 5: Wait for review

Status becomes “Awaiting review.” Your submitted URL is shown as clickable link. Creator reviews from their creator view on same task page. Step 6: Get approved

If approved, task page shows approved state. You see: Allocated reward amount. Net amount you receive after platform fee. Why net is lower: Platform fee is deducted from allocated reward (default 10% in deployment config). Step 7: Click Claim

Click Claim USDC + Credential. MetaMask opens claim transaction (claimCredential(jobId)). On success: USDC sent to your wallet. Credential minted via hook + registry. Step 8: Check profile

Open /profile. New credential appears in timeline. Score increases by source weight (for job tasks: +100). Tier and progress bar update automatically.

TASK CREATOR WHO WANTS TO POST A TASK

Step 1: Apply

Go to /apply. You see two cards: Complete tasks and earn. Post tasks for others. Click “Apply to Post Tasks.” Step 2: Fill application form

Name or organization. What tasks you plan to post. Profile link (must be valid URL). Why approve you (minimum 100 chars). Submit with MetaMask transaction to applyToOperate("task", profileURI). Step 3: Wait for approval

Status shows Pending until approved. Approval is an admin action on SourceRegistry. Important repo note: requested approve-operator.ts script is not present in current snapshot, so approval is done by direct contract call or custom script. Step 4: Open Create Task page

Go to /create-job. Fill fields: Task title Description Deadline Reward pool in USDC Max Approvals (how many winners can be approved, 1–20) Step 5: Step 1 of 2 — Approve USDC

If allowance is lower than reward, UI shows Step 1 panel. You click “Approve X.XX USDC.” MetaMask opens approve(spender, amount) on USDC. This gives contract permission to move escrow amount. Step 6: Step 2 of 2 — Create Task

After approval confirms, UI shows “USDC Approved.” Post Task button unlocks. Click Post Task. MetaMask opens task creation transaction. Task is created with an on-chain job ID. Step 7: Task is live

Status message includes Task ID. Task appears on home feed. Share /job/[jobId] link with contributors. Step 8: Review submissions

Open task detail as creator. You see creator review panel (different from agent panel). Each submission shows: Agent wallet Clickable deliverable URL Timestamp Status badge Suspicion score Agent completed-count signal Step 9: Approve with custom reward

Enter reward amount per submission (USDC input). UI shows: Remaining pool Agent net payout after fee Platform fee amount Allocated total vs total pool Click Approve. MetaMask submits approveSubmission(jobId, agent, rewardAmount). Step 10: Close lifecycle

When maxApprovals reached, further approvals are blocked. If pool has unspent funds and deadline has passed, creator can call refund path (refundExpiredJob) for refundable remainder. Funds reserved for already approved-but-unclaimed submissions are not refundable.

** AI AGENT OPERATOR WHO WANTS TO POST AGENTIC TASKS**

What is an agentic task:

Structured task with machine-usable input/output patterns. Built for programmatic execution or agent workflows. Different from open browse-and-submit human task flow. Step 1: Get operator approval

Contract requires SourceRegistry approval for source type agent_task. Current /apply page submits only task applications. So agent_task approval is currently an admin contract operation (CLI/direct call). Step 2: Go to Agentic Tasks page

Open /tasks. Choose “Post a Task” tab. Step 3: Fill task form

Task title. Task description. Input Data (optional link, often IPFS CID or structured input reference). Reward in USDC (min 5). Deadline date/time. Step 4: Two-step USDC flow

If allowance is low, approve USDC first. Then post task transaction is enabled. Same escrow permission pattern as regular tasks. Step 5: Task appears in Available Tasks

Open Tasks tab shows claimable tasks with reward/deadline. Step 6: Agent claims

Claim transaction calls claimTask(taskId). On-chain effects: assignedAgent set status becomes InProgress Step 7: Agent submits output

In My Tasks ? In Progress section, submit output link/hash. Calls submitOutput(taskId, outputHash). Step 8: Await validation

Status moves to OutputSubmitted. Contract enforces validation delay. Validation requires poster or approved agent_task operator. Current frontend does not expose a dedicated validate button; validation may need direct contract interaction depending on operator flow. Step 9: Claim reward and credential

Once task status is Validated, claim button appears. Agent clicks Claim USDC + Credential. Contract pays reward minus fee and mints 130-point credential.

USER WHO WANTS A COMMUNITY CREDENTIAL

Step 1: Open Community page

Go to /community. Read Moderation Team panel showing active moderators. Step 2: Choose category

Review 5 activity cards: Helped a community member Moderated spaces Created educational content Organized event Reported verified bug Step 3: Submit application

Fill contribution description (50+ chars minimum). Choose platform. Add optional evidence link. Choose activity type. Submit application transaction. Step 4: Pending state

Application appears in “Your Applications.” Status badge is Pending. Message says review usually within 48 hours. Step 5: Moderator review

Active moderators can review in moderator panel on same page. They approve or reject with notes. Step 6: Approved state

Status changes to Approved. Claim Credential button appears once matching awarded activity is available. Step 7: Claim credential

Click Claim Credential. MetaMask confirms claim transaction. Credential appears on profile. Step 8: Rejected state

Rejection note is shown. User can submit a new application with better evidence/new activity.

CLIENT + FREELANCER USING SMART CONTRACTS (MILESTONES)

What Contracts page is for:

/milestones is for formal two-party agreements. Unlike open tasks, this is client-to-specific-freelancer milestone escrow. CLIENT FLOW — PROPOSING PROJECT

Step 1: Open New Contract tab

Go to /milestones. Click New Contract. Step 2: Enter freelancer wallet

Paste freelancer address. Step 3: Build milestones

Click Add Milestone. For each milestone enter: Title Description Amount (USDC, minimum practical threshold is usually 5 in UI) Deadline You can add up to 20 milestones. Step 4: Review total

UI updates total structure as you add milestones. Step 5: Create project

Click Create Project. MetaMask confirms proposeProject(...). Project ID and milestone list become available. Step 6: Fund milestone

Click Fund Milestone. If needed, approve USDC first. Then fund transaction locks milestone amount into escrow contract. Step 7: Fund next milestones progressively

Each milestone is funded separately. This reduces upfront risk and keeps staged control. FREELANCER FLOW — WORKING MILESTONES

Step 1: Open My Contracts

Freelancer sees project milestones in stepper-like grouped view. Step 2: Wait for funded status

Only funded milestones should be worked/submitted. Step 3: Submit deliverable

Enter deliverable link/hash. Submit transaction updates milestone status to Submitted. Step 4: Wait for client action

Client has 48-hour dispute window after submission. CLIENT REVIEW

Step 5: Approve or Dispute

Approve releases funds (minus fee). Dispute requires reason with minimum length. IF CLIENT DOES NOT ACT (48h)

Step 5 alternate: Auto-release

Freelancer gets Auto-Release option after window expires (if no dispute). This prevents funds being locked by silent clients. IF DISPUTED

Step 5 alternate: Raise dispute

Dispute status set. Three arbitrators assigned from approved arbitrator list. Step 6: Disputes tab

Shows reason, vote count, and outcome state. Assigned arbitrators can vote. Step 7: Voting

Each assigned arbitrator can vote once: Favor Freelancer or Favor Client. Majority of 3 decides outcome. Step 8: Resolution

Favor Freelancer majority: payout to freelancer. Favor Client majority: refund to client.

USER WHO WANTS TO GIVE OR RECEIVE PEER ATTESTATIONS

Step 1: Eligibility

Only score >= 1000 (Keystone) can give attestations. Below that, page shows current score and remaining points needed. Step 2: Go to Attest page

Open /attest. Use Give Attestation tab if eligible. Step 3: Fill attestation

Recipient wallet address. Category. Note (50+ chars, max 200) with specific factual context. Step 4: Read permanent warning

Attestation is public and on-chain. It cannot be undone. Step 5: Submit

MetaMask confirms attest transaction. Step 6: Recipient view

Recipient sees entry in Received tab. Credential is minted during attest transaction itself (no separate recipient claim step in contract). Weekly/collusion limits:

Max 2 attestations given per 7 days. Max 1 received per 7 days. Mutual attestation blocked (if they attested you before, you cannot attest them back).

USER WHO WANTS DAO GOVERNANCE CREDENTIAL

What this is:

Proof that your wallet voted in a specific proposal on an approved DAO governor. Step 1: Open governance page

Go to /governance. Step 2: Enter governor

Input governor contract address. Governor must be in approved list on chain (added by admin). Step 3: Enter proposal ID

Input the numeric proposal ID. Step 4: Verify and Claim

Click Verify and Claim. MetaMask confirms transaction. Step 5: On-chain check

Contract checks governor’s hasVoted(proposalId, wallet). Step 6: Result

If voted and eligible: credential minted immediately. If not: clear revert error (not voted, governor not approved, already claimed, etc.).

THE ARC TECHNOLOGY EXPLAINED
5.1 What Arc is in this app Arc is the blockchain network Archon is configured for in deployment and frontend config.

**5.2 Arc USDC model in this codebase ** USDC ERC-20 contract address in config: 0x3600000000000000000000000000000000000000. Network currency in wallet-add flow is labeled USDC. This is unusual compared to ETH gas model and is part of Arc UX style in this project.

**5.3 18-decimal vs 6-decimal distinction ** Wallet/native display uses 18 decimals for network currency metadata. ERC-20 transfer math in app/contracts uses 6 decimals for USDC amounts. In frontend: parse functions use 6-decimals for reward math. display format uses 6-decimal units for token balances. Users should know this to avoid entering wrong unit assumptions.

5.4 ERC-8004 in Archon ERC8004ValidationRegistry is the credential registry model in this project. It stores credential records with source type and weight. It is not a tradable NFT flow; it is validation-focused credential issuance.

**5.5 ERC-8183 in Archon ** ERC8183Job structures task lifecycle and proof-of-completion. It enforces workflow from task creation to claim and credential minting. 5.6 Arc testnet values from current code Chain ID: 5042002 RPC in app/deploy config: https://rpc.testnet.arc.network Explorer: https://testnet.arcscan.app USDC ERC-20: 0x3600000000000000000000000000000000000000

5.7 Faucet Use faucet.arc.network to request testnet funds for testing.

HOW TO SET UP METAMASK AND CONNECT TO ARCHON
Step 1: Install MetaMask Install browser extension if not already installed.

Step 2: Open network selector Open MetaMask and click network dropdown.

Step 3: Add network manually Choose Add Network, then manual entry.

Step 4: Enter Arc Testnet values Recommended from this repo’s active config:

Network Name: Arc Testnet RPC URL: https://rpc.testnet.arc.network (Some guides may show https://rpc.arc.network; this codebase currently uses rpc.testnet.arc.network.) Chain ID: 5042002 Currency Symbol: USDC Block Explorer URL: https://testnet.arcscan.app Step 5: Save and switch Save network and switch to Arc Testnet.

Step 6: Get testnet funds Go to faucet.arc.network, connect wallet, request funds.

Step 7: Connect to Archon app Open app and click Connect Wallet.

Step 8: Resolve wrong-network banner If banner appears, click Switch Network and approve in MetaMask.

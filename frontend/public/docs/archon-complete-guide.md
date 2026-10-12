# ARCHON � COMPLETE PLATFORM DOCUMENTATION

## SECTION 1: WHAT IS ARCHON?

### 1.1 The Core Problem It Solves

#### Why on-chain reputation matters
- Most online reputation systems are easy to fake: screenshots can be edited, testimonials can be bought, and portfolios can include work the person never completed.
- Hiring decisions (for freelancers, contributors, and AI agents) usually depend on trust in off-chain claims.
- Without verifiable proof, clients and teams cannot reliably separate real performers from reputation farming.

#### Who gets hurt today without a system like this
- Task creators and employers: they can pay or onboard people with inflated credentials.
- Serious contributors: their real work is diluted by low-trust competitors.
- AI agent operators: there is no durable, interoperable proof that an autonomous agent actually delivered real outcomes.
- Communities/DAOs: moderation and governance effort is hard to prove across platforms.

#### How Archon fixes it
- Archon converts real completed activity into on-chain credentials through contract-enforced workflows.
- Credentials are minted only after objective state transitions (for example: accepted task -> submitted deliverable -> approved).
- Verification is public and direct from chain state, not platform screenshots.
- Reputation score is computed from credential weights and cannot be manually edited by users.

### 1.2 The Core Mechanic

#### What a credential is (plain English)
- A credential is a permanent blockchain record that says: "this wallet completed this activity and got validated by this source contract at this time."

#### What a reputation score is
- A reputation score is the sum of credential weights attached to one wallet, capped at 2000.
- In frontend code (`frontend/src/lib/reputation.ts`), weighted score is:

```ts
const total = credentials.reduce((sum, credential) => sum + (credential.weight ?? 100), 0);
return Math.min(total, 2000);
```

#### Why credentials cannot be faked, deleted, or transferred
- Faked: minting requires authorized issuer flow via `CredentialHook` + source contracts.
- Deleted: there is no delete function in registry.
- Transferred: credentials are stored against the `agent` address in registry mappings; they are identity-bound, not tradable assets.

#### Difference between credentials and NFTs
- NFTs are usually transferable ownership tokens.
- Archon credentials are non-transferable proof records tied to `(agent, activity, sourceType)` and used for reputation.
- Archon credentials are represented as registry structs, not a transferable token standard in this codebase.

### 1.3 Who Uses Archon and How

#### Task Creators
- Post structured work with USDC reward pools in `ERC8183Job`.
- Must be approved in `SourceRegistry` for `"job"` or `"task"` before `createJob` succeeds.
- Review submissions and assign variable per-agent rewards.

#### Contributors / Agents
- Accept open tasks.
- Submit deliverable links.
- If approved, claim reward + credential.
- Can also earn from community, governance, and (contract-side) GitHub/peer sources.

#### AI Agents
- Primary fit for `AgentTaskSource`: machine-readable input/output, validation step, USDC payout, credential mint.
- Same wallet-level reputation logic applies to autonomous and human-operated wallets.

#### Community Moderators
- Registered in `CommunitySource` by owner and must also be approved in `SourceRegistry` for `"community"`.
- Review community applications and approve/reject.
- Can award activity through application approval flow.

#### Platform Admin
- Owner-level powers across contracts:
  - Approve/revoke source operators (SourceRegistry owner)
  - Register/deactivate moderators (CommunitySource owner)
  - Add/remove governors (DAOGovernanceSource owner)
  - Set fee and posting rules (ERC8183Job owner)
  - Add/remove arbitrators and fee in MilestoneEscrow owner

### 1.4 The Token Economy

#### How USDC flows through the system (exact paths)

1. Regular Tasks (`ERC8183Job`)
- Creator calls `createJob(...)`.
- Contract executes `usdc.transferFrom(msg.sender, address(this), rewardUSDC)`.
- On claim:
  - Fee: `usdc.transfer(platformTreasury, platformFee)`
  - Net: `usdc.transfer(agent, agentReward)`

2. Agentic Tasks (`AgentTaskSource`)
- Poster calls `postTask(...)` with USDC transferFrom escrow.
- On `claimRewardAndCredential(...)`:
  - Fee -> `platformTreasury`
  - Net -> `assignedAgent`

3. Milestone Contracts (`MilestoneEscrow`)
- Client funds milestone individually via `fundMilestone` (`transferFrom`).
- If approved/auto-release/favor freelancer:
  - Fee -> `owner` (important: this contract routes fee to `owner`, not `platformTreasury` variable)
  - Net -> freelancer
- If favor client in dispute:
  - full amount refunded to client

#### Platform fee: what it is, where it goes, who controls it
- Represented in basis points.
- `ERC8183Job.platformFeeBps` + `platformTreasury`, owner-set via `setPlatformConfig`.
- `AgentTaskSource.platformFeeBps` + `platformTreasury`, configurable by approved `agent_task` operator via `setPlatformConfig`.
- `MilestoneEscrow.platformFeeBps`, owner-set via `setPlatformFee`; fee paid to `owner` inside `_releaseFunds`.

#### What happens to escrow if a task expires
- `ERC8183Job.refundExpiredJob(jobId)` allows client refund after deadline if unallocated/unclaimed balance exists.
- `AgentTaskSource.refundExpiredTask(taskId)` allows poster refund if status is `Open` or `InProgress` after deadline.
- `MilestoneEscrow` has no direct "expire and refund" shortcut; dispute and window mechanics govern release/refund.

#### Platform treasury address and control
- Current configured treasury in deployment JSON:
  - `0x25265b9dBEb6c653b0CA281110Bb0697a9685107`
- Controlled by whoever manages that wallet/safe externally.
- Updatable in job contract by owner.

---

## SECTION 2: THE SMART CONTRACTS

For each contract below: purpose, state, functions, access control, anti-gaming, and integrations are described from live code.

### 2.1 `SourceRegistry.sol`

#### Problem it solves
- Central allowlist for who can operate each credential source type (`task`, `job`, `community`, `agent_task`, etc.).
- Prevents unvetted wallets from creating certain high-impact source records.

#### State variables
- `address public owner`: admin account.
- `mapping(string => mapping(address => bool)) public approvedOperators`: sourceType -> operator -> approved.
- `mapping(string => mapping(address => OperatorApplication)) public operatorApplications`: stores `profileURI` + `appliedAt`.
- `mapping(string => address[]) private applicantsBySourceType`: application list per source type.
- `mapping(string => mapping(address => bool)) private applicantTracked`: dedupe for applicant list.
- `mapping(string => address[]) private approvedBySourceType`: known approved set per source.
- `mapping(string => mapping(address => bool)) private approvedTracked`: dedupe for approved list.

#### Access control
- `onlyOwner` modifier on approve/revoke/ownership transfer.

#### Functions

```solidity
function transferOwnership(address newOwner) external onlyOwner
```
- Requires non-zero owner.
- Updates owner and emits `OwnershipTransferred`.

```solidity
function applyToOperate(string calldata sourceType, string calldata profileURI) external
```
- Any wallet can apply.
- Requires non-empty sourceType and profileURI.
- Stores/replaces application and tracks applicant list.
- Emits `OperatorApplied`.

```solidity
function approveOperator(string calldata sourceType, address operator) external onlyOwner
```
- Calls internal `_setApproval(..., true)`.
- Emits `OperatorApprovalUpdated`.

```solidity
function revokeOperator(string calldata sourceType, address operator) external onlyOwner
```
- Calls `_setApproval(..., false)`.

```solidity
function isApprovedFor(string calldata sourceType, address operator) external view returns (bool)
```
- Read-only approval check used by source contracts.

```solidity
function getApplicants(string calldata sourceType) external view returns (address[] memory)
```
- Full applicant history list.

```solidity
function getPendingApplicants(string calldata sourceType) external view returns (address[] memory)
```
- Filters applicants where application exists and approval is false.

```solidity
function getApprovedOperators(string calldata sourceType) external view returns (address[] memory)
```
- Filters active approved operators for one source type.

```solidity
function totalApprovedForSource(string calldata sourceType) external view returns (uint256)
```
- Count for one source type.

```solidity
function totalApproved() external view returns (uint256 count)
```
- Custom dedupe count across `task` and `job` approved sets.

#### Integrations
- Read by `ERC8183Job`, `AgentTaskSource`, `CommunitySource`, `GitHubSource`.

#### Anti-gaming
- Operator gating for source actions reduces spam/fraud attack surface.

---

### 2.2 `ERC8004ValidationRegistry.sol`

#### Problem it solves
- Canonical storage and verification for all credentials across source types.

#### State variables
- `address public owner`
- `uint256 public totalCredentials`
- `mapping(address => bool) public authorizedIssuers`
- `mapping(address => uint256[]) private credentialIdsByAgent`
- `mapping(address => mapping(uint256 => uint256)) public credentialId` (legacy job uniqueness)
- `mapping(address => mapping(bytes32 => uint256)) public credentialIdByActivity` (sourceType+activity uniqueness)
- `mapping(uint256 => Credential) private credentials`

#### Credential struct fields
- `credentialId`, `agent`, `jobId` (reused activityId), `issuedAt`, `issuedBy`, `valid`, `sourceType`, `weight`.

#### Access control
- `onlyOwner` for issuer authorization.
- `onlyAuthorizedIssuer` for `issue`.

#### Functions

```solidity
constructor()
```
- Sets `owner = msg.sender` and auto-authorizes owner as issuer initially.

```solidity
function authorizeIssuer(address issuer, bool isAuthorized) external onlyOwner
```
- Adds/removes issuer permission.

```solidity
function issue(address agent,uint256 activityId,string calldata sourceType,uint256 weight) external onlyAuthorizedIssuer returns (uint256)
```
- Requires valid agent/sourceType/weight.
- Prevents duplicate by `credentialIdByActivity[agent][activityKey] == 0`.
- Increments `totalCredentials` and stores struct.
- Adds to `credentialIdsByAgent`.
- If `sourceType == "job"`, also fills legacy `credentialId[agent][activityId]` with no duplicate.
- Emits `CredentialIssued`.

```solidity
function hasCredential(address agent, uint256 jobId) external view returns (bool)
```
- Legacy job check.

```solidity
function hasCredentialForSource(address agent,uint256 activityId,string calldata sourceType) external view returns (bool)
```
- Generic source check.

```solidity
function getCredential(uint256 credentialRecordId) external view returns (Credential memory)
```

```solidity
function getCredentials(address agent) external view returns (uint256[] memory)
```

```solidity
function credentialCount(address agent) external view returns (uint256)
```

```solidity
function getWeightedScore(address agent) external view returns (uint256)
```
- Sums valid credential weights for agent and caps at 2000.

#### Integrations
- Called by `CredentialHook` only (when configured as authorized issuer).

#### Anti-gaming
- Duplicate prevention per `(agent, sourceType, activityId)`.
- Optional legacy duplicate prevention for job path.

---

### 2.3 `CredentialHook.sol`

#### Problem it solves
- Single trusted issuance gateway from source contracts into validation registry.

#### State variables
- `address public owner`
- `IValidationRegistry public immutable validationRegistry`
- `mapping(address => bool) public registeredSourceContracts`

#### Access control
- `onlyOwner` for source registration and ownership transfer.
- `onlyRegisteredSourceContract` for completion handlers.

#### Functions

```solidity
constructor(address validationRegistryAddress)
```
- Binds registry immutably.

```solidity
function transferOwnership(address newOwner) external onlyOwner
```

```solidity
function registerSourceContract(address sourceContract, bool isRegistered) external onlyOwner
```

```solidity
function registerJobContract(address jobContract, bool isRegistered) external onlyOwner
```
- Backward-compatible alias.

```solidity
function onActivityComplete(address agent,uint256 activityId,string calldata sourceType,uint256 weight) external onlyRegisteredSourceContract returns (uint256)
```
- Validates inputs.
- Calls registry `issue(...)`.
- Emits `ActivityCompletionHandled`.

```solidity
function onJobComplete(address agent, uint256 jobId) external onlyRegisteredSourceContract returns (uint256)
```
- Backward wrapper issuing sourceType `"job"`, weight `100`.

#### Integrations
- All source contracts call this for final credential mint path.

#### Anti-gaming
- Unregistered contracts cannot mint credentials.

---

### 2.4 `ERC8183Job.sol` (Task source)

#### Problem it solves
- Open task marketplace with escrowed USDC, multi-submission review, variable payouts, and credential issuance.

#### Key anti-gaming/time controls
- `MIN_JOB_DURATION = 1 hours`
- `MIN_REVIEW_DELAY = 15 minutes`
- `CREDENTIAL_COOLDOWN = 6 hours`
- `minJobStake` minimum per-approval economics (default 5 USDC in 6 decimals)
- optional credential requirement to post (`requireCredentialToPost`)

#### State variables (selected full list)
- Ownership/config: `owner`, `hook`, `sourceRegistry`, `usdc`, `validationRegistry`, `platformTreasury`, `platformFeeBps`, `minJobStake`, `requireCredentialToPost`
- Counters/timing: `nextJobId`, `lastCredentialClaim`, `jobsCreatedByWallet`, `jobsCompletedByWallet`
- Approval controls: `maxApprovalsForJob`, `approvedAgentCount`
- Storage:
  - `mapping(uint256 => Job) jobs`
  - `acceptedAgentsByJob`, `jobsByClient`, `jobsByAgent`
  - `isAccepted[jobId][agent]`
  - `submissionAgentsByJob`
  - `submissions[jobId][agent]`

#### Functions

```solidity
function createJob(string calldata title,string calldata description,uint256 deadline,uint256 rewardUSDC,uint256 maxApprovals) external returns (uint256)
```
- Caller must be approved source operator for `"job"` or `"task"`.
- Validates title/description/deadline/maxApprovals.
- Requires `rewardUSDC >= minJobStake` and `>= minJobStake * maxApprovals`.
- Optional credential gate checks registry `credentialCount(msg.sender) >= 1`.
- Escrows full reward via `transferFrom`.
- Stores job, sets max approvals, indexes creator, increments created counter.
- Emits `JobCreated`.

```solidity
function acceptJob(uint256 jobId) external
```
- Must be before deadline, not client, not already accepted.
- Marks acceptance, indexes agent, increments accepted count.
- Emits `JobAccepted`.

```solidity
function submitDeliverable(uint256 jobId, string calldata deliverableLink) external
```
- Must be accepted agent, before deadline, non-empty link.
- First submit creates submission row; later updates allowed unless already approved/claimed.
- Sets status `Submitted`, timestamp, clears reviewer note.
- Emits `DeliverableSubmitted`.

```solidity
function approveSubmission(uint256 jobId,address agent,uint256 rewardAmount) external onlyClient(jobId)
```
- Requires pending submission and both time locks:
  - `block.timestamp >= job.createdAt + MIN_JOB_DURATION`
  - `block.timestamp >= submission.submittedAt + MIN_REVIEW_DELAY`
- Enforces approvals cap `approvedAgentCount < maxApprovalsForJob`.
- Enforces positive reward and remaining escrow allocation using `_totalAllocated`.
- Sets status approved and `allocatedReward`.
- Increments approved counters.
- Emits `SubmissionApproved(jobId, agent, rewardAmount)`.

```solidity
function rejectSubmission(uint256 jobId,address agent,string calldata reviewerNote) external onlyClient(jobId)
```
- Requires pending submission.
- Sets status Rejected + note.
- Emits `SubmissionRejected`.

```solidity
function claimCredential(uint256 jobId) external returns (uint256)
```
- Agent-only by submission owner.
- Requires approved submission, unclaimed, and global cooldown.
- Uses exact `allocatedReward` (variable payout).
- Splits fee and net by `platformFeeBps`.
- Transfers fee to treasury and net to agent.
- Calls hook `onActivityComplete(msg.sender, jobId, "job", 100)`.
- Updates claimed/payment counters and anti-gaming counters.
- Emits `RewardPaid` and `CredentialClaimed`.

```solidity
function refundExpiredJob(uint256 jobId) external onlyClient(jobId)
```
- After deadline, once only.
- Refunds only unreserved/unpaid escrow (`available - reservedUnclaimed`).
- Emits `JobRefunded`.

```solidity
function getJob(uint256 jobId) external view returns (Job memory)
function getSubmission(uint256 jobId, address agent) external view returns (Submission memory)
function getAcceptedAgents(uint256 jobId) external view returns (address[] memory)
function getJobsByClient(address client) external view returns (uint256[] memory)
function getJobsByAgent(address agent) external view returns (uint256[] memory)
function getSubmissions(uint256 jobId) external view returns (SubmissionView[] memory)
function getAllJobs() external view returns (Job[] memory)
function getRewardPerApproval(uint256 jobId) external view returns (uint256)
function jobEscrow(uint256 jobId) external view returns (uint256)
```

```solidity
function getSuspicionScore(address agent, uint256 jobId) external view returns (uint256 score, string memory reason)
```
- Signal 1: submission too fast (<2h) adds 30.
- Signal 2: high volume client+agent (>5 each) adds 20.
- Informational only.

#### Integrations
- Reads `SourceRegistry`, optional `ValidationRegistry`, calls `CredentialHook`, uses USDC ERC20.

### 2.5 `AgentTaskSource.sol`

#### Problem it solves
- Specialized paid tasks for agent/developer workflows with validator step and credential minting.

#### State variables
- Constants: `BASIS_POINTS`, `MIN_TASK_DURATION` (30m), `MIN_VALIDATION_DELAY` (15m), `CREDENTIAL_COOLDOWN` (6h).
- Config: `usdc`, `hook`, `sourceRegistry`, `platformTreasury`, `platformFeeBps`.
- Storage: `nextTaskId`, `tasks`, `tasksByPoster`, `tasksByAgent`, `lastCredentialClaim`.

#### Access/verification model
- Posting requires `ISourceRegistry(sourceRegistry).isApprovedFor("agent_task", msg.sender)`.
- Validation can be by approved `agent_task` operator OR original poster.

#### Functions

```solidity
function postTask(string calldata taskDescription,string calldata inputData,uint256 deadline,uint256 rewardUSDC) external returns (uint256)
```
- Requires non-empty description/inputData, future deadline, positive reward, operator approval.
- Escrows USDC via `transferFrom`.
- Creates task in `Open` and emits `AgentTaskPosted`.

```solidity
function claimTask(uint256 taskId) external
```
- Requires Open, not already claimed, not poster, before deadline.
- Sets `assignedAgent`, status `InProgress`, indexes agent.

```solidity
function submitOutput(uint256 taskId, string calldata outputHash) external
```
- Requires assigned agent, status InProgress or Rejected, before deadline, non-empty output.
- Sets output hash, submittedAt, status OutputSubmitted.

```solidity
function validateOutput(uint256 taskId, bool approved, string calldata validatorNote) external
```
- Caller must be approved operator OR task poster.
- Requires OutputSubmitted and validation delay elapsed.
- Sets status Validated or Rejected.

```solidity
function claimRewardAndCredential(uint256 taskId) external returns (uint256)
```
- Requires assigned agent, status Validated, not already claimed, cooldown passed.
- Marks claimed, updates cooldown.
- Pays fee + net via USDC.
- Calls hook `onActivityComplete(..., "agent_task", 130)`.
- Emits payout/completion events.

```solidity
function refundExpiredTask(uint256 taskId) external
```
- Poster-only, after deadline.
- Allowed only if status Open/InProgress and not claimed.
- Marks rejected+claimed and refunds full reward.

```solidity
function setPlatformConfig(address treasuryAddress, uint256 feeBps) external
```
- Only approved `agent_task` operator can update.
- Fee capped <= 2000 bps.

```solidity
function getTasksByAgent(address) external view returns (uint256[] memory)
function getTasksByPoster(address) external view returns (uint256[] memory)
```

#### Anti-gaming
- Posting gate, deadline lock, validation delay, global credential cooldown.

---

### 2.6 `CommunitySource.sol`

#### Problem it solves
- Moderator-reviewed community contribution credentials with applicant workflow.

#### State variables
- Enums: `CommunityActivityType`, `ApplicationStatus`.
- Structs: `ModeratorProfile`, `CommunityActivity`, `CommunityApplication`.
- Config/state: `owner`, `hook`, `sourceRegistry`, `nextActivityId`, `nextApplicationId`, `activeModeratorCount`.
- Mappings:
  - `activities`, `activitiesByRecipient`
  - `moderatorProfiles`, `moderatorKnown`, `moderators[]`
  - `applications`, `applicationsByApplicant`
  - `lastCredentialClaim`

#### Access control
- `onlyOwner`: ownership transfer, moderator registration/deactivation.
- `onlyActiveModerator`: application approve/reject and direct award.
- Moderator registration also requires source-registry approval for `"community"`.

#### Functions

```solidity
function registerModerator(address moderator,string calldata name,string calldata role,string calldata profileURI) external onlyOwner
```
- Requires approved operator in SourceRegistry.
- Stores profile, toggles active count, tracks list.

```solidity
function deactivateModerator(address moderator) external onlyOwner
```
- Sets active false and decrements active count.

```solidity
function submitApplication(string calldata activityDescription,string calldata evidenceLink,string calldata platform) external returns (uint256)
```
- Requires description >= 50 chars and non-empty platform.
- Stores pending application and indexes applicant.
- Emits `ApplicationSubmitted`.

```solidity
function approveApplication(uint256 applicationId,CommunityActivityType activityTypeValue,string calldata reviewNote) external onlyActiveModerator returns (uint256)
```
- Requires application pending.
- Marks approved + reviewer + note.
- Calls internal `_awardActivity(...)` to create claimable activity.

```solidity
function rejectApplication(uint256 applicationId, string calldata reviewNote) external onlyActiveModerator
```
- Requires pending + non-empty rejection note.
- Marks rejected and stores review metadata.

```solidity
function awardActivity(address recipient,CommunityActivityType activityTypeValue,string calldata platform,string calldata evidenceNote) external onlyActiveModerator returns (uint256)
```
- Direct moderator award path, recipient cannot be moderator self.

```solidity
function claimCredential(uint256 activityId) external returns (uint256)
```
- Recipient-only, not already claimed, cooldown check.
- Weight from activity type via `getWeight`.
- Calls hook with `sourceType = "community"`.

```solidity
function getActivitiesByRecipient(address) external view returns (uint256[] memory)
function getActivity(uint256) external view returns (CommunityActivity memory)
function getModerators() external view returns (address[] memory)
function isActiveModerator(address) external view returns (bool)
function getApplication(uint256) external view returns (CommunityApplication memory)
function getApplicationsByApplicant(address) external view returns (uint256[] memory)
function getPendingApplications() external view returns (uint256[] memory)
function getWeight(CommunityActivityType) public pure returns (uint256)
```

#### Anti-gaming
- Human review by active moderators.
- Minimum description length and rejection-note requirement.
- Claim cooldown.

---

### 2.7 `PeerAttestationSource.sol`

#### Problem it solves
- Rare social trust signal with strict gating and anti-collusion controls.

#### State variables
- Constants:
  - `ATTESTATIONS_PER_WEEK = 2`
  - `RECEIVED_PER_WEEK = 1`
  - `WINDOW = 7 days`
- Config: `hook`, `registry`, `nextAttestationId`
- Storage:
  - `attestations`
  - `attestationsGivenByAddress`, `attestationsReceivedByAddress`
  - weekly counters + window starts
  - `hasAttestedBefore[attester][recipient]`

#### Function

```solidity
function attest(address recipient,string calldata category,string calldata note) external returns (uint256 attestationId, uint256 credentialRecordId)
```

Requires (exact logic):
- recipient valid and not self.
- category non-empty.
- weighted score gate:
  - `IValidationRegistry(registry).getWeightedScore(msg.sender) >= 1000`
- note length 50..200.
- no mutual attestation:
  - `!hasAttestedBefore[recipient][msg.sender]`
- weekly caps after window sync:
  - giver < 2
  - recipient < 1

Effects:
- increments counters, sets relationship map.
- stores attestation.
- calls hook `onActivityComplete(recipient, attestationId, "peer_attestation", 60)`.
- emits `AttestationIssued`.

#### Anti-gaming
- High unlock tier (Keystone threshold).
- strict weekly caps.
- mutual block.
- minimum explanatory note.

---

### 2.8 `DAOGovernanceSource.sol`

#### Problem it solves
- Trustless governance participation credentials from on-chain vote history.

#### State variables
- `owner`, `hook`, `nextActivityId`
- `approvedGovernors`, `governorKnown`, `governors[]`
- `claimed[participant][governor][proposalId]`
- `lastCredentialClaim`
- `activities`, `activitiesByParticipant`
- `CREDENTIAL_COOLDOWN = 6 hours`

#### Functions

```solidity
function addGovernor(address governorContract) external onlyOwner
function removeGovernor(address governorContract) external onlyOwner
function getGovernors() external view returns (address[] memory)
```

```solidity
function claimGovernanceCredential(address governorContract,uint256 proposalId) external returns (uint256 activityId, uint256 credentialRecordId)
```
- Requires governor approved.
- Requires `IGovernor(governorContract).hasVoted(proposalId, msg.sender)`.
- Requires not already claimed and cooldown passed.
- Records activity + claim map.
- Calls hook with `"dao_governance", 90`.

#### Anti-gaming
- Double-claim block per `(wallet, governor, proposal)`.
- cooldown.
- relies on trustless on-chain vote proof.

---

### 2.9 `GitHubSource.sol`

#### Problem it solves
- Verifier-mediated GitHub activity credential flow.

#### State variables
- Enums: `GitHubActivityType`, `ActivityStatus`.
- `nextActivityId`, `hook`, `sourceRegistry`, `CREDENTIAL_COOLDOWN`.
- `activities`, `activitiesByAgent`, `pendingClaimCount`, `lastCredentialClaim`.

#### Functions

```solidity
function submitActivity(GitHubActivityType activityType,string calldata evidenceUrl,string calldata repoName) external returns (uint256)
```
- Requires pending claims <5.
- Requires evidence URL starts with `https://github.com`.
- Stores pending activity and increments pending count.

```solidity
function approveActivity(uint256 activityId) external
function rejectActivity(uint256 activityId, string calldata reason) external
```
- Caller must be approved operator for `"github"`.
- Activity must be pending.
- Updates status/verifier/reason and decrements pending count.

```solidity
function claimCredential(uint256 activityId) external returns (uint256)
```
- activity owner only, approved only, unclaimed, cooldown passed.
- weight from `getWeight(activityType)`:
  - PR merged 150
  - issue resolved 120
  - repo contribution 100
  - code review 80
  - docs 70
- Calls hook with `sourceType "github"` and computed weight.

```solidity
function getActivitiesByAgent(address) external view returns (uint256[] memory)
function getActivity(uint256) external view returns (GitHubActivity memory)
function getWeight(GitHubActivityType) public pure returns (uint256)
```

#### Anti-gaming
- Pending cap, URL format gate, operator gate, cooldown, explicit approval.

---

### 2.10 `MilestoneEscrow.sol`

#### Problem it solves
- Formal milestone-based contract escrow between client and freelancer with dispute arbitration.

#### State variables
- Constants:
  - `MIN_MILESTONE_DURATION = 1 hours`
  - `DISPUTE_WINDOW = 48 hours`
- Config:
  - `usdc`, `credentialHook` (stored but not used for minting in current implementation), `owner`, `platformFeeBps`
- Counters:
  - `nextMilestoneId`, `nextProjectId`, `totalEscrowed`
- Storage:
  - `milestones`, `milestonesByProject`, `milestonesByClient`, `milestonesByFreelancer`
  - `disputes`, `hasDispute`, `fundedMilestones`
  - arbitrator registry `approvedArbitrators`, `arbitratorList`

#### Access control
- `onlyOwner` for ownership, arbitrator management, fee update.
- `nonReentrant` custom lock modifier on fund/approve/autoRelease/vote.

#### Functions (core)

```solidity
function proposeProject(address freelancer,string[] calldata milestoneTitles,string[] calldata milestoneDescriptions,uint256[] calldata milestoneAmounts,uint256[] calldata milestoneDeadlines) external returns (uint256)
```
- Client creates project + milestones in `Pending`.
- Validates array lengths, max 20 milestones, positive amount, future deadline.

```solidity
function fundMilestone(uint256 milestoneId) external nonReentrant
```
- Client-only.
- Must be pending and not funded.
- Transfers USDC to escrow and increments `totalEscrowed`.

```solidity
function submitDeliverable(uint256 milestoneId,string calldata deliverableHash) external
```
- Freelancer-only.
- Must be pending and funded.
- Must be before deadline and include non-empty hash/link.
- Sets `Submitted` + timestamp.

```solidity
function approveMilestone(uint256 milestoneId) external nonReentrant
```
- Client-only, submitted, funded, not released.
- Sets Approved then `_releaseFunds`.

```solidity
function raiseDispute(uint256 milestoneId, string calldata reason) external
```
- Either party.
- Must be submitted, funded, within 48h, no existing dispute, reason >=20 chars.
- Sets Disputed and assigns 3 arbitrators by `_selectArbitrators`.

```solidity
function autoRelease(uint256 milestoneId) external nonReentrant
```
- Freelancer-only.
- If submitted + funded, no dispute, and `submittedAt + 48h` elapsed.
- Sets Approved and releases funds.

```solidity
function voteOnDispute(uint256 milestoneId, DisputeOutcome vote) external nonReentrant
```
- Assigned arbitrators only.
- One vote per arbitrator.
- Resolution check begins once >=2 votes received.
- If `FavorFreelancer >= 2`: mark resolved, status ArbitratorResolved, release funds.
- If `FavorClient >= 2`: mark resolved, status Refunded, refund client.

```solidity
function addArbitrator(address arbitrator) external onlyOwner
function removeArbitrator(address arbitrator) external onlyOwner
function setPlatformFee(uint256 feeBps) external onlyOwner
```

```solidity
function getMilestone(uint256 milestoneId) external view returns (Milestone memory)
function getMilestonesByProject(uint256 projectId) external view returns (uint256[] memory)
function getMilestonesByClient(address client) external view returns (uint256[] memory)
function getMilestonesByFreelancer(address freelancer) external view returns (uint256[] memory)
function getDispute(uint256 milestoneId) external view returns (Dispute memory)
function getArbitratorCount() external view returns (uint256)
function getArbitrators() external view returns (address[] memory)
```

#### Full lifecycle from propose to complete
1. Client proposes project with N milestones.
2. Each milestone is funded separately.
3. Freelancer submits deliverable for funded milestone.
4. Client either:
   - approves immediately -> payout, or
   - raises dispute within 48h.
5. If client does nothing for 48h, freelancer can auto-release.
6. If disputed, three arbitrators vote; majority determines payout/refund.

#### 48-hour dispute window behavior
- Window starts at `submittedAt` when deliverable is submitted.
- Client/freelancer can dispute only until `submittedAt + DISPUTE_WINDOW`.
- After this, dispute path closes and freelancer can auto-release (if no dispute exists).

#### Arbitrator selection algorithm
- Requires at least 3 arbitrators in registry.
- Seed: `keccak256(abi.encodePacked(milestoneId, block.timestamp, block.prevrandao))`.
- Picks indices derived from seed and length.
- Deduplicates second and third picks with loops until unique.

#### 3-of-3 majority behavior in actual code
- Contract resolves after at least 2 votes (`votesReceived >= 2`).
- It then counts votes across 3 slots.
- Any side reaching >=2 wins.
- Third vote is unnecessary once majority exists.

#### Fund outcomes by path
- Approve / Auto-release / FavorFreelancer:
  - fee = amount * bps / 10000
  - fee -> `owner`
  - net -> freelancer
- FavorClient:
  - full amount -> client
- `totalEscrowed` is decremented on release/refund.

---

## SECTION 3: THE CREDENTIAL SYSTEM

### 3.1 What Goes Into a Credential

#### `Credential` struct fields (registry)
- `uint256 credentialId`
- `address agent`
- `uint256 jobId` (reused activity ID for all sources)
- `uint256 issuedAt`
- `address issuedBy`
- `bool valid`
- `string sourceType`
- `uint256 weight`

#### `sourceType` meaning and values
Observed source type values from contracts/UI:
- `job`
- `agent_task`
- `community`
- `peer_attestation`
- `dao_governance`
- `github`

#### `weight` meaning
- Numeric contribution to reputation score for that credential.
- Different source activities assign different weight.

#### How permanently bound to wallet
- Issuance key is stored per `agent` in registry mappings.
- Uniqueness mapping includes agent key.
- There is no transfer function.

### 3.2 The Six Credential Sources

#### 1) Tasks (`ERC8183Job`) 
- Activity: accepted task, submitted deliverable, creator approval, claim.
- Verifier: task creator (client).
- Steps: `acceptJob -> submitDeliverable -> approveSubmission -> claimCredential`.
- Weight: 100.
- USDC paid: yes.
- Anti-gaming: operator gate, min stake, duration/review delays, cooldown, max approvals, allocation checks, suspicion score.

#### 2) Agentic Tasks (`AgentTaskSource`)
- Activity: claim/open task, submit output, validation, claim reward.
- Verifier: approved operator or poster.
- Weight: 130.
- USDC paid: yes.
- Anti-gaming: posting gate, deadline checks, validation delay, cooldown, refund logic.

#### 3) Community Work (`CommunitySource`)
- Activity: submit application -> moderator approval -> claim credential.
- Verifier: active moderator.
- Weight: by type (50/80/90/120/100).
- USDC paid: no.
- Anti-gaming: moderator gate, min description length, rejection-note requirement, cooldown.

#### 4) Peer Vouching (`PeerAttestationSource`)
- Activity: eligible wallet attests another wallet.
- Verifier: no moderator; strict eligibility and limits enforce scarcity.
- Weight: 60.
- USDC paid: no.
- Anti-gaming: 1000-point threshold, weekly caps, mutual attestation block, note length minimum.

#### 5) DAO Governance (`DAOGovernanceSource`)
- Activity: prove on-chain vote in approved governor.
- Verifier: trustless contract call to governor `hasVoted`.
- Weight: 90.
- USDC paid: no.
- Anti-gaming: approved governor list, one-claim-per-proposal map, cooldown.

#### 6) GitHub (`GitHubSource` contract exists)
- Contract supports submit->approve/reject->claim with variable weights.
- Frontend `/github` currently directs users to task flow instead of on-page GitHub claim UI.

### 3.3 The Reputation Score System

#### Exact weighted score formula
```ts
const total = credentials.reduce((sum, credential) => sum + (credential.weight ?? 100), 0);
return Math.min(total, 2000);
```

#### Tier thresholds (from `reputation.ts`)
- Surveyor: 0�99
- Draftsman: 100�299
- Architect: 300�599
- Master Builder: 600�999
- Keystone: 1000�1499
- Arc Founder: 1500�2000

#### Tier colors in current UI implementation
- Source-type colors are explicit; tier-specific colors are not uniquely mapped per tier in code.
- Current reputation card displays tier text using accent color `#00D1B2` for active tier label.
- Progress bar fill also uses `#00D1B2`.

#### Unlocks
- Critical unlock in code/contracts: peer vouching requires Keystone threshold (>=1000).

#### Score breakdown by source type
- `getScoreBreakdown` groups credentials by normalized source buckets and sums weights.
- Profile displays human labels and totals per source.

#### 2000-point cap and why it exists
- Hard cap prevents infinite score inflation and keeps tiers bounded.

### 3.4 Anti-Gaming Architecture

For each mechanism: attack blocked, logic, bypass difficulty.

1. SourceRegistry approval requirement
- Blocks unvetted source operators from posting sensitive source activities.
- Example requires:
  - Job: `isApprovedFor("job") || isApprovedFor("task")`
  - AgentTask: `isApprovedFor("agent_task")`
- Bypass requires owner compromise or approved operator collusion.

2. Minimum USDC stake per task
- Blocks near-zero-value spam tasks.
- `createJob` requires:
  - `rewardUSDC >= minJobStake`
  - `rewardUSDC >= minJobStake * maxApprovals`
- Bypass requires locking real capital.

3. `MIN_JOB_DURATION` time lock
- Blocks instant create->approve farming.
- `approveSubmission`: `block.timestamp >= job.createdAt + MIN_JOB_DURATION`.

4. `MIN_REVIEW_DELAY`
- Blocks immediate submit->approve loops.
- `approveSubmission`: `block.timestamp >= submission.submittedAt + MIN_REVIEW_DELAY`.

5. `CREDENTIAL_COOLDOWN` (6h)
- Blocks rapid repeated claim loops from one wallet.
- Enforced in job, agent task, community, governance paths.

6. Flexible max approvals (1-20)
- Prevents unlimited approvals per job.
- `approvedAgentCount < maxApprovalsForJob[jobId]`.

7. Variable reward per approved submission
- Forces explicit per-approval allocation.
- Allocation cannot exceed escrow:
  - `alreadyAllocated + rewardAmount <= job.rewardUSDC`.

8. Suspicion scoring
- Flags high-risk patterns for human review.
- Signals: very fast submissions, high-volume pairing.
- Informational only; does not auto-block.

9. Keystone requirement for peer vouching
- Prevents low-history wallets from issuing trust attestations.
- Require: weighted score >= 1000.

10. Mutual attestation block
- Prevents direct reciprocal vouch circles.
- Require: `!hasAttestedBefore[recipient][msg.sender]`.

11. Weekly attestation limits
- Giver max 2/week, recipient max 1/week.
- Makes collusive farming slow and visible.

12. Minimum 50-char attestation note
- Forces explanatory public text, raising social/audit cost of fake vouches.

13. MilestoneEscrow dispute window
- Prevents indefinite withholding of outcomes.
- After 48h inactivity, freelancer auto-release available.

14. MilestoneEscrow majority arbitration
- 3 arbitrators, outcome requires majority side (>=2 votes).
- Makes unilateral party control harder.

---
## SECTION 4: PAGE-BY-PAGE USER GUIDE

### 4.1 Home Page (`/`)

#### What this page is for
- Main activity feed and entry point for open tasks.

#### Who should use it
- Everyone: creators, contributors, and new users.

#### Requirements
- Wallet optional for browsing.
- Wallet required for personalized actions and state labels.

#### What the stats bar means
- Credentials Minted: `ValidationRegistry.totalCredentials()`.
- Open Tasks Available: count of jobs with status open.
- USDC in Escrow: remaining reward pools + milestone escrow total.
- Credentials Issued: displayed from credential total (acts as lower-bound activity metric).

#### Welcome banner behavior
- Shows only when wallet connected, has zero credentials, and no prior submission history.
- Dismiss is persisted in `localStorage` key per wallet.

#### Task grid and card reading
- Shows title, status badge, reward pool, max winners, paid out amount, deadline, creator activity, and counts.
- Action buttons vary by viewer:
  - Creator: `Review Submissions (N)`
  - Agent with submission: `View My Submission`
  - Agent without submission: `View & Apply`
  - All: `View Job`

#### Step-by-step
1. Open `/`.
2. Read stats and recent credentials.
3. Scroll to `Open Tasks`.
4. Click `View Job` (or contextual action) for target task.

#### Common errors
- Data load failure: inline red error card appears.
- Stats load failure: stats show `�` silently for failed metrics.

#### Tips
- Use `My Work` for a focused dashboard after accepting tasks.
- Use `Refresh` button after submitting/approving to pull latest state.

---

### 4.2 Earn Page (`/earn`)

#### What this page is for
- Explains all current credential earning paths.

#### Who should use it
- New users learning the system and existing users tracking source counts.

#### Requirements
- Wallet optional.
- Wallet needed for "you have earned N" values and current score/tier.

#### Source cards shown (current UI)
1. Complete Tasks
2. Agentic Tasks
3. Community Work
4. Peer Vouching
5. DAO Governance

#### Weight badge reading
- Badge text shows per-source weight model (fixed or range).

#### USDC vs reputation-only
- Paid cards include wallet icon and paid wording.
- Reputation-only cards include star icon and no payout promise.

#### Info/FAQ block
- Current page contains FAQ entries:
  - "What is a credential?"
  - "What is a reputation score?"

#### Step-by-step
1. Open `/earn`.
2. Read source cards and choose one action CTA.
3. Click through to source route.

#### Common errors
- If wallet data fails to load, score panel can remain generic.

#### Tips
- Start with `Complete Tasks` or `Community` for quickest early score.

---

### 4.3 Create Task Page (`/create-job`)

#### What this page is for
- Post a regular escrowed task.

#### Who should use it
- Approved operators posting tasks.

#### Requirements
- Connected wallet on configured chain.
- Enough USDC balance.
- Sufficient USDC allowance for job contract.
- If ARC gate enabled in config, must satisfy minimum ARC balance.

#### Fields
- Task Title
- Description
- Deadline (datetime)
- Reward Pool (USDC)
- Max Approvals (1..20)

#### Max Approvals meaning
- Maximum number of contributors that can be approved for one task.
- Used with min stake rule to enforce minimum pool size.

#### Two-step escrow UX (explicit)

Step 1 state (if allowance < reward)
- Shows:
  - `Step 1 of 2: Approve USDC`
  - Approval explanation
  - `Approve X.XX USDC` button
  - grey text: `Step 2: Create Task (unlocks after approval)`
- Post button hidden.

Step 2 state (if allowance >= reward)
- Shows green check: `? USDC Approved`
- Shows active `Post Task` button.
- Clicking Post executes `createJob` only.

Transition behavior
- After approve tx confirms, page rechecks allowance and unlocks Step 2 without refresh.
- If reward input increases above current allowance, UI returns to Step 1.

#### Real-time USDC balance warning
- On reward input changes, page fetches `usdc.balanceOf(wallet)` and allowance.
- If insufficient:
  - red warning below reward input.
  - posting disabled.
- While checking:
  - subtle `Checking balance...` text.
- RPC failure behavior:
  - fails silently (no crash).

#### Step-by-step
1. Fill title/description/deadline/reward/max approvals.
2. Confirm minimum pool message.
3. If Step 1 appears, approve USDC first.
4. When `? USDC Approved` appears, click `Post Task`.
5. Wait for success and task ID message.

#### Common errors
- "Reward pool must be at least ..." -> reward too low for max approvals.
- "Switch wallet network ..." -> wrong chain.
- "Step 1 required: approve USDC..." -> allowance insufficient.

#### Tips
- Set max approvals based on real expected winner count to avoid over-committing pool.
- Write acceptance criteria in description to speed approvals.

---

### 4.4 Task Detail Page (`/job/[jobId]`)

#### What this page is for
- Single source of truth for task state, submissions, and actions.

#### Requirements
- Wallet optional for read-only.
- Connected wallet needed for action buttons.

#### Creator view (wallet == job.client)

How to identify
- Shows `Review Submissions` panel and per-submission approve/reject controls.

What creator sees
- Escrow info: locked + remaining pool.
- Approval slots counter: `X of Y approvals used`.
- Submission cards with:
  - agent address + copy button
  - submitted URL link
  - timestamp
  - status badge
  - agent completed count
  - suspicion score and reason

Suspicion indicator meaning
- Score > 40: caution (amber semantics in UI copy).
- Score > 70: high caution (red semantics).
- Score always visible numerically.

Per-submission reward allocation
- Input `Reward amount (USDC)`.
- Remaining pool shown per agent with draft impact.
- Shows payout math:
  - Agent receives after fee
  - Platform fee amount
  - Allocated total of pool

Approve button
- Calls `approveSubmission(jobId, agent, rewardAmount)`.
- Requires time locks and cap availability.

Reject button
- Requires non-empty rejection note in UI.
- Calls `rejectSubmission(jobId, agent, note)`.

After max approvals
- Approve button disabled due cap logic.

#### Agent view (wallet != client)

How to identify
- Shows `Your Submission` panel.

States
1. Not accepted
- `Accept Task` button shown.

2. Accepted but not submitted (or rejected and resubmittable)
- Deliverable link form appears.
- Input must start with http/https.

3. Submitted and pending
- Shows `Awaiting review` and your submitted link.

4. Approved and claimable
- Shows allocated and net amount after fee.
- Shows `Claim USDC + Credential` unless cooldown block.

5. Rejected
- Shows rejection note and allows resubmission.

Cooldown timer
- On claim cooldown, displays `Claim available in: Xh Ym` countdown.

#### Visitor view (no wallet)
- Shows task details only.
- No accept/submit/approve/claim actions.

#### Deliverable examples
- GitHub PR URL
- Notion document
- deployed app URL
- IPFS content link

#### Common errors
- "accept job first" -> submit attempted before acceptance.
- "review delay not elapsed" -> creator approving too early.
- "credential cooldown active" -> claim too soon after previous claim.

#### Tips
- Contributors should provide final, directly-reviewable links.
- Creators should use rejection notes with actionable corrections.

---

### 4.5 Submit Work Page (`/submit-work`)

#### What this page is now
- Navigation helper only (not the main submission form).

#### How to use
1. Enter Job ID and click `Go to Job`.
2. Or use list of accepted jobs and click `Open Job`.
3. Submit actual work on `/job/[jobId]` page.

#### Common errors
- Non-numeric Job ID shows inline validation error.

---

### 4.6 My Work Page (`/my-work`)

#### What this page is for
- Personal dashboard for posted jobs, jobs you work on, and agent tasks.

#### Sections
1. Jobs You Posted
- Shows your jobs with submission count and `Review Submissions` link.

2. Jobs You're Working On
- Shows accepted jobs and contextual action labels:
  - Submit Work
  - Check Status
  - Claim Credential
  - Completed

3. Agent Tasks
- Shows assigned agent tasks and link to task hub.

#### Step-by-step
1. Open `/my-work`.
2. Pick section by role.
3. Use action button to jump to exact workflow page.

#### Empty states
- Clear messages shown when no items in each section.

---

### 4.7 Agentic Tasks Page (`/tasks`)

#### What this page is for
- Manage agent-task lifecycle: discover, execute, validate, claim, or post.

#### Difference from regular tasks
- Agentic tasks are structured for machine-readable input/output and validator gate.

#### Header strip
- Five-step flow shown:
  - Post Task -> Claim Task -> Submit Output -> Get Validated -> Claim USDC + Credential

#### Tabs

1. Available Tasks
- Open tasks list with reward filters.
- Card fields: description, reward, closes-in text, claim button.

2. My Tasks
- In Progress: output submission form.
- Awaiting Validation: submitted output + estimated unlock countdown.
- Validated � Claim Reward: net claim action with cooldown messaging.
- Completed: history rows.

3. Post a Task
- Requires approval gate (`agent_task` operator).
- Fields: title, description, input data (optional link), reward, deadline.
- Shows USDC balance, allowance, required amount.
- If allowance too low, approve step appears first.

#### Input Data meaning
- Machine-readable task input reference, commonly IPFS CID or URL.

#### After posting
- Status includes parsed task ID if event found:
  - `Task posted! Share this link: /tasks/[taskId]`

#### Common errors
- min reward below 5 USDC.
- wrong network.
- approval missing.

#### Tips
- Use concise output hashes/links for easier validation.

---

### 4.8 Contracts Page (`/milestones` route)

#### What this page is for
- Milestone-based escrow contracts between client and freelancer.

#### How It Works strip (5 steps)
1. Agree on Milestones
2. Client Funds Escrow
3. Freelancer Delivers
4. Client Approves or Disputes
5. Arbitration if Disputed

Plus info box:
- Auto-release available after 48h inactivity post-submission.

#### Tabs
- My Contracts
- New Contract
- Disputes

#### My Contracts tab
- Groups milestones by project.
- Each milestone shows title, description, amount, status, deadline.
- Status labels shown in UI:
  - Pending
  - Funded (pending+funded)
  - Submitted
  - Approved
  - Disputed
  - Refunded

Client actions
- Fund Milestone (when pending and not funded)
- Approve (when submitted)
- Dispute + reason (when submitted)

Freelancer actions
- Submit Deliverable (when funded pending)
- Auto-Release (when submitted + 48h elapsed + no dispute)

#### New Contract tab
1. Enter freelancer address.
2. Add milestone rows dynamically.
3. For each row set title/description/amount/deadline.
4. Click `Create Project`.
5. Fund milestones one-by-one (separate escrow transfers).

Why separate funding
- Each milestone is independently funded/released/disputed.

#### Disputes tab
- Lists active dispute cards with reason, vote count, outcome.
- If connected wallet is assigned arbitrator and not voted:
  - buttons: Favor Freelancer / Favor Client.

#### Common errors
- dispute reason too short (<20 chars).
- not assigned arbitrator.
- no arbitrators configured (<3) when raising dispute.

#### Tips
- Keep milestone scopes small and objective.
- Use strong deliverable evidence links.

---

### 4.9 Community Page (`/community`)

#### What this page is for
- Community credential applications, moderation transparency, and claims.

#### Moderation Team section
- Shows active moderators with name/role/profile URI/wallet.
- If none active, application flow is disabled with waiting message.

#### 5 activity type cards shown
1. Helped a Community Member (+50)
2. Created Educational Content (+90)
3. Moderated Community Spaces (+80)
4. Organized a Community Event (+120)
5. Reported a Verified Bug (+100)

#### Your Applications
- Lists your submissions with statuses:
  - Pending -> under review message
  - Approved -> reviewer name + claim button when award indexed
  - Rejected -> rejection note

#### Application form
- Description (50+ chars required)
- Platform select
- Activity type select
- Optional evidence link

#### Moderator panel (moderator-only)
- Visible only when `moderatorProfiles[wallet].active` is true.
- Shows pending applications with full details.
- Has activity type selector, approval note, rejection note.
- Approve/reject buttons execute on-chain transactions.

#### BAD_DATA decode error status
- Current frontend uses tuple-index parser fallback and contract ABI alignment in `contracts.ts`.

#### Tips
- Include specific contribution dates and proof links for faster moderation.

---

### 4.10 Peer Attestation Page (`/attest`)

#### What this page is for
- Issue or review peer attestations.

#### Eligibility rule
- Must be Keystone tier: score >= 1000.

#### What low-score wallets see
- Eligibility explanation with current score and points remaining.
- Give form blocked/hidden by gating message.

#### Tabs
- Give Attestation
- Received
- Given

#### Give tab fields
- Recipient address
- Category (Technical Work / Community Help / Reliability / Creative Work / Leadership)
- Note 50-200 chars with counter

#### Permanent warning
- Page clearly warns attestations are permanent and public.

#### Weekly counters shown
- Remaining give capacity out of 2
- recipient capacity indicator out of 1

#### Received/Given tabs
- Render attestation history with address, category, note, date.
- Received cards show `+60 pts` badge.

---

### 4.11 DAO Governance Page (`/governance`)

#### What this page is for
- Claim governance credential by proving on-chain vote.

#### Why no human reviewer
- Contract directly calls governor `hasVoted` and approved governor checks.

#### Steps
1. Enter governor address.
2. Enter proposal ID.
3. Click `Verify and Claim`.

#### Error outcomes
- Not voted -> on-chain revert surfaced as error.
- Governor not approved -> revert surfaced.
- Wrong network -> explicit chain-id error.

#### Speed
- No moderation queue; validation is immediate contract read + tx.

---

### 4.12 Profile Page (`/profile`)

#### What this page is for
- Unified reputation dashboard and credential timeline.

#### Top identity section
- Wallet (copy)
- Connected chain
- DID: `did:ethr:<chainId>:<address>` (copy)
- Arc Agent ID lookup from identity registry (`0x8004A818...`):
  - If found: token ID link and tokenURI metadata
  - If not: "Not registered" message

#### Reputation score card
- Large weighted score
- Tier label
- Next-tier progress bar
- points-to-next text
- score breakdown text and chips

#### Credential filters
- All, Tasks, GitHub, Agent Tasks, Community, Peer, Governance.
- Filter logic compares normalized source types.

#### Credential card reading
- Source badge + color
- Weight points
- Metadata fields
- Verify On-Chain action
- Portability badges (Arc source + pending mirrors)

#### Empty profile state
- Shows getting-started action cards to `/`, `/governance`, `/community`.

---

### 4.13 Apply Page (`/apply`)

#### What this page is for
- Onboarding for two role paths.

#### Role cards
1. Complete tasks and earn
- No approval required.
- CTA to home task feed.

2. Post tasks for others
- Requires application.
- Opens form fields:
  - name/org
  - task types planned
  - profile link
  - approval rationale (>=100 chars)

#### Submission behavior
- Calls `txApplyToOperate(..., "task", profileURI)`.
- Stores local status helper in localStorage.
- Shows status: Not Applied / Pending / Approved.

#### Tips
- Provide clear credibility links and detailed task posting intent.

---

### 4.14 GitHub Page (`/github`)

#### Current role in UI
- Informational redirect page.
- Tells users to submit GitHub work as task deliverables via main task flow.

#### Step-by-step
1. Open `/github`.
2. Read guidance.
3. Click `Browse Open Tasks`.
4. Accept relevant task and submit PR/commit URL in deliverable field.

---
## SECTION 5: PLATFORM ADMIN GUIDE

> Important repository reality: the following scripts requested in your prompt are **not present** in current code snapshot:
> - `contracts/scripts/admin/approve-operator.ts`
> - `contracts/scripts/admin/revoke-operator.ts`
> - `contracts/scripts/admin/approve-community.ts`
> - `contracts/scripts/admin/list-pending.ts`
> - `contracts/scripts/admin/platform-stats.ts`
>
> Present admin scripts are:
> - `_setup.ts`
> - `add-moderator.ts`
> - `add-arbitrator.ts`
> - `add-governor.ts`

### 5.1 Prerequisites

#### Admin wallet
- Admin authority is whichever wallet is current `owner` on each contract.
- Use the owner key in `contracts/.env` as `DEPLOYER_PRIVATE_KEY`.

#### Working directory
1. `cd contracts`
2. Use hardhat scripts with proper network flag.

#### Network flag
- Local: `--network localhost`
- Arc mainnet aliases in config: `arcMainnet` and `arc_mainnet`
- Arc testnet aliases in config: `arcTestnet` and `arc_testnet`

### 5.2 Checking Platform Health

- Script referenced in request (`platform-stats.ts`) is missing.
- Current equivalent checks can be run with:

```bash
npx hardhat run scripts/e2e-check.ts --network arc_mainnet
```

What it checks (10 checks in current file):
- registry deployed and empty expected count condition
- source registry owner exists
- job USDC address and treasury/fee config
- source contract registration in hook
- milestone escrow USDC config
- seeded moderator count

### 5.3 Viewing Pending Applications

- Requested `list-pending.ts` is missing.
- Current alternative from frontend/admin data model:
  - SourceRegistry exposes `getPendingApplicants(sourceType)`.
  - CommunitySource exposes `getPendingApplications()`.
- You can query through hardhat console or write scripts using `_setup.ts` helper.

### 5.4 Approving a Task Creator

- Requested `approve-operator.ts` is missing.
- Equivalent contract call is:

```solidity
SourceRegistry.approveOperator(string sourceType, address operator)
```

Recommended source types:
- `task`
- `agent_task`
- `community`
- `github`

### 5.5 Revoking an Operator

- Requested `revoke-operator.ts` is missing.
- Equivalent contract call:

```solidity
SourceRegistry.revokeOperator(string sourceType, address operator)
```

Effect on existing data:
- Existing tasks/credentials remain on-chain.
- Revoked operator loses permission for future gated actions.

### 5.6 Adding a Community Moderator

Use provided script:

```bash
# set env vars first
$env:MODERATOR_ADDRESS="0x..."
$env:DISPLAY_NAME="Platform Admin"
$env:ROLE="Archon Founder"
$env:PROFILE_URI="https://..."
npx hardhat run scripts/admin/add-moderator.ts --network arc_mainnet
```

What script does:
1. Ensures address approved in SourceRegistry for `community`.
2. Calls `CommunitySource.registerModerator(...)`.
3. Prints resulting moderator profile.

### 5.7 Approving a Community Application

- Requested `approve-community.ts` is missing.
- Equivalent contract call:

```solidity
CommunitySource.approveApplication(uint256 applicationId, CommunityActivityType activityType, string reviewNote)
```

Activity type values from contract enum:
- `0 = DiscordHelp`
- `1 = Moderation`
- `2 = ContentCreation`
- `3 = EventOrganization`
- `4 = BugReport`

### 5.8 Adding a Dispute Arbitrator

Use script:

```bash
# either explicit address:
$env:ARBITRATOR_ADDRESS="0x..."
# or signer index:
$env:ARBITRATOR_INDEX="1"
npx hardhat run scripts/admin/add-arbitrator.ts --network arc_mainnet
```

Guidance:
- Choose trusted, independent wallets.
- At least 3 arbitrators required before disputes can be raised.

### 5.9 Adding a DAO Governor

Use script:

```bash
$env:GOVERNOR_ADDRESS="0x..."
$env:DAO_NAME="My DAO"
npx hardhat run scripts/admin/add-governor.ts --network arc_mainnet
```

Effect:
- Enables users to claim governance credentials against that governor contract.

### 5.10 Platform Fee Management

Current fee values in deployed config:
- job/agent-task fee target: 1000 bps (10%)

Hard limits:
- `ERC8183Job`: fee must be <= 2000 bps
- `AgentTaskSource`: fee must be <= 2000 bps
- `MilestoneEscrow`: fee must be <= 3000 bps

Where fees go:
- Job/AgentTask: `platformTreasury`
- MilestoneEscrow: `owner` of milestone escrow contract (current implementation)

### 5.11 Security Checklist for Admin
- Keep `contracts/.env` out of git (verify `.gitignore` contains `.env`).
- Rotate deployer key periodically.
- Revoke compromised operators immediately in SourceRegistry.
- Investigate suspicious credential patterns via:
  - job suspicion scoring
  - moderation notes
  - source-specific event history
- Fraudulent credentials cannot be deleted by current registry API; mitigation is governance/flagging at application layer and tightening source controls.

---

## SECTION 6: NETWORK AND DEPLOYMENT

### 6.1 Arc Mainnet Details (from current code/config)
- Chain ID: `5042`
- RPC URL (current contracts JSON / env): `https://rpc.mainnet.arc.io`
- Block explorer used in UI: `https://explorer.arc.io`
- USDC ERC-20: `0x3600000000000000000000000000000000000000`
- Funding note:
  - There is no faucet on mainnet. Fund your wallet with USDC from an exchange or bridge.
  - USDC is the native gas token on Arc (18-decimal display in wallets).
- Decimal note:
  - Native gas token display uses 18 decimals in wallet network config
  - ERC-20 USDC interactions in contracts/frontend use 6 decimals

### 6.2 All Deployed Contract Addresses (from `frontend/src/lib/generated/contracts.json`)
- SourceRegistry: `0xF5FCbcF220C13CB4A5e8604B3701c83DFd4e8576`
- ValidationRegistry: `0xb714C337470f96C3812E92987aEC1B6892A7AAcd`
- CredentialHook: `0xc7Dcc4b616b192E046c722271CA7950601CAcd21`
- ERC8183Job: `0x482deF6e38d4b22581A844c682174b917D55ecB7`
- GitHubSource: `0x2B8b558aF5c3Eef2c90812D7a8276D4056c80046`
- CommunitySource: `0xBAdeAE2bFE27c70C129237419abB4C6820e38ACc`
- AgentTaskSource: `0xa1A6474D3342618422587f1F75343e6b7bBF709b`
- MilestoneEscrow: `0xa4ae469AA2A5316678c1e9f114f49D599545dc67`
- PeerAttestationSource: `0x020558b936286Fc27d755541E63E9bab45394320`
- DAOGovernanceSource: `0x893b8946e41B97FD3427c27cebFC63d819667835`

### 6.3 MetaMask Setup for Users
1. Open MetaMask.
2. Network dropdown -> Add Network.
3. Enter:
   - Chain name: Arc Mainnet
   - RPC URL: `https://rpc.mainnet.arc.io`
   - Chain ID: `5042`
   - Currency symbol: `USDC`
   - Explorer: `https://explorer.arc.io`
4. Save and switch to Arc Mainnet.
5. Fund your wallet with USDC from an exchange or bridge (USDC is also the gas token on Arc).
6. Open Archon frontend and connect wallet.

### 6.4 Running Locally
1. Install dependencies at workspace root:

```bash
npm install
```

2. Start local chain:

```bash
npm run chain
```

3. Deploy contracts locally:

```bash
npm run deploy:contracts
```

4. Start frontend dev server:

```bash
npm run dev:frontend
```

5. Configure MetaMask localhost network:
- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Symbol: `ETH`

6. Local mock USDC
- Deploy script auto-deploys `MockUSDC` and mints to first signers on localhost.

---

## SECTION 7: GLOSSARY

- Credential: On-chain proof record that a wallet completed verified activity.
- ERC-8004: Credential schema/registry style used in this project for validation records.
- Reputation Score: Sum of credential weights, capped at 2000.
- Tier: Reputation band label.
  - Surveyor, Draftsman, Architect, Master Builder, Keystone, Arc Founder.
- Source Contract: Contract that verifies an activity and triggers credential minting through hook.
- Credential Hook: Contract gateway that accepts source completion and calls registry issue.
- Escrow: Funds held by contract until release conditions are met.
- USDC: Stablecoin used for rewards and milestone funding.
- Arc Mainnet: Target network for deployment in current config.
- Wallet: Blockchain account (public address + private key control).
- Gas: Transaction execution cost paid on chain.
- Smart Contract: On-chain program with deterministic rules.
- Milestone: Sub-unit of project deliverable with own amount/deadline.
- Arbitrator: Approved dispute voter in milestone escrow.
- DAO Governor: Governance contract queried for vote participation.
- Attestation: Peer-issued trust statement with strict limits.
- DID: Decentralized identifier string derived from chain+address in frontend.
- Deliverable Hash: Submitted reference link/hash proving output.
- Platform Fee (basis points): Protocol cut, currently 100 bps (1%).
- Operator: Wallet approved in SourceRegistry for source actions.
- Moderator: Active reviewer profile in CommunitySource.
- Sybil Attack: One actor using many wallets to fake decentralized trust.
- Time Lock: Delay constraint before sensitive state transitions are allowed.

---

## CODE SNAPSHOT GAPS / NON-DETERMINABLE ITEMS

These could not be determined exactly because they are absent or not implemented in the current repository:
- Missing admin scripts named in request:
  - `approve-operator.ts`, `revoke-operator.ts`, `approve-community.ts`, `list-pending.ts`, `platform-stats.ts`
- `frontend/src/app/404.tsx` does not exist; project uses `frontend/src/app/not-found.tsx`.
- No per-tier color mapping table exists in code; tier text/progress currently use shared accent style.
- MilestoneEscrow stores `credentialHook` address but does not mint credentials in current implementation.


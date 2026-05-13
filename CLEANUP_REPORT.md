# CLEANUP_REPORT

## Scope
Inventory and cleanup classification focused on files introduced by the previous accidental commit and top-level project structure.

| Path | Classification | Reason | Action |
|---|---|---|---|
| `contracts/` | KEEP | Core Archon smart contracts (`ERC8183Job`, `MilestoneEscrow`, deployment/test stack) | Keep as-is |
| `frontend/` | KEEP | Core Archon web app and API routes including task-context payment verification | Keep as-is |
| `deployments/` | KEEP | Archon deployment artifacts for testnet environments | Keep as-is |
| `docs/` | KEEP | Archon-related docs (e.g., agent integration) | Keep as-is |
| `scripts/test-agent.js` | KEEP | Archon task/reveal/USDC agent validation flow | Keep as-is |
| `scripts/create-archon-deck.mjs` | KEEP | Archon-specific deck generator with Archon/Arc/USDC content | Keep as-is |
| `scripts/setup-commit-workflow.ps1` | KEEP | Repo tooling explicitly branded for Archon workflow | Keep as-is |
| `README.md` | KEEP | Main Archon repository documentation | Keep as-is |
| `package.json` | KEEP | Root Archon workspace config (`contracts`, `frontend`) | Keep as-is |
| `package-lock.json` | KEEP | Root lockfile for current Archon workspace | Keep as-is |
| `Archon_Deck_Test.pptx` | KEEP | Archon presentation artifact (explicitly Archon-themed) | Keep as-is |
| `Flight-Control/` | REMOVE | Separate FHEVM Flight Control project for Zama; own repo content, unrelated to Archon runtime/flows | Remove from repo tracking |
| `agrichain-settlement/` | REMOVE | Separate Next.js AgriChain project (Solana settlement MVP), unrelated to Archon | Remove from repo |
| `agrichain-settlement-grant-response-files/` | REMOVE | AgriChain grant response docs unrelated to Archon product/scope | Remove from repo |
| `competitor-repo/` | REMOVE | Separate Zama skill repository snapshot with unrelated code/docs | Remove from repo tracking |
| `deltaguard-ai/` | REMOVE | Separate hedge-fund demo project; unrelated architecture and purpose | Remove from repo tracking |
| `setup.sh` | REMOVE | Solana.new “superstack” installer script; unrelated to Archon app/contract lifecycle | Remove from repo |
| `scripts/commit-old-files.js` | REVIEW | Generic commit automation utility; may be useful repo tooling but not core Archon runtime | Keep for manual review |
| `scripts/tmp-create-ppt.mjs` | REVIEW | Temporary Archon PPT test script; Archon-related but likely non-essential temp artifact | Keep for manual review |
| `tmp/presentations/archon-investor-deck/package.json` | REVIEW | Temporary presentation workspace artifact; unclear if still needed for deck workflow | Keep for manual review |

## Notes
- Classification was content-based. Suspicious folders were inspected via README/source content before classification.
- Items marked `REVIEW` are intentionally not deleted due uncertainty threshold.

## Audit Commands Executed
- `git status`
- `git log --oneline --decorate --max-count=30`
- `find . -maxdepth 2 -type f | sort`
- `find . -maxdepth 2 -type d | sort`

## Safety Controls
- Backup tag created before removals: `before-non-archon-cleanup`
- Deleted only `REMOVE` paths above.
- `REVIEW` paths intentionally retained.

## Verification Results
- Core paths present after cleanup staging:
  - `contracts/` = present
  - `frontend/` = present
  - `deployments/` = present
  - `scripts/` = present
  - `README.md` = present
  - `package.json` = present
- Build/compile checks:
  - Root: `npm install` = success
  - Root: `npm run build` = success
  - Contracts: `npm install` = success
  - Contracts: `npx hardhat compile` = success (`Nothing to compile`)
  - Frontend: `npm install` = success
  - Frontend: `npm run build` = success
- Non-blocking warnings:
  - Next.js lint warnings about `<img>` usage in frontend (existing, not introduced by cleanup)

## Uncertainty / Review Items
- `scripts/commit-old-files.js`
- `scripts/tmp-create-ppt.mjs`
- `tmp/presentations/archon-investor-deck/package.json`

These were not removed due uncertainty threshold and possible future utility.

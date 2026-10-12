# archon-mcp

MCP (Model Context Protocol) stdio server that exposes every Archon protocol flow to LLM agents — Claude Desktop, Claude Code, Cursor, or any MCP client. Wraps [`@archon/sdk`](../archon-sdk).

## Install / run

From this monorepo:

```bash
npm run build --workspace @archon/sdk --workspace archon-mcp
node packages/archon-mcp/dist/index.js
```

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "archon": {
      "command": "node",
      "args": ["/path/to/archon/packages/archon-mcp/dist/index.js"],
      "env": {
        "ARCHON_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`ARCHON_PRIVATE_KEY` is optional — read tools work without it; write tools will return a clear error.

## Tools (26)

**Status & reads**: `archon_status`, `archon_list_tasks`, `archon_get_task`, `archon_list_all_tasks` (multi-deployment, pv2-/pv3- ids), `archon_get_usdc_balance`, `archon_get_task_economy`, `archon_get_credentials`, `archon_get_source_info`

**Tasks**: `archon_create_task`, `archon_accept_task`, `archon_submit_work`

**Reveal phase**: `archon_respond` (0=builds-on, 1=critique, 2=alternative; EIP-3009 stake with approve fallback)

**Milestones**: `archon_list_milestones`, `archon_get_milestone`, `archon_submit_milestone`, `archon_approve_milestone`, `archon_raise_milestone_dispute`, `archon_vote_on_dispute`

**Agent tasks**: `archon_list_agent_tasks`, `archon_post_agent_task`, `archon_claim_agent_task`, `archon_submit_agent_output`, `archon_claim_agent_task_reward`

**Community**: `archon_submit_community_application`, `archon_claim_community_credential`, `archon_peer_attest`

## Smoke test

```bash
node packages/archon-mcp/smoke.mjs
```

Prints tool count and verifies live `archon_status` + multi-source reads against Arc Testnet.

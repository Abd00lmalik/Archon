# Vercel Environment Configuration

Use direct environment variable values in the Vercel dashboard for this project.

## Required RPC variables

Set one of these values as a full URL string:

- `NEXT_PUBLIC_RPC_URL`
- `NEXT_PUBLIC_XION_RPC_URL` (legacy alias supported)
- `NEXT_PUBLIC_ARC_RPC_URL`

Example value:

- `https://rpc.xion-testnet-2.burnt.com:443`

## Important

Do not use secret-style placeholders (for example, values that start with `@`).
If a value starts with `@`, the frontend now ignores it and falls back to a valid URL.

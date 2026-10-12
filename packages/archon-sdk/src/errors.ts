export function errorMessage(error: unknown): string {
  if (!error) return String(error);
  const e = error as { reason?: string; shortMessage?: string; message?: string };
  return String(e.reason ?? e.shortMessage ?? e.message ?? error).slice(0, 300);
}

export function isTransientRpcError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("txpool is full") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("rate limit")
  );
}

export async function withRetry<T>(_label: string, action: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || attempt === retries) throw error;
      const delayMs = attempt * 2500;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function decodeRevertHint(error: unknown): string {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  if (lower.includes("missing revert data") || lower.includes("execution reverted")) {
    return "Transaction reverted (empty reason — contract compiled with stripped revert strings). Check preconditions: task status, ownership, deadlines, and allowances.";
  }
  if (lower.includes("insufficient allowance") || lower.includes("transfer amount exceeds allowance")) {
    return "USDC allowance too low — call ensureAllowance/usdc.approve first.";
  }
  if (lower.includes("insufficient funds")) {
    return "Wallet has insufficient native gas token for this transaction.";
  }
  return message;
}

export function formatEthLike(value: bigint | string | number, decimals = 6): string {
  try {
    const raw = BigInt(value as string | number | bigint);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

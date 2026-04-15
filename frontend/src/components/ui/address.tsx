"use client";

import { useState } from "react";

type Props = {
  address: string;
  chars?: number;
};

function shortenAddress(value: string, chars: number) {
  if (!value || value.length <= chars * 2 + 2) return value;
  return `${value.slice(0, chars + 2)}...${value.slice(-chars)}`;
}

export function Address({ address, chars = 4 }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button type="button" onClick={() => void handleCopy()} className="mono text-xs text-[var(--text-data)] hover:text-white transition-colors">
      {copied ? "Copied" : shortenAddress(address, chars)}
    </button>
  );
}

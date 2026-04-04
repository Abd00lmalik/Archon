"use client";

import { useCallback, useEffect, useState } from "react";
import {
  expectedChainId,
  fetchCredentialsForAgent,
  fetchPeerAttestationsForRecipient,
  fetchPeerAttestationsGiven,
  getSourceReadContract,
  txPeerAttest
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type Tab = "give" | "mine";

export default function AttestPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<Tab>("give");
  const [credentialCount, setCredentialCount] = useState(0);
  const [remainingGiven, setRemainingGiven] = useState(3);
  const [remainingReceived, setRemainingReceived] = useState(2);
  const [recipient, setRecipient] = useState("");
  const [category, setCategory] = useState("technical");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [received, setReceived] = useState<Array<{ id: number; from: string; category: string; note: string }>>([]);
  const [given, setGiven] = useState<Array<{ id: number; to: string; category: string; note: string }>>([]);

  const load = useCallback(async () => {
    if (!account) {
      setCredentialCount(0);
      setReceived([]);
      setGiven([]);
      return;
    }
    try {
      const [credentials, receivedRows, givenRows] = await Promise.all([
        fetchCredentialsForAgent(account),
        fetchPeerAttestationsForRecipient(account),
        fetchPeerAttestationsGiven(account)
      ]);
      setCredentialCount(credentials.length);
      setReceived(receivedRows.map((item) => ({ id: item.attestationId, from: item.attester, category: item.category, note: item.note })));
      setGiven(givenRows.map((item) => ({ id: item.attestationId, to: item.recipient, category: item.category, note: item.note })));

      const peer = getSourceReadContract("peer_attestation");
      const [givenCount, receivedCount] = (await Promise.all([
        peer.attestationsGivenThisWeek(account),
        peer.attestationsReceivedThisWeek(account)
      ])) as [bigint, bigint];

      setRemainingGiven(Math.max(0, 3 - Number(givenCount)));
      setRemainingReceived(Math.max(0, 2 - Number(receivedCount)));
    } catch {
      setRemainingGiven(0);
      setRemainingReceived(0);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAttest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");
    setSubmitting(true);

    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }
      if (credentialCount < 1) {
        throw new Error("You need at least 1 credential before attesting others.");
      }
      if (note.trim().length > 200) {
        throw new Error("Note must be 200 characters or fewer.");
      }
      const tx = await txPeerAttest(provider, recipient.trim(), category, note.trim());
      setStatus(`Attestation transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Attestation sent and credential minted to recipient.");
      setRecipient("");
      setNote("");
      await load();
    } catch (attestError) {
      setError(attestError instanceof Error ? attestError.message : "Failed to attest.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Peer Attestation</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Web-of-trust signals with anti-spam weekly caps.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("give")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "give" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Give Attestation
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "mine" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            My Attestations
          </button>
        </div>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {tab === "give" ? (
        <div className="archon-card p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Credential count: <span className="text-[#EAEAF0]">{credentialCount}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Weekly remaining (give): <span className="text-[#EAEAF0]">{remainingGiven}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Weekly received room: <span className="text-[#EAEAF0]">{remainingReceived}</span>
            </div>
          </div>

          <form onSubmit={handleAttest} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Recipient wallet address
              <input
                className="archon-input mt-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Category
              <select className="archon-input mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="technical">Technical</option>
                <option value="community">Community</option>
                <option value="reliability">Reliability</option>
                <option value="creativity">Creativity</option>
              </select>
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Note (max 200 chars)
              <textarea
                className="archon-input mt-1 min-h-20"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                required
              />
            </label>
            <button
              type="submit"
              disabled={submitting || credentialCount < 1}
              className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Send Attestation"}
            </button>
          </form>
        </div>
      ) : null}

      {tab === "mine" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Received</h2>
            {received.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No attestations received yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {received.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                    #{item.id} · {item.category} · from {item.from.slice(0, 8)}...{item.from.slice(-4)}
                    <p className="mt-1">{item.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Given</h2>
            {given.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No attestations sent yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {given.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                    #{item.id} · {item.category} · to {item.to.slice(0, 8)}...{item.to.slice(-4)}
                    <p className="mt-1">{item.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

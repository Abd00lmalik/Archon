"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  IconArc,
  IconCheck,
  IconGovernance,
  IconShield,
  IconStar,
  IconTask,
  IconTrending,
  IconWallet
} from "@/lib/icons";

type TutorialStep = {
  id: number;
  title: string;
  content: string;
  highlight: string | null;
  icon: "arc" | "wallet" | "shield" | "task" | "check" | "star" | "trending" | "governance";
  link?: { label: string; url: string };
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 1,
    title: "Welcome to Archon",
    content:
      "Archon is a universal on-chain reputation system. Complete real work, earn permanent credentials that prove your skills to anyone - forever.",
    highlight: null,
    icon: "arc"
  },
  {
    id: 2,
    title: "Connect Your Wallet",
    content:
      "Your wallet is your identity on Archon. Click 'Connect Wallet' in the top right and choose your preferred wallet. Your reputation is tied to your wallet address.",
    highlight: "connect-wallet-button",
    icon: "wallet"
  },
  {
    id: 3,
    title: "Get Testnet USDC",
    content:
      "Archon runs on Arc Testnet. You need testnet USDC to interact with contracts. Visit faucet.arc.network, connect your wallet, and request free testnet USDC.",
    highlight: null,
    icon: "shield",
    link: { label: "Go to Faucet ->", url: "https://faucet.arc.network" }
  },
  {
    id: 4,
    title: "Browse and Complete Tasks",
    content:
      "The home page shows open tasks with USDC rewards. Click 'View & Apply' on any task, accept it, submit your work as a URL link, and wait for the creator to review it.",
    highlight: null,
    icon: "task"
  },
  {
    id: 5,
    title: "Get Approved and Claim",
    content:
      "When your submission is approved, you can claim your USDC reward and mint a credential to your wallet. This credential is permanent - it cannot be deleted or transferred.",
    highlight: null,
    icon: "check"
  },
  {
    id: 6,
    title: "Post Tasks (Requires Approval)",
    content:
      "Want to post tasks for others? Go to the Apply page and submit an operator application. Once approved by the platform, you can create tasks with USDC reward pools.",
    highlight: null,
    icon: "star",
    link: { label: "Apply to Post Tasks ->", url: "/apply" }
  },
  {
    id: 7,
    title: "Build Your Reputation",
    content:
      "Every credential adds points to your score. Reach Architect (300 pts), Master Builder (600 pts), Keystone (1000 pts), and Arc Founder (1500 pts). Keystone unlocks peer vouching.",
    highlight: null,
    icon: "trending"
  },
  {
    id: 8,
    title: "More Ways to Earn",
    content:
      "Beyond tasks: prove DAO governance votes instantly, earn community credentials for technical contributions, and get vouched by Keystone-tier members. Explore the Earn page.",
    highlight: null,
    icon: "governance",
    link: { label: "Explore Earn ->", url: "/earn" }
  },
  {
    id: 9,
    title: "You are Ready",
    content:
      "Your credentials are publicly verifiable at /verify/[wallet-address]. Share your profile link to prove your on-chain reputation to anyone, anywhere.",
    highlight: null,
    icon: "arc"
  }
];

function getStepIcon(icon: TutorialStep["icon"]) {
  const className = "h-12 w-12 text-[#00FFC8]";
  if (icon === "wallet") return <IconWallet className={className} />;
  if (icon === "shield") return <IconShield className={className} />;
  if (icon === "task") return <IconTask className={className} />;
  if (icon === "check") return <IconCheck className={className} />;
  if (icon === "star") return <IconStar className={className} />;
  if (icon === "trending") return <IconTrending className={className} />;
  if (icon === "governance") return <IconGovernance className={className} />;
  return <IconArc className={className} />;
}

export const TUTORIAL_STORAGE_KEY = "archon_tutorial_seen";

export function Tutorial({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "back">("next");
  const [animateKey, setAnimateKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setStepIndex(0);
    setDirection("next");
    setAnimateKey((value) => value + 1);
  }, [isOpen]);

  const step = TUTORIAL_STEPS[stepIndex];
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;

  const animationClass = useMemo(() => {
    if (direction === "back") {
      return "tutorial-slide-left";
    }
    return "tutorial-slide-right";
  }, [direction, animateKey]);

  const markSeenAndClose = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      onClick={markSeenAndClose}
      role="dialog"
      aria-modal="true"
      aria-label="Archon tutorial"
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-white/15 bg-[#0f1116] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Step {stepIndex + 1} of {TUTORIAL_STEPS.length}
          </p>
          <button
            type="button"
            onClick={markSeenAndClose}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-[#9CA3AF] hover:border-white/25 hover:text-white"
            aria-label="Close tutorial"
          >
            X
          </button>
        </div>

        <div key={`${step.id}-${animateKey}`} className={`mt-5 ${animationClass}`}>
          <div className="flex justify-center">{getStepIcon(step.icon)}</div>
          <h2 className="mt-4 text-center text-2xl font-semibold text-[#EAEAF0]">{step.title}</h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-[#9CA3AF]">{step.content}</p>

          {step.link ? (
            <div className="mt-4 flex justify-center">
              {step.link.url.startsWith("http") ? (
                <a
                  href={step.link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="archon-button-secondary px-3 py-1.5 text-xs"
                >
                  {step.link.label}
                </a>
              ) : (
                <Link href={step.link.url} className="archon-button-secondary px-3 py-1.5 text-xs">
                  {step.link.label}
                </Link>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={markSeenAndClose} className="text-xs text-[#7E8798] hover:text-[#EAEAF0]">
            Skip tutorial
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setDirection("back");
                  setStepIndex((index) => Math.max(0, index - 1));
                  setAnimateKey((value) => value + 1);
                }}
                className="archon-button-secondary px-3 py-2 text-xs"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  markSeenAndClose();
                  return;
                }
                setDirection("next");
                setStepIndex((index) => Math.min(TUTORIAL_STEPS.length - 1, index + 1));
                setAnimateKey((value) => value + 1);
              }}
              className="archon-button-primary px-4 py-2 text-xs"
            >
              {isLast ? "Start Building ->" : "Next ->"}
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-1.5">
          {TUTORIAL_STEPS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (index === stepIndex) return;
                setDirection(index < stepIndex ? "back" : "next");
                setStepIndex(index);
                setAnimateKey((value) => value + 1);
              }}
              aria-label={`Go to tutorial step ${index + 1}`}
              className={`rounded-full transition-all ${
                index === stepIndex ? "h-2.5 w-2.5 bg-[#00FFC8]" : "h-2 w-2 bg-[#3E4556] hover:bg-[#64748b]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

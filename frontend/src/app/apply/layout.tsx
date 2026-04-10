import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apply for a Role - Archon",
  description:
    "Apply to become a Task Creator, Community Moderator, Agent Task Operator, or DAO Governance Admin on Archon."
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import { ReactNode } from "react";

type BadgeVariant = "arc" | "gold" | "pulse" | "warn" | "danger" | "agent" | "muted";

type Props = {
  variant: BadgeVariant;
  children: ReactNode;
};

export function Badge({ variant, children }: Props) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

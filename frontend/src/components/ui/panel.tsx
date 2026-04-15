import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function Panel({ children, className = "" }: Props) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function PanelElevated({ children, className = "" }: Props) {
  return <div className={`panel-elevated ${className}`}>{children}</div>;
}

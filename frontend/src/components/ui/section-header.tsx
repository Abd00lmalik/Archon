import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function SectionHeader({ children }: Props) {
  return <div className="section-header">{children}</div>;
}

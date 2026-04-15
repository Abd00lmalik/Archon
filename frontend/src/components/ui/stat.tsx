type Props = {
  value: string | number;
  label: string;
  accent?: string;
};

export function StatBlock({ value, label, accent = "var(--arc)" }: Props) {
  return (
    <div className="stat-block" style={{ borderColor: accent }}>
      <div className="stat-number" style={{ color: accent }}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

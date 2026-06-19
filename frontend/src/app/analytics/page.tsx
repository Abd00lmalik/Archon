import Link from "next/link";
import { fetchAnalyticsData } from "@/lib/analytics";
import {
  DailyActiveUsersChart,
  DailyTasksChart,
  DailyVolumeChart,
  StatusBreakdownChart
} from "@/components/analytics-charts";

export const revalidate = 600; // Cache the page for 10 minutes at the Edge

function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "N/A";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}

export default async function AnalyticsPage() {
  let data;
  let errorMsg = null;

  try {
    data = await fetchAnalyticsData();
  } catch (err: unknown) {
    console.error("[analytics/page] Failed to pre-fetch analytics:", err);
    errorMsg = err instanceof Error ? err.message : "Failed to connect to the Arc Testnet RPC node.";
  }

  if (errorMsg || !data) {
    return (
      <main className="page-container min-h-[70vh] flex flex-col items-center justify-center p-6">
        <div className="panel max-w-md w-full border border-danger/30 bg-danger/5 p-6 rounded-2xl text-center space-y-4">
          <div className="text-danger text-4xl">⚠️</div>
          <h2 className="heading text-xl font-bold text-text-primary">Analytics Unavailable</h2>
          <p className="font-mono text-sm text-text-secondary">
            {errorMsg || "Could not retrieve stats from blockchain contracts."}
          </p>
          <div className="pt-4">
            <Link href="/" className="btn-primary inline-block">
              Back to Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { metrics, statusBreakdown, dailySeries } = data;

  return (
    <main className="page-container space-y-8 py-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="heading text-3xl font-extrabold text-text-primary tracking-tight">
            Archon Analytics
          </h1>
          <p className="font-mono text-xs text-text-muted mt-1 uppercase tracking-widest">
            Public Performance & Ecosystem Activity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-arc animate-pulse-dot" />
          <span className="font-mono text-xs text-text-secondary uppercase">
            RPC Indexer: Active (Cached 10m)
          </span>
        </div>
      </div>

      {/* Grid: Main Marketplace KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Bounties Posted */}
        <div className="panel flex flex-col justify-between p-5 border border-border bg-surface/30">
          <div>
            <div className="font-mono text-xs text-text-muted uppercase tracking-wider">
              Total Bounties Posted
            </div>
            <div className="heading text-3xl font-bold text-text-primary mt-2">
              {metrics.totalBountiesPosted}
            </div>
          </div>
          <div className="font-mono text-[10px] text-text-secondary mt-4 flex justify-between">
            <span>Jobs: {metrics.totalBountiesPosted - statusBreakdown.refunded}</span>
            <span>Refunded: {statusBreakdown.refunded}</span>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="panel flex flex-col justify-between p-5 border border-border bg-surface/30">
          <div>
            <div className="font-mono text-xs text-text-muted uppercase tracking-wider">
              Completion Rate
            </div>
            <div className="heading text-3xl font-bold text-text-primary mt-2">
              {metrics.completionRate}%
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full h-1.5 bg-void rounded-full overflow-hidden">
              <div 
                className="h-full bg-arc transition-all" 
                style={{ width: `${metrics.completionRate}%` }}
              />
            </div>
            <div className="font-mono text-[10px] text-text-secondary mt-2 flex justify-between">
              <span>Completed: {metrics.totalBountiesCompleted}</span>
              <span>Total: {metrics.totalBountiesPosted}</span>
            </div>
          </div>
        </div>

        {/* Total USDC Escrowed */}
        <div className="panel flex flex-col justify-between p-5 border border-border bg-surface/30">
          <div>
            <div className="font-mono text-xs text-text-muted uppercase tracking-wider">
              Total USDC Escrowed
            </div>
            <div className="heading text-3xl font-bold text-gold mt-2">
              ${metrics.totalUSDCEscrowed.toLocaleString()}
            </div>
          </div>
          <div className="font-mono text-[10px] text-text-secondary mt-4">
            Active reward pool waiting in smart contracts
          </div>
        </div>

        {/* Total USDC Paid */}
        <div className="panel flex flex-col justify-between p-5 border border-border bg-surface/30">
          <div>
            <div className="font-mono text-xs text-text-muted uppercase tracking-wider">
              Total USDC Paid
            </div>
            <div className="heading text-3xl font-bold text-arc mt-2">
              ${metrics.totalUSDCPaid.toLocaleString()}
            </div>
          </div>
          <div className="font-mono text-[10px] text-text-secondary mt-4">
            Direct contributor payouts completed
          </div>
        </div>
      </div>

      {/* Grid: Secondary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Average Reward */}
        <div className="panel p-4 border border-border bg-surface/20">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider block">
            Average Reward
          </span>
          <span className="heading text-xl font-bold text-text-primary mt-1 block">
            ${metrics.averageReward.toLocaleString()} USDC
          </span>
        </div>

        {/* Average Completion Time */}
        <div className="panel p-4 border border-border bg-surface/20">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider block">
            Avg Completion Time
          </span>
          <span className="heading text-xl font-bold text-text-primary mt-1 block">
            {formatTime(metrics.averageCompletionTime)}
          </span>
        </div>

        {/* Total Users */}
        <div className="panel p-4 border border-border bg-surface/20">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider block">
            Total Unique Users
          </span>
          <span className="heading text-xl font-bold text-text-primary mt-1 block">
            {metrics.totalUsers}
          </span>
        </div>

        {/* Active Agents */}
        <div className="panel p-4 border border-border bg-surface/20">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider block">
            Active Agents
          </span>
          <span className="heading text-xl font-bold text-agent mt-1 block">
            {metrics.activeAgents}
          </span>
        </div>

        {/* Active Clients */}
        <div className="panel p-4 border border-border bg-surface/20">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-wider block">
            Active Clients
          </span>
          <span className="heading text-xl font-bold text-arc mt-1 block">
            {metrics.activeClients}
          </span>
        </div>
      </div>

      {/* Grid: Charts Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily Active Users Chart */}
        <div className="panel space-y-4 p-5 border border-border bg-surface/30">
          <div>
            <h3 className="heading text-base font-bold text-text-primary">
              Daily Active Users (DAU)
            </h3>
            <p className="font-mono text-[10px] text-text-muted mt-0.5">
              Unique interacting wallets per day over the past 30 days
            </p>
          </div>
          <DailyActiveUsersChart data={dailySeries} />
        </div>

        {/* Daily Tasks Chart */}
        <div className="panel space-y-4 p-5 border border-border bg-surface/30">
          <div>
            <h3 className="heading text-base font-bold text-text-primary">
              Daily Tasks Activity
            </h3>
            <p className="font-mono text-[10px] text-text-muted mt-0.5">
              Comparison of new bounties posted vs completed per day
            </p>
          </div>
          <DailyTasksChart data={dailySeries} />
        </div>

        {/* Daily Volume Chart */}
        <div className="panel space-y-4 p-5 border border-border bg-surface/30">
          <div>
            <h3 className="heading text-base font-bold text-text-primary">
              Daily Transaction Volume
            </h3>
            <p className="font-mono text-[10px] text-text-muted mt-0.5">
              USDC rewards paid out to contributors per day
            </p>
          </div>
          <DailyVolumeChart data={dailySeries} />
        </div>

        {/* Status Breakdown Donut Chart */}
        <div className="panel space-y-4 p-5 border border-border bg-surface/30">
          <div>
            <h3 className="heading text-base font-bold text-text-primary">
              Task Status Distribution
            </h3>
            <p className="font-mono text-[10px] text-text-muted mt-0.5">
              Current state breakdown of all tasks in the system
            </p>
          </div>
          <StatusBreakdownChart breakdown={statusBreakdown} />
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-6 border-t border-border flex justify-between items-center text-xs text-text-muted font-mono">
        <span>Archon Analytics &copy; {new Date().getFullYear()}</span>
        <Link href="/" className="text-arc hover:underline uppercase tracking-widest font-bold">
          Go to Command Center &rarr;
        </Link>
      </div>
    </main>
  );
}

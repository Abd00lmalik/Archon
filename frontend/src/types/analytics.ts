export interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  activeUsers: number;
  tasksCreated: number;
  tasksCompleted: number;
  volumeUSDC: number;
}

export interface ArchonAnalyticsData {
  metrics: {
    totalBountiesPosted: number;
    totalBountiesCompleted: number;
    completionRate: number;
    averageReward: number;
    averageCompletionTime: number; // in seconds
    totalUSDCPaid: number;
    totalUSDCEscrowed: number;
    activeAgents: number;
    activeClients: number;
    totalUsers: number;
  };
  statusBreakdown: {
    open: number;
    underReview: number;
    completed: number;
    refunded: number;
  };
  dailySeries: ChartDataPoint[];
}

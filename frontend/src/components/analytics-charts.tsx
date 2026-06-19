"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import { ChartDataPoint } from "@/types/analytics";

interface ChartProps {
  data: ChartDataPoint[];
}

interface StatusProps {
  breakdown: {
    open: number;
    underReview: number;
    completed: number;
    refunded: number;
  };
}

export function DailyActiveUsersChart({ data }: ChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-72 w-full animate-pulse bg-surface/50 rounded-xl border border-border" />;
  }

  // Format date for chart axis (e.g. "Jun 19")
  const formattedData = data.map((d) => {
    const parts = d.date.split("-");
    if (parts.length === 3) {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = monthNames[parseInt(parts[1], 10) - 1];
      return {
        ...d,
        displayDate: `${month} ${parts[2]}`
      };
    }
    return { ...d, displayDate: d.date };
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="userGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00f2fe" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#00f2fe" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
          <XAxis
            dataKey="displayDate"
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#12131e",
              border: "1px solid #333",
              borderRadius: "8px",
              color: "#fff"
            }}
            labelStyle={{ color: "#888", fontWeight: "bold" }}
          />
          <Area
            type="monotone"
            dataKey="activeUsers"
            name="Active Users"
            stroke="#00f2fe"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#userGlow)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyTasksChart({ data }: ChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-72 w-full animate-pulse bg-surface/50 rounded-xl border border-border" />;
  }

  const formattedData = data.map((d) => {
    const parts = d.date.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const displayDate = parts.length === 3 ? `${monthNames[parseInt(parts[1], 10) - 1]} ${parts[2]}` : d.date;
    return { ...d, displayDate };
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
          <XAxis
            dataKey="displayDate"
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#12131e",
              border: "1px solid #333",
              borderRadius: "8px",
              color: "#fff"
            }}
            labelStyle={{ color: "#888", fontWeight: "bold" }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            wrapperStyle={{ fontSize: "12px", color: "#ccc" }}
          />
          <Bar dataKey="tasksCreated" name="Posted" fill="#7000ff" radius={[4, 4, 0, 0]} />
          <Bar dataKey="tasksCompleted" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyVolumeChart({ data }: ChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-72 w-full animate-pulse bg-surface/50 rounded-xl border border-border" />;
  }

  const formattedData = data.map((d) => {
    const parts = d.date.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const displayDate = parts.length === 3 ? `${monthNames[parseInt(parts[1], 10) - 1]} ${parts[2]}` : d.date;
    return { ...d, displayDate };
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f5a623" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#f5a623" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
          <XAxis
            dataKey="displayDate"
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            stroke="#666"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#12131e",
              border: "1px solid #333",
              borderRadius: "8px",
              color: "#fff"
            }}
            formatter={(val) => [`$${val}`, "Volume (USDC)"]}
            labelStyle={{ color: "#888", fontWeight: "bold" }}
          />
          <Area
            type="monotone"
            dataKey="volumeUSDC"
            name="Daily Volume"
            stroke="#f5a623"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#volumeGlow)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusBreakdownChart({ breakdown }: StatusProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-72 w-full animate-pulse bg-surface/50 rounded-xl border border-border" />;
  }

  const data = [
    { name: "Open", value: breakdown.open, color: "#3b82f6" },
    { name: "Under Review", value: breakdown.underReview, color: "#f59e0b" },
    { name: "Completed", value: breakdown.completed, color: "#10b981" },
    { name: "Refunded", value: breakdown.refunded, color: "#ef4444" }
  ].filter((item) => item.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex h-72 w-full items-center justify-center text-text-muted">
        No active tasks found
      </div>
    );
  }

  return (
    <div className="flex h-72 w-full flex-col items-center justify-center sm:flex-row">
      <div className="h-56 w-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={75}
              paddingAngle={4}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#12131e",
                border: "1px solid #333",
                borderRadius: "8px",
                color: "#fff"
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:mt-0 sm:ml-6">
        {data.map((item, index) => (
          <div key={index} className="flex items-center text-sm">
            <span
              className="mr-2 h-3.5 w-3.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-text-secondary font-medium mr-2">{item.name}:</span>
            <span className="text-text-primary font-bold">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

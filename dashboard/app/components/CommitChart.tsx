"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import type { CommitRecord } from "../hooks/useCommits";

const THRESHOLD = 120;

type ChartPoint = {
  time: string;
  bpm: number;
  result: "accepted" | "rejected";
  repo: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

type TooltipPayload = {
  payload: ChartPoint;
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
      <p className={`font-bold ${d.result === "accepted" ? "text-red-400" : "text-zinc-400"}`}>
        {d.result === "accepted" ? "🔥 ACCEPTED" : "💔 REJECTED"}
      </p>
      <p className="text-white font-mono">{d.bpm} bpm</p>
      <p className="text-zinc-500 text-xs mt-1">{d.time}</p>
      <p className="text-zinc-600 text-xs truncate max-w-[180px]">{d.repo.split("/").pop()}</p>
    </div>
  );
}

type Props = {
  commits: CommitRecord[];
};

export function CommitChart({ commits }: Props) {
  // API returns newest-first; reverse to show oldest→newest left to right
  const data: ChartPoint[] = [...commits].reverse().map((c) => ({
    time: formatTime(c.attempted_at),
    bpm: c.bpm,
    result: c.result,
    repo: c.repo_path,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">
        コミット履歴なし
      </div>
    );
  }

  const accepted = commits.filter((c) => c.result === "accepted").length;
  const rejected = commits.filter((c) => c.result === "rejected").length;
  const maxBpm = Math.max(...commits.map((c) => c.bpm));
  const avgBpm = Math.round(commits.reduce((s, c) => s + c.bpm, 0) / commits.length);

  return (
    <div className="flex flex-col gap-4">
      {/* Mini stats */}
      <div className="flex gap-6 text-sm">
        <span><span className="text-red-400 font-bold">{accepted}</span> <span className="text-zinc-500">accepted</span></span>
        <span><span className="text-zinc-500 font-bold">{rejected}</span> <span className="text-zinc-600">rejected</span></span>
        <span><span className="text-zinc-300 font-bold">{avgBpm}</span> <span className="text-zinc-600">avg bpm</span></span>
        <span><span className="text-orange-400 font-bold">{maxBpm}</span> <span className="text-zinc-600">max bpm</span></span>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="time"
            tick={{ fill: "#52525b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[40, (max: number) => Math.max(max + 10, THRESHOLD + 20)]}
            tick={{ fill: "#52525b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <ReferenceLine
            y={THRESHOLD}
            stroke="#71717a"
            strokeDasharray="4 4"
            label={{ value: `${THRESHOLD}`, fill: "#71717a", fontSize: 11, position: "right" }}
          />
          <Bar dataKey="bpm" radius={[3, 3, 0, 0]} maxBarSize={32}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.result === "accepted" ? "#ef4444" : "#3f3f46"}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

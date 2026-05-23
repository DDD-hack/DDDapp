"use client";

import type { CommitRecord } from "../hooks/useCommits";

const CHART_HEIGHT = 200;
const Y_MIN = 60;
const Y_MAX = 180;
const Y_RANGE = Y_MAX - Y_MIN;
const MAX_BARS = 20;
const Y_LABELS = [180, 150, 120, 90, 60];

type ChartPoint = {
  time: string;
  bpm: number;
  result: "accepted" | "rejected";
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function barHeightPx(bpm: number): number {
  return Math.min(Math.max(((bpm - Y_MIN) / Y_RANGE) * CHART_HEIGHT, 4), CHART_HEIGHT);
}

function avgBottomPx(avg: number): number {
  return Math.min(Math.max(((avg - Y_MIN) / Y_RANGE) * CHART_HEIGHT, 0), CHART_HEIGHT);
}

type Props = {
  commits: CommitRecord[];
};

export function CommitChart({ commits }: Props) {
  if (commits.length === 0) {
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

  // Newest commits first → slice → reverse to oldest-left / newest-right
  const display: ChartPoint[] = [...commits]
    .slice(0, MAX_BARS)
    .reverse()
    .map((c) => ({
      time: formatTime(c.attempted_at),
      bpm: c.bpm,
      result: c.result,
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard value={accepted} label="accepted" color="#10B981" />
        <StatCard value={rejected} label="rejected" color="#EF4444" />
        <StatCard value={avgBpm} label="avg bpm" color="#FFFFFF" />
        <StatCard value={maxBpm} label="max bpm" color="#F97316" />
      </div>

      {/* Chart card */}
      <div
        className="rounded-2xl border flex flex-col gap-4"
        style={{
          background: "#1A1A2E",
          borderColor: "rgba(255,255,255,0.06)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
          padding: "24px 24px 20px",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "#E5E7EB" }}>
            BPM Timeline
          </span>
          <span className="text-[11px]" style={{ color: "#6B7280" }}>
            Last {display.length} commits
          </span>
        </div>

        {/* Chart body: Y-axis + bars */}
        <div className="flex items-end gap-3">
          {/* Y-axis labels */}
          <div
            className="flex flex-col justify-between shrink-0 pb-[26px]"
            style={{ height: CHART_HEIGHT + 26 }}
          >
            {Y_LABELS.map((v) => (
              <span
                key={v}
                className="leading-none tabular-nums"
                style={{ fontSize: 11, color: "#4B5563" }}
              >
                {v}
              </span>
            ))}
          </div>

          {/* Bar area + BPM labels + time labels */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Bar area */}
            <div
              className="relative flex items-end gap-1.5"
              style={{ height: CHART_HEIGHT }}
            >
              {/* Avg BPM dashed line */}
              <div
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  bottom: avgBottomPx(avgBpm),
                  borderTop: "1px dashed #F59E0B",
                  opacity: 0.7,
                }}
              />

              {display.map((d, i) => (
                <div
                  key={i}
                  className="flex-1 h-full flex items-end"
                  title={`${d.bpm} bpm · ${d.result}`}
                >
                  <div
                    style={{
                      width: "100%",
                      height: barHeightPx(d.bpm),
                      background:
                        d.result === "accepted"
                          ? "linear-gradient(to bottom, #EF4444, #F97316)"
                          : "linear-gradient(to bottom, #374151, #4B5563)",
                      borderRadius: "8px 8px 2px 2px",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* BPM labels */}
            <div className="flex gap-1.5 pt-1.5">
              {display.map((d, i) => (
                <span
                  key={i}
                  className="flex-1 text-center leading-none font-semibold tabular-nums"
                  style={{
                    fontSize: 10,
                    color: d.result === "accepted" ? "#F97316" : "#6B7280",
                  }}
                >
                  {d.bpm}
                </span>
              ))}
            </div>

            {/* Time labels */}
            <div className="flex gap-1.5 pt-1">
              {display.map((d, i) => (
                <span
                  key={i}
                  className="flex-1 text-center leading-none"
                  style={{ fontSize: 10, color: "#4B5563" }}
                >
                  {d.time}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Separator */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

        {/* Legend */}
        <div className="flex items-center gap-6">
          <LegendSquare
            gradient="linear-gradient(to right, #EF4444, #F97316)"
            label="Accepted"
          />
          <LegendSquare
            gradient="linear-gradient(to right, #374151, #4B5563)"
            label="Rejected"
          />
          <LegendLine label={`Avg BPM (${avgBpm})`} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border"
      style={{
        background: "#1A1A2E",
        borderColor: "rgba(255,255,255,0.06)",
        padding: "16px 20px",
      }}
    >
      <span
        className="text-3xl font-bold tabular-nums leading-none"
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-xs font-medium" style={{ color: "#6B7280" }}>
        {label}
      </span>
    </div>
  );
}

function LegendSquare({ gradient, label }: { gradient: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: gradient,
          flexShrink: 0,
        }}
      />
      <span className="text-xs font-medium" style={{ color: "#9CA3AF" }}>
        {label}
      </span>
    </div>
  );
}

function LegendLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          width: 20,
          height: 2,
          background: "#F59E0B",
          borderRadius: 1,
          flexShrink: 0,
        }}
      />
      <span className="text-xs font-medium" style={{ color: "#9CA3AF" }}>
        {label}
      </span>
    </div>
  );
}

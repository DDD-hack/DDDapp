"use client";

import type { CommitRecord } from "../hooks/useCommits";

type Props = {
  commits: CommitRecord[];
  mode?: "both" | "today" | "cumulative";
};

const GAUGE_FRACTION = 260 / 360;
const SIZE = 160;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 62;
const CIRCUMFERENCE = 2 * Math.PI * R;
const START_ROTATION = 140;

function rateColor(rate: number): string {
  if (rate >= 0.8) return "#ef4444";
  if (rate >= 0.5) return "#eab308";
  return "#71717a";
}

function getTitle(rate: number, total: number): string | null {
  if (total === 0) return null;
  if (rate === 1 && total >= 3) return "完全燃焼の開発者";
  if (rate >= 0.8) return "情熱の申し子";
  if (rate >= 0.5) return "燃え上がり中";
  if (rate >= 0.3) return "心拍不足気味";
  return "要ダッシュ";
}

export function SuccessRateCard({ commits, mode = "both" }: Props) {
  const total = commits.length;
  const accepted = commits.filter((c) => c.result === "accepted").length;
  const rate = total > 0 ? accepted / total : 0;
  const pct = Math.round(rate * 100);
  const color = rateColor(rate);
  const title = getTitle(rate, total);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCommits = commits.filter(
    (c) => new Date(c.attempted_at) >= todayStart
  );
  const todayTotal = todayCommits.length;
  const todayAccepted = todayCommits.filter((c) => c.result === "accepted").length;
  const todayRate =
    todayTotal > 0 ? Math.round((todayAccepted / todayTotal) * 100) : null;
  const todayMaxBpm =
    todayTotal > 0 ? Math.max(...todayCommits.map((c) => c.bpm)) : null;

  const bgLength = CIRCUMFERENCE * GAUGE_FRACTION;
  const fillLength = bgLength * rate;

  return (
    <section className="border-t border-zinc-900 px-8 py-6">
      {mode === "both" || mode === "cumulative" ? (
        <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
          SUCCESS RATE
        </h2>
      ) : null}
      <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
        {/* Arc gauge（全期間） */}
        {(mode === "both" || mode === "cumulative") && (
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <svg width={SIZE} height={SIZE}>
                {/* Background arc */}
                <circle
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="none"
                  stroke="#27272a"
                  strokeWidth={12}
                  strokeDasharray={`${bgLength} ${CIRCUMFERENCE}`}
                  strokeLinecap="round"
                  transform={`rotate(${START_ROTATION}, ${CX}, ${CY})`}
                />
                {/* Fill arc */}
                {total > 0 && (
                  <circle
                    cx={CX}
                    cy={CY}
                    r={R}
                    fill="none"
                    stroke={color}
                    strokeWidth={12}
                    strokeDasharray={`${fillLength} ${CIRCUMFERENCE}`}
                    strokeLinecap="round"
                    transform={`rotate(${START_ROTATION}, ${CX}, ${CY})`}
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span
                  className="text-3xl font-black tabular-nums leading-none"
                  style={{ color: total > 0 ? color : "#52525b" }}
                >
                  {total > 0 ? `${pct}%` : "--"}
                </span>
                <span className="text-[10px] text-zinc-600 tracking-widest mt-1">
                  SUCCESS
                </span>
              </div>
            </div>

            <div className="flex gap-4 text-xs text-zinc-500">
              <span>🔥 {accepted}</span>
              <span>💔 {total - accepted}</span>
            </div>

            {title && (
              <span className="text-[11px] text-amber-400 tracking-wide">
                {title}
              </span>
            )}
          </div>
        )}

        {/* TODAY'S BEST */}
        {(mode === "both" || mode === "today") && (
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <p className="text-[10px] font-semibold tracking-widest text-zinc-600">
              {"TODAY'S BEST"}
            </p>
            <div className="flex gap-3">
              <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
                <p className="text-[10px] text-zinc-600 tracking-widest mb-1">
                  成功率
                </p>
                <p
                  className="text-4xl font-black tabular-nums"
                  style={{
                    color:
                      todayRate !== null ? rateColor(todayRate / 100) : "#52525b",
                  }}
                >
                  {todayRate !== null ? `${todayRate}%` : "--"}
                </p>
                {todayTotal > 0 && (
                  <p className="text-xs text-zinc-600 mt-1">
                    {todayAccepted} / {todayTotal} 回
                  </p>
                )}
              </div>

              <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
                <p className="text-[10px] text-zinc-600 tracking-widest mb-1">
                  最高BPM
                </p>
                <p className="text-4xl font-black tabular-nums text-red-400">
                  {todayMaxBpm !== null ? todayMaxBpm : "--"}
                </p>
                {todayMaxBpm !== null && (
                  <p className="text-xs text-zinc-600 mt-1">bpm</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

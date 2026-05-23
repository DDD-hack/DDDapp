"use client";

import type { CommitRecord } from "../hooks/useCommits";

type Props = {
  commits: CommitRecord[];
};

type DayStat = {
  dateStr: string;
  count: number;
  maxBpm: number;
};

export function ContributionHeatmap({ commits }: Props) {
  // Aggregate commits by day (YYYY-MM-DD)
  const map = new Map<string, DayStat>();
  let globalMaxCount = 0;
  let globalMaxBpm = 0;

  for (const c of commits) {
    const d = new Date(c.attempted_at);
    if (Number.isNaN(d.getTime())) continue;
    
    // Format to local date string YYYY-MM-DD
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    
    if (!map.has(dateStr)) {
      map.set(dateStr, { dateStr, count: 0, maxBpm: 0 });
    }
    const stat = map.get(dateStr)!;
    stat.count++;
    if (c.bpm > stat.maxBpm) {
      stat.maxBpm = c.bpm;
    }

    if (stat.count > globalMaxCount) globalMaxCount = stat.count;
    if (stat.maxBpm > globalMaxBpm) globalMaxBpm = stat.maxBpm;
  }

  // Fallback to avoid division by zero
  if (globalMaxCount === 0) globalMaxCount = 1;
  if (globalMaxBpm <= 120) globalMaxBpm = 121; // Baseline is 120

  // Generate last 180 days (approx 6 months) for the heatmap
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const DAYS_TO_SHOW = 180;
  const days: DayStat[] = [];
  
  for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push(map.get(dateStr) || { dateStr, count: 0, maxBpm: 0 });
  }

  // Calculate bivariate color based on Commit Count (Blue) and Max BPM (Red)
  function getCellColor(stat: DayStat) {
    if (stat.count === 0 && stat.maxBpm === 0) return "#2e2e2e";
    
    // 0.0 ~ 1.0 (relative to max)
    const commitScore = Math.min(1, stat.count / globalMaxCount);
    // 0.0 ~ 1.0 (relative to max BPM over 120 baseline)
    const bpmScore = Math.min(1, Math.max(0, (stat.maxBpm - 120) / (globalMaxBpm - 120)));

    // Magnitude determines opacity (How "solid" or "faint" the color is)
    // Range from 0.2 (faint/thin) to 1.0 (solid vibrant)
    const magnitude = Math.max(commitScore, bpmScore);
    const opacity = 0.2 + (0.8 * magnitude);

    // Ratio determines the hue (Mixing Red and Blue)
    const totalScore = commitScore + bpmScore;
    if (totalScore === 0) {
      return `rgba(168, 85, 247, 0.2)`; // Faint purple fallback
    }

    const redRatio = bpmScore / totalScore;
    const blueRatio = commitScore / totalScore;

    // Red-500: 239, 68, 68
    // Blue-500: 59, 130, 246
    const r = Math.round((239 * redRatio) + (59 * blueRatio));
    const g = Math.round((68 * redRatio) + (130 * blueRatio));
    const b = Math.round((68 * redRatio) + (246 * blueRatio));

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return (
    <section className="border-t border-zinc-900 px-8 py-6">
      <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
        CONTRIBUTION HEATMAP
      </h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto">
        <div className="min-w-max">
          <div className="flex gap-1">
            {Array.from({ length: Math.ceil(DAYS_TO_SHOW / 7) }).map((_, weekIdx) => {
              const weekDays = days.slice(weekIdx * 7, (weekIdx + 1) * 7);
              return (
                <div key={weekIdx} className="flex flex-col gap-1">
                  {weekDays.map((day) => (
                    <div
                      key={day.dateStr}
                      title={`${day.dateStr}\nCommits: ${day.count}\nMax BPM: ${day.maxBpm}`}
                      className="w-3 h-3 rounded-[2px] transition-colors hover:ring-2 hover:ring-zinc-400 cursor-default"
                      style={{ backgroundColor: getCellColor(day) }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          
          {/* Bivariate Legend */}
          <div className="flex flex-wrap items-center gap-6 mt-6 text-xs text-zinc-500 justify-end">
            <span className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: "#2e2e2e" }} />
              なし
            </span>
            <span className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: "rgba(59, 130, 246, 0.4)" }} />
              青 (コミット中心)
            </span>
            <span className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: "rgba(239, 68, 68, 0.4)" }} />
              赤 (BPM中心)
            </span>
            <span className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: "rgba(168, 85, 247, 1.0)" }} />
              紫 (両方MAX)
            </span>
            <span className="text-[10px] ml-2 text-zinc-600 tracking-widest border-l border-zinc-800 pl-4">
              *数値が低いほど色が薄くなります
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import type { CommitRecord } from "../hooks/useCommits";

type RepoStats = {
  repo: string;
  totalCommits: number;
  accepted: number;
  rejected: number;
  avgBpm: number;
  maxBpm: number;
  acceptRate: number;
};

const MEDALS = ["🥇", "🥈", "🥉"];

const TITLES: { check: (s: RepoStats) => boolean; label: string }[] = [
  { check: (s) => s.avgBpm >= 150 && s.acceptRate >= 0.8, label: "真のアスリート開発者" },
  { check: (s) => s.avgBpm >= 130 && s.acceptRate < 0.5, label: "パニックコーダー" },
  { check: (s) => s.avgBpm < 100 && s.acceptRate >= 0.8, label: "冷静な達人" },
  { check: (s) => s.avgBpm < 100 && s.acceptRate < 0.5, label: "怠惰な悪魔" },
  { check: (s) => s.maxBpm >= 180, label: "心臓破りのコミッター" },
  { check: (s) => s.rejected === 0 && s.totalCommits >= 3, label: "情熱の申し子" },
];

function getTitle(s: RepoStats): string | null {
  return TITLES.find((t) => t.check(s))?.label ?? null;
}

function repoName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

type Props = {
  commits: CommitRecord[];
};

export function PassionRanking({ commits }: Props) {
  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">
        データなし
      </div>
    );
  }

  // Aggregate by repo
  const map = new Map<string, { bpms: number[]; accepted: number; rejected: number }>();
  for (const c of commits) {
    const key = c.repo_path || "(unknown)";
    if (!map.has(key)) map.set(key, { bpms: [], accepted: 0, rejected: 0 });
    const entry = map.get(key)!;
    entry.bpms.push(c.bpm);
    if (c.result === "accepted") entry.accepted++;
    else entry.rejected++;
  }

  const ranking: RepoStats[] = Array.from(map.entries())
    .map(([repo, { bpms, accepted, rejected }]) => ({
      repo,
      totalCommits: bpms.length,
      accepted,
      rejected,
      avgBpm: Math.round(bpms.reduce((s, b) => s + b, 0) / bpms.length),
      maxBpm: Math.max(...bpms),
      acceptRate: bpms.length > 0 ? accepted / bpms.length : 0,
    }))
    .sort((a, b) => b.avgBpm - a.avgBpm);

  return (
    <div className="flex flex-col gap-3">
      {ranking.map((s, i) => {
        const title = getTitle(s);
        const medal = MEDALS[i] ?? null;
        const barWidth = Math.min((s.avgBpm / 200) * 100, 100);

        return (
          <div
            key={s.repo}
            className={`rounded-xl border px-5 py-4 flex flex-col gap-2 ${
              i === 0
                ? "border-red-900/60 bg-red-950/20"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            {/* Top row */}
            <div className="flex items-center gap-3">
              {medal && <span className="text-2xl leading-none">{medal}</span>}
              {!medal && (
                <span className="text-zinc-600 font-mono text-sm w-6 text-center">
                  {i + 1}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{repoName(s.repo)}</p>
                {title && (
                  <p className="text-[11px] text-amber-400 tracking-wide">{title}</p>
                )}
              </div>
              <div className="text-right">
                <p className={`text-2xl font-black tabular-nums ${i === 0 ? "text-red-400" : "text-zinc-300"}`}>
                  {s.avgBpm}
                </p>
                <p className="text-[10px] text-zinc-600 tracking-widest">AVG BPM</p>
              </div>
            </div>

            {/* BPM bar */}
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${i === 0 ? "bg-red-500" : "bg-zinc-600"}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            {/* Bottom stats */}
            <div className="flex gap-4 text-xs text-zinc-500">
              <span>🔥 {s.accepted} accepted</span>
              <span>💔 {s.rejected} rejected</span>
              <span>最高 {s.maxBpm} bpm</span>
              <span>成功率 {Math.round(s.acceptRate * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

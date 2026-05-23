"use client";

import type { CommitRecord } from "../hooks/useCommits";

type Props = {
  commits: CommitRecord[];
};

const MESSAGE_TIERS: { min: number; label: string; sub: string }[] = [
  { min: 180, label: "心臓爆発寸前のコード", sub: "命を削って打ち込まれた一行" },
  { min: 160, label: "灼熱の魂で書かれた一行", sub: "もはや人間業ではない" },
  { min: 140, label: "燃え盛る情熱の証", sub: "鼓動がキーボードを叩いた" },
  { min: 120, label: "情熱の閾値を超えて", sub: "確かにそこに熱があった" },
  { min: 0, label: "情熱エラー", sub: "情熱を上げてください" },
];

function pickMessage(bpm: number) {
  return MESSAGE_TIERS.find((t) => bpm >= t.min) ?? MESSAGE_TIERS[MESSAGE_TIERS.length - 1];
}

function repoName(path: string): string {
  if (!path) return "(unknown)";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortHash(hash: string): string {
  if (!hash) return "";
  return hash.slice(0, 7);
}

function pickMostPassionate(commits: CommitRecord[]): CommitRecord | null {
  if (commits.length === 0) return null;
  let best: CommitRecord = commits[0];
  for (let i = 1; i < commits.length; i++) {
    const c = commits[i];
    if (c.bpm > best.bpm) {
      best = c;
      continue;
    }
    if (c.bpm === best.bpm) {
      const cTime = new Date(c.attempted_at).getTime();
      const bestTime = new Date(best.attempted_at).getTime();
      if (Number.isFinite(cTime) && Number.isFinite(bestTime) && cTime > bestTime) {
        best = c;
      }
    }
  }
  return best;
}

export function MostPassionateCommit({ commits }: Props) {
  const best = pickMostPassionate(commits);

  return (
    <section className="border-t border-zinc-900 px-8 py-6">
      <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
        MOST PASSIONATE COMMIT
      </h2>

      {!best ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-8 text-center text-zinc-600 text-sm">
          まだ情熱の記録はありません
        </div>
      ) : (
        <PassionCard commit={best} />
      )}
    </section>
  );
}

function PassionCard({ commit }: { commit: CommitRecord }) {
  const message = pickMessage(commit.bpm);
  const accepted = commit.result === "accepted";
  const hash = shortHash(commit.commit_hash);
  const when = formatDateTime(commit.attempted_at);
  const heatPct = Math.min(Math.max(((commit.bpm - 60) / 140) * 100, 0), 100);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border px-6 py-6 md:px-8 md:py-8 ${
        accepted
          ? "border-red-900/60 bg-gradient-to-br from-red-950/40 via-zinc-950 to-black"
          : "border-zinc-800 bg-zinc-950"
      }`}
    >
      {/* Heat aura */}
      {accepted && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-red-600/20 blur-3xl"
        />
      )}

      <div className="relative flex flex-col md:flex-row md:items-center gap-6">
        {/* Left: huge BPM */}
        <div className="flex items-baseline gap-3 md:flex-col md:items-start md:gap-1 md:w-56 shrink-0">
          <span className="text-6xl md:text-7xl leading-none">🔥</span>
          <div>
            <p
              className={`text-6xl md:text-7xl font-black tabular-nums leading-none ${
                accepted ? "text-red-400" : "text-zinc-400"
              }`}
            >
              {commit.bpm}
            </p>
            <p className="text-[10px] text-zinc-500 tracking-widest mt-2">PEAK BPM</p>
          </div>
        </div>

        {/* Right: message + meta */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div>
            <p className="text-xl md:text-2xl font-bold text-amber-300 tracking-wide">
              {message.label}
            </p>
            <p className="text-sm text-zinc-400 mt-1">{message.sub}</p>
          </div>

          {/* Heat bar */}
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                accepted ? "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" : "bg-zinc-600"
              }`}
              style={{ width: `${heatPct}%` }}
            />
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span
              className={`font-semibold tracking-widest ${
                accepted ? "text-red-300" : "text-zinc-500"
              }`}
            >
              {accepted ? "ACCEPTED" : "REJECTED"}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="truncate max-w-[12rem]" title={commit.repo_path}>
              {repoName(commit.repo_path)}
            </span>
            {hash && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-zinc-500">{hash}</span>
              </>
            )}
            {when && (
              <>
                <span className="text-zinc-700">·</span>
                <span>{when}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useDaemon } from "./hooks/useDaemon";
import { useCommits } from "./hooks/useCommits";
import { BpmGauge } from "./components/BpmGauge";
import { CommitFeed } from "./components/CommitFeed";
import { CommitChart } from "./components/CommitChart";
import { PassionRanking } from "./components/PassionRanking";
import { AuthButton } from "./components/AuthButton";
import { SuccessRateCard } from "./components/SuccessRateCard";
import { MostPassionateCommit } from "./components/MostPassionateCommit";
import { useAuth } from "./auth/AuthProvider";
import { LoginPromptBanner } from "./components/LoginPromptBanner";
import { MemberBpmPanel } from "./components/MemberBpmPanel";

const STATUS_LABEL: Record<string, string> = {
  connected: "● LIVE",
  connecting: "○ 接続中",
  disconnected: "○ 切断",
  cloud: "☁ CLOUD",
};

const STATUS_COLOR: Record<string, string> = {
  connected: "text-green-500",
  connecting: "text-yellow-500",
  disconnected: "text-zinc-500",
  // クラウドフォールバック中は LIVE と区別するため空色を使う
  cloud: "text-sky-400",
};

export default function Home() {
  const { bpm, stale, status, commits } = useDaemon();
  const { commits: history, error: historyError } = useCommits(100);
  const { user, configured } = useAuth();
  const [tab, setTab] = useState<"today" | "total">("today");

  const accepted = commits.filter((c) => c.result === "accepted").length;
  const rejected = commits.filter((c) => c.result === "rejected").length;
  const avgBpm =
    commits.length > 0
      ? Math.round(commits.reduce((s, c) => s + c.bpm, 0) / commits.length)
      : null;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-zinc-900">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black tracking-widest">DDD</span>
          <span className="text-xs text-zinc-600 tracking-widest mt-1">DOKI DOKI DEVELOPMENT</span>
        </div>
        <div className="flex items-center gap-5">
          {configured && user && (
            <span className="text-[10px] font-mono tracking-widest text-emerald-500 border border-emerald-950 bg-emerald-950/20 px-2 py-0.5 rounded animate-pulse">
              ☁ CLOUD SYNC
            </span>
          )}
          <span className={`text-xs font-mono font-semibold tracking-widest ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
          <AuthButton />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left: BPM gauge + Member BPM */}
        <section className="flex flex-1 items-center justify-center py-16 px-8 gap-12 flex-wrap">
          <BpmGauge bpm={bpm} stale={stale} />
          <MemberBpmPanel />
        </section>

        {/* Right: commit feed + stats */}
        <aside className="lg:w-80 border-t lg:border-t-0 lg:border-l border-zinc-900 flex flex-col">
          {/* Stats bar */}
          {commits.length > 0 && (
            <div className="flex divide-x divide-zinc-900 border-b border-zinc-900">
              <div className="flex-1 px-4 py-3 text-center">
                <div className="text-2xl font-black text-red-500">{accepted}</div>
                <div className="text-[10px] text-zinc-600 tracking-widest">ACCEPTED</div>
              </div>
              <div className="flex-1 px-4 py-3 text-center">
                <div className="text-2xl font-black text-zinc-500">{rejected}</div>
                <div className="text-[10px] text-zinc-600 tracking-widest">REJECTED</div>
              </div>
              <div className="flex-1 px-4 py-3 text-center">
                <div className="text-2xl font-black text-zinc-300">{avgBpm ?? "--"}</div>
                <div className="text-[10px] text-zinc-600 tracking-widest">AVG BPM</div>
              </div>
            </div>
          )}

          {/* Feed */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-3">
              COMMIT LOG
            </h2>
            <CommitFeed commits={commits} />
          </div>
        </aside>
      </div>

      {/* Tab bar */}
      <div className="border-t border-zinc-900 px-8 pt-4 flex gap-6">
        {(["today", "total"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs tracking-widest pb-2 border-b-2 transition-colors ${
              tab === t
                ? "text-white border-[#F97316]"
                : "text-zinc-600 border-transparent hover:text-zinc-400"
            }`}
          >
            {t === "today" ? "今日" : "累積"}
          </button>
        ))}
      </div>

      {/* Today tab */}
      {tab === "today" && (
        <>
          <div className="px-8 mb-2">
            <LoginPromptBanner />
          </div>
          {!historyError && <SuccessRateCard commits={history} />}
        </>
      )}

      {/* Total tab */}
      {tab === "total" && !historyError && (
        <>
          <MostPassionateCommit commits={history} />
          <section className="border-t border-zinc-900 px-8 py-6 flex flex-col xl:flex-row gap-8">
            <div className="flex-1 min-w-0">
              <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
                COMMIT HISTORY
              </h2>
              <CommitChart commits={history} />
            </div>
            <div className="xl:w-96">
              <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
                PASSION RANKING
              </h2>
              <PassionRanking commits={history} />
            </div>
          </section>
        </>
      )}

      {/* Footer */}
      <footer className="px-8 py-3 border-t border-zinc-900 text-center text-xs text-zinc-700 tracking-widest">
        「平常心で書いたコードは、信用できない。」
      </footer>
    </main>
  );
}

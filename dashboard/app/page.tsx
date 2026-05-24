"use client";

import { useState } from "react";
import { useDaemon } from "./hooks/useDaemon";
import { useCommits } from "./hooks/useCommits";
import { BpmGauge } from "./components/BpmGauge";
import { CommitFeed } from "./components/CommitFeed";
import { CommitChart } from "./components/CommitChart";
import { PassionRanking } from "./components/PassionRanking";
import { AuthButton } from "./components/AuthButton";
import { LoginPromptBanner } from "./components/LoginPromptBanner";
import { useAuth } from "./auth/AuthProvider";

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
            <span className="text-[10px] font-mono tracking-widest text-green-400 border border-green-950 bg-green-950/20 px-2 py-0.5 rounded">
              ☁ CLOUD ACTIVE
            </span>
          )}
          <span className={`text-xs font-mono font-semibold tracking-widest ${STATUS_COLOR[status]}`}>
            {STATUS_LABEL[status]}
          </span>
          <AuthButton />
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="flex justify-center border-b border-zinc-900 bg-zinc-950 px-8 py-0">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab("today")}
            className={`px-4 py-3 text-[10px] font-bold tracking-widest transition-colors border-b-2 ${
              activeTab === "today"
                ? "border-red-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            今日
          </button>
          <button
            onClick={() => setActiveTab("cumulative")}
            className={`px-4 py-3 text-[10px] font-bold tracking-widest transition-colors border-b-2 ${
              activeTab === "cumulative"
                ? "border-red-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            累積
          </button>
          <button
            onClick={() => setActiveTab("ranking")}
            className={`px-4 py-3 text-[10px] font-bold tracking-widest transition-colors border-b-2 ${
              activeTab === "ranking"
                ? "border-red-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            ランキング
          </button>
        </div>
      </div>

      {/* Body: Today Tab */}
      {activeTab === "today" && (
        <>
          <div className="flex flex-col lg:flex-row">
            {/* Left: BPM gauge */}
            <section className="flex flex-1 items-center justify-center py-16 px-8">
              <BpmGauge bpm={bpm} stale={stale} />
            </section>

            {/* Right: commit feed + stats */}
            <aside className="lg:w-80 border-t lg:border-t-0 lg:border-l border-zinc-900 flex flex-col min-h-[400px]">
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

          {/* Login Prompt Banner */}
          <div className="px-8 mb-2">
            <LoginPromptBanner />
          </div>

          {/* Success rate - Today's Best + member BPM */}
          <SuccessRateCard commits={historyError ? [] : history} mode="today">
            <MemberBpmPanel />
          </SuccessRateCard>

          {/* History chart */}
          {!historyError && (
            <section className="border-t border-zinc-900 px-8 py-6">
              <div className="max-w-4xl">
                <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-4">
                  COMMIT HISTORY
                </h2>
                <CommitChart commits={history} />
              </div>
            </section>
          )}
        </>
      )}

      {/* Body: Cumulative Tab */}
      {activeTab === "cumulative" && (
        <>
          {/* Most passionate commit */}
          {!historyError && <MostPassionateCommit commits={history} />}

      {/* Login Prompt Banner — 未ログイン時のみ表示（コンポーネント内で出し分け） */}
      <LoginPromptBanner />

      {/* History chart + Passion ranking */}
      {!historyError && (
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
      )}

      {/* Body: Ranking Tab */}
      {activeTab === "ranking" && <RankingTab />}

      <div className="flex-1" />

      {/* Footer */}
      <footer className="px-8 py-3 border-t border-zinc-900 text-center text-xs text-zinc-700 tracking-widest">
        「平常心で書いたコードは、信用できない。」
      </footer>
    </main>
  );
}

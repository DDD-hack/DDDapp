"use client";

import type { CommitEvent } from "../hooks/useDaemon";

type Props = {
  commits: CommitEvent[];
};

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}秒前`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分前`;
  return `${Math.floor(secs / 3600)}時間前`;
}

export function CommitFeed({ commits }: Props) {
  if (commits.length === 0) {
    return (
      <div className="text-center text-zinc-600 text-sm py-8">
        コミット履歴なし
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {commits.map((c) => (
        <li
          key={c.id}
          className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${
            c.result === "accepted"
              ? "bg-red-950/30 border-red-900/40"
              : "bg-zinc-900 border-zinc-800"
          }`}
        >
          <span className="text-lg">{c.result === "accepted" ? "🔥" : "💔"}</span>
          <span className={`font-bold tabular-nums ${c.result === "accepted" ? "text-red-400" : "text-zinc-500"}`}>
            {c.bpm} bpm
          </span>
          <span className={`flex-1 font-medium ${c.result === "accepted" ? "text-red-300" : "text-zinc-500"}`}>
            {c.result === "accepted" ? "ACCEPTED" : "REJECTED"}
          </span>
          <span className="text-zinc-600 text-xs">{timeAgo(c.at)}</span>
        </li>
      ))}
    </ul>
  );
}

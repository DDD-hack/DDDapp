"use client";

import { useEffect, useState } from "react";
import { useFirebaseHeartbeat } from "../hooks/useFirebaseHeartbeat";
import { useAuth } from "../auth/AuthProvider";

const THRESHOLD = 120;

type StatusTier = "live" | "warn" | "offline";

function getStatus(updatedAt: number | null): StatusTier {
  if (updatedAt === null) return "offline";
  const sec = Math.floor((Date.now() - updatedAt) / 1000);
  if (sec < 60) return "live";
  if (sec < 1800) return "warn";
  return "offline";
}

function formatElapsed(updatedAt: number | null): string {
  if (updatedAt === null) return "──";
  const sec = Math.floor((Date.now() - updatedAt) / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

const STATUS_ICON: Record<StatusTier, string> = {
  live: "🔥",
  warn: "💀",
  offline: "──",
};

const STATUS_COLOR: Record<StatusTier, string> = {
  live: "text-green-400",
  warn: "text-orange-400",
  offline: "text-zinc-600",
};

const BPM_COLOR = (bpm: number | null) => {
  if (bpm === null) return "text-zinc-600";
  return bpm > THRESHOLD ? "text-red-400" : "text-blue-400";
};

function getMockMembers() {
  const now = Date.now();
  return [
    { uid: "_mock_a", name: "メンバーA", bpm: 142, updatedAt: now - 5_000 },
    { uid: "_mock_b", name: "メンバーB", bpm: 89,  updatedAt: now - 1_000 * 60 * 3 },
    { uid: "_mock_c", name: "メンバーC", bpm: 156, updatedAt: now - 1_000 * 60 * 120 },
  ];
}

export function MemberBpmPanel() {
  const realMembers = useFirebaseHeartbeat();
  const { user, configured } = useAuth();
  const [, tick] = useState(0);

  const visible = !configured || !!user;

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const isDev = process.env.NODE_ENV === "development";
  const members = realMembers.length > 0 ? realMembers : isDev ? getMockMembers() : [];

  return (
    <div className="w-full">
      <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600 mb-3">
        MEMBER HEARTBEATS
        {isDev && realMembers.length === 0 && (
          <span className="ml-2 text-zinc-700 normal-case font-normal tracking-normal">
            (mock)
          </span>
        )}
      </h2>

      {members.length === 0 ? (
        <p className="text-xs text-zinc-700 px-4 py-3">メンバーデータを読み込み中...</p>
      ) : (
        <>
          {/* Table header */}
          <div className="grid grid-cols-[1fr_6rem_5rem_2.5rem] px-3 py-2 text-[10px] tracking-widest text-zinc-600 border-b border-zinc-800">
            <span>メンバー</span>
            <span className="text-right">BPM</span>
            <span className="text-right">最終更新</span>
            <span className="text-right">状態</span>
          </div>

          {/* Member rows */}
          <div className="divide-y divide-zinc-900">
            {members.map((m) => {
              const tier = getStatus(m.updatedAt);
              const bpmColor = BPM_COLOR(m.bpm);

              return (
                <div
                  key={m.uid}
                  className="grid grid-cols-[1fr_6rem_5rem_2.5rem] items-center px-3 py-3"
                >
                  <span className="text-sm text-zinc-300 truncate">{m.name}</span>

                  <div className={`flex items-baseline justify-end gap-1 tabular-nums ${bpmColor}`}>
                    <span className="text-base">♥</span>
                    <span className="text-xl font-black">
                      {m.bpm !== null ? m.bpm : "--"}
                    </span>
                    <span className="text-[10px] text-zinc-600">bpm</span>
                  </div>

                  <span
                    className={`text-xs font-mono text-right ${
                      tier === "live" ? "text-zinc-400" : "text-zinc-600"
                    }`}
                  >
                    {formatElapsed(m.updatedAt)}
                  </span>

                  <span className={`text-sm text-right ${STATUS_COLOR[tier]}`}>
                    {STATUS_ICON[tier]}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

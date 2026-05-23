"use client";

import { useEffect, useState } from "react";
import {
  useFirebaseHeartbeat,
  type MemberHeartbeat,
} from "../hooks/useFirebaseHeartbeat";

function elapsed(updatedAt: number | null): { label: string; live: boolean } {
  if (updatedAt === null) return { label: "--", live: false };
  const secs = Math.floor((Date.now() - updatedAt) / 1000);
  const live = secs <= 10;
  if (secs < 60) return { label: `${secs}s ago`, live };
  return { label: `${Math.floor(secs / 60)}m ago`, live };
}

function MemberCard({ member }: { member: MemberHeartbeat }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { label, live } = elapsed(member.updatedAt);
  const bpmColor =
    member.bpm === null
      ? "text-zinc-600"
      : member.bpm > 120
        ? "text-red-500"
        : "text-blue-400";

  return (
    <div className="bg-[#1A1A2E] rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
      <div>
        <div className="text-xs text-zinc-400">{member.name}</div>
        <div className={`text-3xl font-black ${bpmColor}`}>
          {member.bpm ?? "--"}
        </div>
      </div>
      <div className="text-right">
        {live ? (
          <div className="flex items-center gap-1 text-green-400 text-[10px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </div>
        ) : (
          <div className="text-[10px] text-zinc-600">{label}</div>
        )}
      </div>
    </div>
  );
}

export function MemberBpmPanel() {
  const members = useFirebaseHeartbeat();

  return (
    <div className="flex flex-col gap-3 min-w-[200px]">
      <h2 className="text-[10px] font-semibold tracking-widest text-zinc-600">
        MEMBER BPM
      </h2>
      {members.length === 0 ? (
        <div className="text-xs text-zinc-700">データなし</div>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <MemberCard key={m.uid} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}

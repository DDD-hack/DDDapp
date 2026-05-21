"use client";

const THRESHOLD = 120;

type Props = {
  bpm: number | null;
  stale: boolean;
};

export function BpmGauge({ bpm, stale }: Props) {
  const isFired = bpm !== null && bpm >= THRESHOLD;
  const isLow = bpm !== null && bpm < THRESHOLD;

  const color = stale || bpm === null
    ? "text-zinc-500"
    : isFired
    ? "text-red-500"
    : "text-blue-400";

  const glow = isFired
    ? "drop-shadow-[0_0_32px_rgba(239,68,68,0.7)]"
    : "";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Heart + BPM */}
      <div className={`relative flex flex-col items-center ${glow}`}>
        <span
          className={`text-[120px] leading-none select-none transition-colors duration-500 ${color} ${isFired ? "animate-[heartbeat_0.8s_ease-in-out_infinite]" : ""}`}
        >
          ♥
        </span>
        <span className={`text-8xl font-black tabular-nums tracking-tight transition-colors duration-500 ${color}`}>
          {bpm !== null ? bpm : "--"}
        </span>
        <span className="text-xl font-semibold tracking-[0.3em] text-zinc-500 mt-1">
          BPM
        </span>
      </div>

      {/* Status label */}
      <div className="mt-2 text-sm font-medium tracking-widest">
        {stale && (
          <span className="text-zinc-500">📡 データなし — Apple Watch を確認</span>
        )}
        {!stale && bpm === null && (
          <span className="text-zinc-600">接続中...</span>
        )}
        {isFired && (
          <span className="text-red-400">🔥 情熱あり — コミット許可</span>
        )}
        {isLow && (
          <span className="text-blue-400">💙 情熱不足 — 閾値まであと {THRESHOLD - bpm!} bpm</span>
        )}
      </div>

      {/* Threshold bar */}
      {bpm !== null && !stale && (
        <div className="w-72 mt-4">
          <div className="flex justify-between text-xs text-zinc-600 mb-1">
            <span>0</span>
            <span className="text-zinc-400">閾値 {THRESHOLD}</span>
            <span>200</span>
          </div>
          <div className="relative h-3 bg-zinc-800 rounded-full overflow-hidden">
            {/* Threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-zinc-500 z-10"
              style={{ left: `${(THRESHOLD / 200) * 100}%` }}
            />
            {/* Fill */}
            <div
              className={`h-full rounded-full transition-all duration-700 ${isFired ? "bg-red-500" : "bg-blue-500"}`}
              style={{ width: `${Math.min((bpm / 200) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

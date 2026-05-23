"use client";

import { useEffect, useState } from "react";
import { useTeamRanking } from "../hooks/useTeamRanking";
import { useAuth } from "../auth/AuthProvider";
import type { MemberRankEntry, TeamRankEntry } from "@/lib/firebaseTypes";

// ---- types ----

type Scope = "internal" | "external";
type ExternalMode = "individual" | "team";
type Metric = "commits" | "maxBpm" | "avgBpm" | "passion";

type Row = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  isMe?: boolean;
};

// ---- mock fallback（Firebase未接続時） ----

function calcPassion(avgBpm: number, commits: number) {
  return Math.round(avgBpm * Math.sqrt(commits));
}

const MOCK_INTERNAL: MemberRankEntry[] = [
  { uid: "a", name: "rina",   teamId: "DDD", teamName: "DDD", commits: 42, maxBpm: 178, avgBpm: 134, passion: calcPassion(134, 42) },
  { uid: "b", name: "taro",   teamId: "DDD", teamName: "DDD", commits: 28, maxBpm: 165, avgBpm: 128, passion: calcPassion(128, 28) },
  { uid: "c", name: "hanako", teamId: "DDD", teamName: "DDD", commits: 35, maxBpm: 156, avgBpm: 121, passion: calcPassion(121, 35) },
  { uid: "d", name: "yuki",   teamId: "DDD", teamName: "DDD", commits: 19, maxBpm: 189, avgBpm: 142, passion: calcPassion(142, 19) },
  { uid: "e", name: "kenji",  teamId: "DDD", teamName: "DDD", commits: 51, maxBpm: 145, avgBpm: 118, passion: calcPassion(118, 51) },
];

const MOCK_EXTERNAL: MemberRankEntry[] = [
  ...MOCK_INTERNAL,
  { uid: "f", name: "sato",     teamId: "Team B", teamName: "Team B", commits: 38, maxBpm: 172, avgBpm: 136, passion: calcPassion(136, 38) },
  { uid: "g", name: "yamada",   teamId: "Team B", teamName: "Team B", commits: 22, maxBpm: 198, avgBpm: 148, passion: calcPassion(148, 22) },
  { uid: "h", name: "nakamura", teamId: "Team B", teamName: "Team B", commits: 45, maxBpm: 163, avgBpm: 129, passion: calcPassion(129, 45) },
  { uid: "i", name: "fujita",   teamId: "Team C", teamName: "Team C", commits: 31, maxBpm: 177, avgBpm: 139, passion: calcPassion(139, 31) },
  { uid: "j", name: "kimura",   teamId: "Team C", teamName: "Team C", commits: 27, maxBpm: 155, avgBpm: 122, passion: calcPassion(122, 27) },
];

function buildMockTeams(members: MemberRankEntry[]): TeamRankEntry[] {
  const map = new Map<string, MemberRankEntry[]>();
  for (const m of members) {
    if (!map.has(m.teamId)) map.set(m.teamId, []);
    map.get(m.teamId)!.push(m);
  }
  return Array.from(map.entries()).map(([teamId, ms]) => {
    const totalCommits = ms.reduce((s, m) => s + m.commits, 0);
    const avgBpm = Math.round(ms.reduce((s, m) => s + m.avgBpm, 0) / ms.length);
    const maxBpm = Math.max(...ms.map((m) => m.maxBpm));
    return { teamId, teamName: ms[0].teamName, memberCount: ms.length, maxBpm, avgBpm, passion: calcPassion(avgBpm, totalCommits) };
  });
}

// ---- config ----

const INITIAL_SHOW = 5;

const INTERNAL_METRICS: Metric[] = ["commits", "maxBpm", "avgBpm", "passion"];
const EXTERNAL_METRICS: Metric[] = ["maxBpm", "avgBpm", "passion"];

const METRIC_LABEL: Record<Metric, string> = {
  commits: "コミット数", maxBpm: "最大BPM", avgBpm: "平均BPM", passion: "情熱指数",
};
const METRIC_UNIT: Record<Metric, string> = {
  commits: "回", maxBpm: "bpm", avgBpm: "bpm", passion: "pt",
};
const METRIC_BAR: Record<Metric, string> = {
  commits: "bg-sky-500", maxBpm: "bg-red-500", avgBpm: "bg-orange-400", passion: "bg-yellow-400",
};

const MEDAL = ["🥇", "🥈", "🥉"];

const TEAM_BADGE: Record<string, string> = {
  DDD:      "text-red-400 border-red-900 bg-red-950/40",
  "Team B": "text-sky-400 border-sky-900 bg-sky-950/40",
  "Team C": "text-emerald-400 border-emerald-900 bg-emerald-950/40",
};

function teamBadgeClass(team: string) {
  return TEAM_BADGE[team] ?? "text-zinc-400 border-zinc-700 bg-zinc-900";
}

// ---- RankRow ----

function RankRow({ rank, label, sub, value, unit, barPct, barColor, isMe }: {
  rank: number; label: string; sub?: string; value: number;
  unit: string; barPct: number; barColor: string; isMe?: boolean;
}) {
  const [animWidth, setAnimWidth] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimWidth(barPct), (rank - 1) * 60);
    return () => clearTimeout(t);
  }, [barPct, rank]);

  const isTop = rank <= 3;
  return (
    <div className={`flex items-center gap-4 rounded-lg px-3 py-1 -mx-3 transition-colors ${isMe ? "bg-zinc-900/60 ring-1 ring-zinc-700" : ""}`}>
      <div className="w-8 text-center shrink-0">
        {isTop ? <span className="text-lg">{MEDAL[rank - 1]}</span>
               : <span className="text-xs font-mono text-zinc-600">{rank}</span>}
      </div>
      <div className="w-48 shrink-0 flex flex-col justify-center gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-sm truncate ${isTop ? "text-zinc-100 font-semibold" : isMe ? "text-zinc-200" : "text-zinc-500"}`}>
            {label}
          </span>
          {isMe && <span className="text-[9px] font-bold tracking-widest text-zinc-400 border border-zinc-700 px-1 py-0.5 rounded shrink-0">YOU</span>}
        </div>
        {sub && <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border w-fit tracking-wider ${teamBadgeClass(sub)}`}>{sub}</span>}
      </div>
      <div className="flex-1 bg-zinc-900 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${barColor}`}
          style={{ width: `${animWidth}%`, transition: "width 700ms ease-out" }}
        />
      </div>
      <div className="shrink-0 w-32 text-right tabular-nums">
        <span className={`text-sm font-black ${isTop ? "text-white" : isMe ? "text-zinc-300" : "text-zinc-500"}`}>
          {value.toLocaleString()}
        </span>
        <span className="text-[10px] text-zinc-600 ml-1">{unit}</span>
      </div>
    </div>
  );
}

// ---- main ----

export function RankingTab() {
  const { user, configured } = useAuth();
  const ranking = useTeamRanking();

  const [scope, setScope] = useState<Scope>("internal");
  const [externalMode, setExternalMode] = useState<ExternalMode>("individual");
  const [metric, setMetric] = useState<Metric>("passion");
  const [expanded, setExpanded] = useState(false);

  const metrics = scope === "internal" ? INTERNAL_METRICS : EXTERNAL_METRICS;
  const activeMetric = metrics.includes(metric) ? metric : "passion";

  // 実データ or モック判定（Firebase接続済みでも commits が0件ならモックにフォールバック）
  const hasRealData = ranking.externalMembers.some((m) => m.commits > 0 || m.maxBpm > 0);
  const isMock = !configured || !user || ranking.loading || ranking.error || !hasRealData;
  const myUid = user?.uid ?? "a";
  const myTeamId = ranking.myTeamId ?? "DDD";

  function handleSetScope(s: Scope) {
    setScope(s);
    setExpanded(false);
    if (!(s === "internal" ? INTERNAL_METRICS : EXTERNAL_METRICS).includes(metric)) setMetric("passion");
  }
  function handleSetMetric(m: Metric) { setMetric(m); setExpanded(false); }
  function handleSetExternalMode(m: ExternalMode) { setExternalMode(m); setExpanded(false); }

  // ---- rows ----
  const rows: Row[] = (() => {
    if (scope === "internal") {
      const src = isMock ? MOCK_INTERNAL : ranking.internal;
      return [...src]
        .sort((a, b) => b[activeMetric] - a[activeMetric])
        .map((m) => ({ key: m.uid, label: m.name, value: m[activeMetric], isMe: m.uid === myUid }));
    }
    if (externalMode === "individual") {
      const src = isMock ? MOCK_EXTERNAL : ranking.externalMembers;
      return [...src]
        .sort((a, b) => b[activeMetric] - a[activeMetric])
        .map((m) => ({ key: m.uid, label: m.name, sub: m.teamName, value: m[activeMetric], isMe: m.uid === myUid }));
    }
    type TM = Exclude<Metric, "commits">;
    const tm = activeMetric as TM;
    const src = isMock ? buildMockTeams(MOCK_EXTERNAL) : ranking.externalTeams;
    return [...src]
      .sort((a, b) => b[tm] - a[tm])
      .map((t) => ({ key: t.teamId, label: t.teamName, sub: `${t.memberCount}人`, value: t[tm], isMe: t.teamId === myTeamId }));
  })();

  const maxVal = rows[0]?.value ?? 1;
  const myRank = rows.findIndex((r) => r.isMe) + 1;
  const displayRows = expanded ? rows : rows.slice(0, INITIAL_SHOW);
  const isMyRowVisible = myRank === 0 || myRank <= displayRows.length;
  const myRow = rows.find((r) => r.isMe);
  const hasMore = rows.length > INITIAL_SHOW && !expanded;

  return (
    <section className="px-8 py-6 flex flex-col gap-6">
      {/* 状態バッジ */}
      <div className="flex items-center gap-3 flex-wrap">
        {isMock && (
          <span className="text-[10px] text-zinc-600 border border-zinc-800 px-2 py-0.5 rounded tracking-widest">
            ダミーデータ表示中
          </span>
        )}
        {!isMock && ranking.loading && (
          <span className="text-[10px] text-zinc-600 animate-pulse tracking-widest">読み込み中...</span>
        )}
        {!isMock && !ranking.loading && (
          <button onClick={ranking.refresh} className="text-[10px] text-zinc-600 hover:text-zinc-400 tracking-widest transition-colors">
            ↻ 更新
          </button>
        )}
      </div>

      {/* Scope toggle */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-2">
          {(["internal", "external"] as Scope[]).map((s) => (
            <button key={s} onClick={() => handleSetScope(s)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-widest transition-colors ${
                scope === s ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800"
              }`}>
              {s === "internal" ? "チーム内" : "チーム外"}
            </button>
          ))}
        </div>
        {scope === "external" && (
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-full p-0.5">
            {(["individual", "team"] as ExternalMode[]).map((m) => (
              <button key={m} onClick={() => handleSetExternalMode(m)}
                className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest transition-colors ${
                  externalMode === m ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}>
                {m === "individual" ? "個人" : "チーム対抗"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metric tabs */}
      <div className="flex gap-6 border-b border-zinc-800">
        {metrics.map((m) => (
          <button key={m} onClick={() => handleSetMetric(m)}
            className={`pb-2 text-[10px] font-bold tracking-widest transition-colors border-b-2 -mb-px ${
              activeMetric === m ? "text-white border-red-500" : "text-zinc-600 border-transparent hover:text-zinc-400"
            }`}>
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      {/* Ranking list */}
      <div className="flex flex-col gap-3 w-full">
        {displayRows.map((row, i) => (
          <RankRow key={row.key} rank={i + 1} label={row.label} sub={row.sub}
            value={row.value} unit={METRIC_UNIT[activeMetric]}
            barPct={maxVal > 0 ? (row.value / maxVal) * 100 : 0}
            barColor={METRIC_BAR[activeMetric]} isMe={row.isMe} />
        ))}

        {hasMore && (
          <button onClick={() => setExpanded(true)}
            className="mt-1 text-xs text-zinc-600 hover:text-zinc-400 tracking-widest transition-colors text-left pl-12">
            ▾ もっと見る（残り {rows.length - INITIAL_SHOW} 件）
          </button>
        )}

        {!isMyRowVisible && myRow && (
          <>
            <div className="flex items-center gap-3 pl-12">
              <div className="flex-1 border-t border-dashed border-zinc-800" />
              <span className="text-[10px] text-zinc-700 tracking-widest shrink-0">あなたの順位</span>
              <div className="flex-1 border-t border-dashed border-zinc-800" />
            </div>
            <RankRow rank={myRank} label={myRow.label} sub={myRow.sub}
              value={myRow.value} unit={METRIC_UNIT[activeMetric]}
              barPct={maxVal > 0 ? (myRow.value / maxVal) * 100 : 0}
              barColor={METRIC_BAR[activeMetric]} isMe />
          </>
        )}
      </div>

      <p className="text-[10px] text-zinc-700 mt-2">
        情熱指数 = 平均BPM × √コミット数　　チーム対抗 = チーム平均BPM × √チーム総コミット数
      </p>
    </section>
  );
}

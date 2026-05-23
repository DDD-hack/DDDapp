"use client";

import { useEffect, useState } from "react";
import { get, ref } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";
import type { CommitRecord, Member, MemberRankEntry, TeamRankEntry } from "@/lib/firebaseTypes";

const REFRESH_INTERVAL = 60_000;

function calcPassion(avgBpm: number, commits: number): number {
  return Math.round(avgBpm * Math.sqrt(commits));
}

async function fetchAllMemberEntries(): Promise<MemberRankEntry[]> {
  if (!rtdb) return [];

  // /members から全メンバー取得
  const membersSnap = await get(ref(rtdb, "members"));
  const membersData = membersSnap.val() as Record<string, Member> | null;
  if (!membersData) return [];

  const uids = Object.keys(membersData);

  // 全メンバーのコミットを並列取得
  const commitSnaps = await Promise.all(
    uids.map((uid) => get(ref(rtdb!, `commits/${uid}`))),
  );

  return uids.map((uid, i) => {
    const m = membersData[uid];
    const rawCommits = commitSnaps[i].val() as Record<string, CommitRecord> | null;
    const commits = Object.values(rawCommits ?? {});
    const bpms = commits.map((c) => c.bpm).filter((b) => b > 0);
    const count = commits.length;
    const maxBpm = bpms.length ? Math.max(...bpms) : 0;
    const avgBpm = bpms.length
      ? Math.round(bpms.reduce((s, b) => s + b, 0) / bpms.length)
      : 0;

    return {
      uid,
      name: m.name ?? m.email ?? uid,
      teamId: m.teamId ?? "default",
      teamName: m.teamId ?? "DDD",
      commits: count,
      maxBpm,
      avgBpm,
      passion: calcPassion(avgBpm, count),
    };
  });
}

function buildTeamEntries(members: MemberRankEntry[]): TeamRankEntry[] {
  const map = new Map<string, MemberRankEntry[]>();
  for (const m of members) {
    if (!map.has(m.teamId)) map.set(m.teamId, []);
    map.get(m.teamId)!.push(m);
  }
  return Array.from(map.entries()).map(([teamId, ms]) => {
    const totalCommits = ms.reduce((s, m) => s + m.commits, 0);
    const avgBpm = ms.length
      ? Math.round(ms.reduce((s, m) => s + m.avgBpm, 0) / ms.length)
      : 0;
    const maxBpm = ms.length ? Math.max(...ms.map((m) => m.maxBpm)) : 0;
    const teamName = ms[0]?.teamName ?? teamId;
    return {
      teamId,
      teamName,
      memberCount: ms.length,
      maxBpm,
      avgBpm,
      passion: calcPassion(avgBpm, totalCommits),
    };
  });
}

export type RankingState = {
  /** チーム内メンバーランキング（自分と同じ teamId のみ） */
  internal: MemberRankEntry[];
  /** チーム外個人ランキング（全メンバーフラット） */
  externalMembers: MemberRankEntry[];
  /** チーム外チーム対抗ランキング */
  externalTeams: TeamRankEntry[];
  myUid: string | null;
  myTeamId: string | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
};

export function useTeamRanking(): RankingState {
  const { user } = useAuth();
  const [allMembers, setAllMembers] = useState<MemberRankEntry[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!rtdb || !user) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(false);
      try {
        const entries = await fetchAllMemberEntries();
        if (cancelled) return;

        setAllMembers(entries);

        // 自分の teamId を特定
        const me = entries.find((e) => e.uid === user!.uid);
        setMyTeamId(me?.teamId ?? null);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, tick]);

  const internal = myTeamId
    ? allMembers.filter((m) => m.teamId === myTeamId)
    : allMembers;

  return {
    internal,
    externalMembers: allMembers,
    externalTeams: buildTeamEntries(allMembers),
    myUid: user?.uid ?? null,
    myTeamId,
    loading: !!(rtdb && user) && loading,
    error,
    refresh: () => setTick((n) => n + 1),
  };
}

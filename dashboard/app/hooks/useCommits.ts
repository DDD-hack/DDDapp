"use client";

import { useEffect, useState } from "react";
import {
  get,
  limitToLast,
  orderByChild,
  query,
  ref as dbRef,
} from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";

const DAEMON_BASE = (
  process.env.NEXT_PUBLIC_DAEMON_URL || "http://localhost:8765"
).replace(/\/+$/, "");
const POLL_INTERVAL = 15_000;

export type CommitRecord = {
  id: number;
  repo_path: string;
  commit_hash: string;
  bpm: number;
  result: "accepted" | "rejected";
  attempted_at: string;
};

/**
 * RTDB の commits/{uid} から CommitRecord 形式で取得する。
 * ローカル daemon の HTTP API が到達できないクラウド環境（Vercel 等）でのフォールバック。
 *
 * RTDB はネイティブの desc ソートを持たないため、`orderByChild("attempted_at")` で昇順
 * インデックスを使い、`limitToLast(n)` で末尾 n 件（= 最新 n 件・昇順）を取り、
 * 配列化後に reverse して降順に並べ替える。
 */
async function fetchFromRtdb(uid: string, n: number): Promise<CommitRecord[]> {
  if (!rtdb) return [];
  const q = query(
    dbRef(rtdb, `commits/${uid}`),
    orderByChild("attempted_at"),
    limitToLast(n),
  );
  const snap = await get(q);
  if (!snap.exists()) return [];

  const records: CommitRecord[] = [];
  let idx = 0;
  snap.forEach((child) => {
    const data = child.val() as {
      repo_path?: string;
      commit_hash?: string;
      bpm?: number;
      result?: string;
      attempted_at?: number;
    } | null;
    if (!data) return false;
    const attemptedAtMs =
      typeof data.attempted_at === "number" ? data.attempted_at : null;
    records.push({
      // RTDB の push-id は文字列なので、表示順を担保するため配列 index を充てる
      id: idx++,
      repo_path: data.repo_path ?? "",
      commit_hash: data.commit_hash ?? "",
      bpm: typeof data.bpm === "number" ? data.bpm : 0,
      result: data.result === "rejected" ? "rejected" : "accepted",
      attempted_at: attemptedAtMs ? new Date(attemptedAtMs).toISOString() : "",
    });
    return false;
  });
  // snap.forEach は orderByChild の昇順を保つ。降順表示用に反転。
  return records.reverse();
}

export function useCommits(limit = 100) {
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const { user } = useAuth();
  const uid = user?.uid ?? null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let controller: AbortController | null = null;

    async function fetch_() {
      if (inFlight || cancelled) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const res = await fetch(`${DAEMON_BASE}/commits?limit=${limit}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: CommitRecord[] = await res.json();
        if (!cancelled) {
          setCommits(data);
          setError(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;

        // ローカル daemon に届かない: ログイン済み & RTDB 設定済みならフォールバック
        if (uid && rtdb) {
          try {
            const cloudData = await fetchFromRtdb(uid, limit);
            if (!cancelled) {
              setCommits(cloudData);
              setError(false);
            }
          } catch (cloudErr) {
            console.error("rtdb commits fallback:", cloudErr);
            if (!cancelled) setError(true);
          }
        } else if (!cancelled) {
          setError(true);
        }
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
        if (!cancelled) timer = setTimeout(fetch_, POLL_INTERVAL);
      }
    }

    fetch_();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [limit, uid]);

  return { commits, loading, error };
}

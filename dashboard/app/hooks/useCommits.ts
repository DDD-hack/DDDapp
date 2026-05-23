"use client";

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";

const DAEMON_BASE = process.env.NEXT_PUBLIC_DAEMON_URL || "http://localhost:8765";
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
 * Firestore の users/{uid}/commits から CommitRecord 形式で取得する。
 * ローカル daemon の HTTP API が到達できないクラウド環境（Vercel 等）でのフォールバック。
 */
async function fetchFromFirestore(uid: string, n: number): Promise<CommitRecord[]> {
  if (!db) return [];
  const q = query(
    collection(db, "users", uid, "commits"),
    orderBy("attemptedAt", "desc"),
    fsLimit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d, i) => {
    const data = d.data() as {
      repoPath?: string;
      commitHash?: string;
      bpm?: number;
      result?: string;
      attemptedAt?: { toDate?: () => Date };
    };
    const attemptedAt =
      data.attemptedAt && typeof data.attemptedAt.toDate === "function"
        ? data.attemptedAt.toDate()
        : null;
    return {
      // Firestore に数値 ID は無いので、表示順を担保するために配列 index を充てる
      id: i,
      repo_path: data.repoPath ?? "",
      commit_hash: data.commitHash ?? "",
      bpm: typeof data.bpm === "number" ? data.bpm : 0,
      result: data.result === "rejected" ? "rejected" : "accepted",
      attempted_at: attemptedAt ? attemptedAt.toISOString() : "",
    };
  });
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

        // ローカル daemon に届かない: ログイン済みなら Firestore へフォールバック
        if (uid && db) {
          try {
            const cloudData = await fetchFromFirestore(uid, limit);
            if (!cancelled) {
              setCommits(cloudData);
              setError(false);
            }
          } catch (cloudErr) {
            console.error("firestore commits fallback:", cloudErr);
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

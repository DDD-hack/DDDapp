"use client";

import { useEffect, useState } from "react";

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

export function useCommits(limit = 100) {
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
        if (!cancelled) setError(true);
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
  }, [limit]);

  return { commits, loading, error };
}

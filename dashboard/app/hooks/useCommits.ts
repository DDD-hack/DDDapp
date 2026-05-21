"use client";

import { useEffect, useState } from "react";

const DAEMON_BASE = "http://localhost:8765";
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

    async function fetch_() {
      try {
        const res = await fetch(`${DAEMON_BASE}/commits?limit=${limit}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: CommitRecord[] = await res.json();
        if (!cancelled) {
          setCommits(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch_();
    const id = setInterval(fetch_, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [limit]);

  return { commits, loading, error };
}

"use client";

import { useEffect, useRef, useState } from "react";

const DAEMON_WS = "ws://localhost:8765/ws/vscode";
const RECONNECT_DELAY = 5000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type CommitEvent = {
  id: number;
  result: "accepted" | "rejected";
  bpm: number;
  at: Date;
};

export type DaemonState = {
  bpm: number | null;
  stale: boolean;
  status: ConnectionStatus;
  commits: CommitEvent[];
};

export function useDaemon(): DaemonState {
  const [bpm, setBpm] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [commits, setCommits] = useState<CommitEvent[]>([]);
  const commitIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;
      setStatus("connecting");

      const ws = new WebSocket(DAEMON_WS);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (unmountedRef.current) return ws.close();
        setStatus("connected");
      });

      ws.addEventListener("message", (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "bpm" && typeof msg.bpm === "number") {
            const isStale = msg.status === "stale" || msg.bpm === 0;
            setStale(isStale);
            setBpm(isStale ? null : msg.bpm);
          } else if (
            msg.type === "commit_result" &&
            (msg.result === "accepted" || msg.result === "rejected") &&
            typeof msg.bpm === "number"
          ) {
            setCommits((prev) => [
              {
                id: ++commitIdRef.current,
                result: msg.result,
                bpm: msg.bpm,
                at: new Date(),
              },
              ...prev.slice(0, 19),
            ]);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener("close", () => {
        if (unmountedRef.current) return;
        setStatus("disconnected");
        setBpm(null);
        timerRef.current = setTimeout(connect, RECONNECT_DELAY);
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { bpm, stale, status, commits };
}

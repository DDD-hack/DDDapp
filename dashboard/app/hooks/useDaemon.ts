"use client";

import { useEffect, useRef, useState } from "react";
import { onValue, ref as dbRef } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";

// 末尾スラッシュを削っておく (URL 結合で // にならないように)
const DAEMON_WS = (process.env.NEXT_PUBLIC_DAEMON_WS_URL || "ws://localhost:8765/ws/vscode").replace(/\/+$/, "");
const RECONNECT_DELAY = 5000;
/** WS が切れてから RTDB フォールバックへ切り替えるまでの待ち時間。 */
const FALLBACK_DELAY = 3000;
/** RTDB から読んだ updated_at がこれ以上古ければ stale とみなす。 */
const CLOUD_STALE_MS = 10000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "cloud";

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

type AuthLike = { uid: string; displayName: string | null } | null;

function sendAuthSync(ws: WebSocket | null, u: AuthLike) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(
      JSON.stringify({
        type: "auth_sync",
        uid: u?.uid ?? "",
        displayName: u?.displayName ?? "",
      }),
    );
  } catch {
    // 接続が落ち際の send 失敗は無視（次の connect で再送される）
  }
}

export function useDaemon(): DaemonState {
  const [bpm, setBpm] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [commits, setCommits] = useState<CommitEvent[]>([]);

  const { user } = useAuth();
  // WS の各種コールバック（接続後の open ハンドラなど）から「最新の user」を
  // 参照したいので ref に逃がす。ref の更新は別 effect で行い、render 中の
  // ref 書き換えを避ける。
  const userRef = useRef<AuthLike>(user);

  const commitIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRtdbRef = useRef<(() => void) | null>(null);
  const unmountedRef = useRef(false);

  // RTDB フォールバックの開始/停止 --------------------------------------------

  function stopRtdbFallback() {
    if (unsubRtdbRef.current) {
      unsubRtdbRef.current();
      unsubRtdbRef.current = null;
    }
  }

  function startRtdbFallback(uid: string) {
    if (unsubRtdbRef.current || !rtdb) return;
    setStatus("cloud");
    const r = dbRef(rtdb, `users/${uid}`);
    unsubRtdbRef.current = onValue(
      r,
      (snap) => {
        const data = snap.val() as
          | { current_bpm?: number; updated_at?: number }
          | null;
        if (!data) {
          setBpm(null);
          setStale(true);
          return;
        }
        const cloudBpm = typeof data.current_bpm === "number" ? data.current_bpm : null;
        const updatedAtMs = typeof data.updated_at === "number" ? data.updated_at : null;
        const ageMs = updatedAtMs ? Date.now() - updatedAtMs : Infinity;
        const isStale = cloudBpm == null || ageMs > CLOUD_STALE_MS;
        setStale(isStale);
        setBpm(isStale ? null : cloudBpm);
      },
      (err) => {
        console.error("rtdb onValue:", err);
      },
    );
  }

  // WebSocket 接続 -----------------------------------------------------------

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;
      setStatus("connecting");

      const ws = new WebSocket(DAEMON_WS);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (unmountedRef.current) {
          ws.close();
          return;
        }
        // WS が復活したらフォールバック関係を全部止めて WS 経路に戻す
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        stopRtdbFallback();
        setStatus("connected");
        sendAuthSync(ws, userRef.current);
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
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);

        // 切断が FALLBACK_DELAY 続いたら、ログイン中ユーザー & RTDB 設定済みなら
        // クラウド経由のリアルタイム購読へフォールバック
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
          fallbackTimerRef.current = null;
          const u = userRef.current;
          if (u && rtdb) {
            startRtdbFallback(u.uid);
          }
        }, FALLBACK_DELAY);
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      stopRtdbFallback();
      wsRef.current?.close();
    };
    // 接続は一度だけ確立する。ユーザー変更は別 effect で auth_sync 経由で反映する。
  }, []);

  // ユーザー変更時の追従 -----------------------------------------------------
  //   - 最新 user を ref に反映（WS コールバックから参照される）
  //   - WS が open ならその場で auth_sync を再送
  //   - RTDB フォールバック中なら購読先 uid を切替（user が null なら停止）
  useEffect(() => {
    userRef.current = user;
    sendAuthSync(wsRef.current, user);

    // Clear displayed state asynchronously to avoid set-state-in-effect warning
    setTimeout(() => {
      if (unmountedRef.current) return;
      setBpm(null);
      setStale(false);
      if (!user) {
        setStatus("disconnected");
      }
    }, 0);

    if (unsubRtdbRef.current) {
      stopRtdbFallback();
      if (user && rtdb) {
        startRtdbFallback(user.uid);
      }
    }
  }, [user]);

  return { bpm, stale, status, commits };
}

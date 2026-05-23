"use client";

import { useEffect, useState } from "react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";
import type { Member } from "@/lib/firebaseTypes";

export type MemberHeartbeat = {
  uid: string;
  name: string;
  bpm: number | null;
  updatedAt: number | null; // Unix ms
};

export function useFirebaseHeartbeat(): MemberHeartbeat[] {
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberHeartbeat[]>([]);

  useEffect(() => {
    if (!rtdb || !user) return;

    const bpmUnsubs: Array<() => void> = [];

    const membersUnsub = onValue(ref(rtdb, "members"), (snap) => {
      bpmUnsubs.forEach((fn) => fn());
      bpmUnsubs.length = 0;

      const raw = snap.val() as Record<string, Member> | null;
      if (!raw) {
        setMembers([]);
        return;
      }

      const uids = Object.keys(raw);
      setMembers(
        uids.map((uid) => ({
          uid,
          name: raw[uid].name ?? uid,
          bpm: null,
          updatedAt: null,
        }))
      );

      uids.forEach((uid) => {
        const unsub = onValue(
          ref(rtdb!, "users/" + uid),
          (bpmSnap) => {
            const val = bpmSnap.val() as
              | { current_bpm?: number; updated_at?: number }
              | null;
            setMembers((prev) =>
              prev.map((m) =>
                m.uid === uid
                  ? {
                      ...m,
                      bpm: val?.current_bpm ?? null,
                      updatedAt: val?.updated_at ?? null,
                    }
                  : m
              )
            );
          }
        );
        bpmUnsubs.push(unsub);
      });
    });

    return () => {
      membersUnsub();
      bpmUnsubs.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  return !rtdb || !user ? [] : members;
}

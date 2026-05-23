"use client";

import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useAuth } from "../auth/AuthProvider";

export type MemberHeartbeat = {
  uid: string;
  name: string;
  bpm: number | null;
  updatedAt: number | null;
};

export function useFirebaseHeartbeat(): MemberHeartbeat[] {
  const [members, setMembers] = useState<MemberHeartbeat[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    if (!rtdb || !user) {
      setMembers([]);
      return;
    }

    const db = rtdb;
    const membersRef = ref(db, "members");
    const hbUnsubs: (() => void)[] = [];

    const unsubMembers = onValue(membersRef, (snap) => {
      hbUnsubs.forEach((u) => u());
      hbUnsubs.length = 0;

      const raw = snap.val() as Record<
        string,
        { name?: string; email?: string }
      > | null;

      if (!raw) {
        setMembers([]);
        return;
      }

      const initial: MemberHeartbeat[] = Object.entries(raw).map(
        ([uid, data]) => ({
          uid,
          name: data.name ?? data.email ?? uid,
          bpm: null,
          updatedAt: null,
        }),
      );
      setMembers(initial);

      Object.keys(raw).forEach((uid) => {
        const hbRef = ref(db, `users/${uid}`);
        const unsub = onValue(hbRef, (hbSnap) => {
          const data = hbSnap.val() as
            | { current_bpm?: number; updated_at?: number }
            | null;
          setMembers((prev) =>
            prev.map((m) =>
              m.uid === uid
                ? {
                    ...m,
                    bpm: typeof data?.current_bpm === "number" ? data.current_bpm : null,
                    updatedAt: typeof data?.updated_at === "number" ? data.updated_at : null,
                  }
                : m,
            ),
          );
        });
        hbUnsubs.push(unsub);
      });
    });

    return () => {
      unsubMembers();
      hbUnsubs.forEach((u) => u());
    };
  }, [user]);

  return members;
}

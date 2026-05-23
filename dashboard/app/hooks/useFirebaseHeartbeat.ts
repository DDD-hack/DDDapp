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
  const [membersOwnerUid, setMembersOwnerUid] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!rtdb || !user) return;

    const db = rtdb;
    const currentUid = user.uid;
    const membersRef = ref(db, "members");
    const hbUnsubs: (() => void)[] = [];

    const unsubMembers = onValue(membersRef, (snap) => {
      hbUnsubs.forEach((u) => u());
      hbUnsubs.length = 0;

      const raw = snap.val() as Record<
        string,
        { name?: string; email?: string }
      > | null;

      // onValue コールバック内でのみ setState — lint OK、かつ uid を紐づける
      if (!raw) {
        setMembersOwnerUid(currentUid);
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
      setMembersOwnerUid(currentUid);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // membersOwnerUid が現在の user と一致するときだけ返す
  // 不一致の間（ユーザー切替直後）は [] を返し旧データを見せない
  return user?.uid === membersOwnerUid ? members : [];
}

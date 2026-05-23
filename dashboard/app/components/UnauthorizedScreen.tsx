"use client";

import type { User } from "firebase/auth";
import { useAuth } from "../auth/AuthProvider";

export function UnauthorizedScreen({ user }: { user: User }) {
  const { signOut } = useAuth();

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 px-8">
      <div className="text-6xl font-black tracking-widest text-red-600 animate-pulse">
        DEAD
      </div>
      <div className="text-center">
        <p className="text-sm font-mono tracking-widest text-zinc-400">
          アクセス権がありません
        </p>
        <p className="text-xs text-zinc-600 mt-2">
          {user.email} はチームメンバーに登録されていません
        </p>
      </div>
      <div className="border border-zinc-800 rounded-xl px-6 py-4 text-center max-w-sm">
        <p className="text-[10px] text-zinc-500 tracking-widest mb-1">YOUR UID</p>
        <p className="text-xs font-mono text-zinc-300 break-all">{user.uid}</p>
        <p className="text-[10px] text-zinc-600 mt-2">
          このUIDをリーダーに共有して登録してもらってください
        </p>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="text-[10px] font-mono tracking-widest text-zinc-600 hover:text-red-400 transition-colors border border-zinc-800 rounded px-4 py-2"
      >
        ログアウト
      </button>
    </main>
  );
}

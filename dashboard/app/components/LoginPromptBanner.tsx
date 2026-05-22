"use client";

import { useAuth } from "../auth/AuthProvider";

export function LoginPromptBanner() {
  const { user, loading, configured, signIn } = useAuth();

  // Firebase未設定、ログイン済み、またはロード中の場合はバナーを表示しない
  if (!configured || loading || user) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-900 bg-zinc-950 px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[0_0_30px_rgba(239,68,68,0.03)] border-l-0">
      {/* Dynamic neon left accent line */}
      <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-red-500 via-red-600 to-amber-500" />
      
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-black text-white tracking-widest flex items-center gap-2">
          <span className="text-red-500 animate-pulse">🔥</span> クラウド同期で情熱を永続化
        </h3>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed max-w-2xl">
          Googleアカウントでログインすると、過去のすべてのコミット履歴がクラウド（Firestore）に自動保存され、複数デバイスでのデータ同期や、チーム全体でのグローバルな情熱ランキングへの参加が可能になります。
        </p>
      </div>

      <button
        type="button"
        onClick={signIn}
        className="shrink-0 flex items-center gap-2 text-xs font-mono font-black tracking-widest text-black bg-gradient-to-r from-red-500 to-amber-500 hover:from-red-400 hover:to-amber-400 px-5 py-2.5 rounded-md shadow-[0_0_20px_rgba(239,68,68,0.25)] transition-all duration-300 hover:shadow-[0_0_30px_rgba(239,68,68,0.4)] transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <span>GOOGLE LOGIN</span>
        <span className="text-[10px]">▶</span>
      </button>
    </div>
  );
}

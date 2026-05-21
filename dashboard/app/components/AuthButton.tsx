"use client";

import { useAuth } from "../auth/AuthProvider";

/** displayName から頭文字を1文字取り出す（アバター表示用）。 */
function initial(name: string | null | undefined): string {
  return name?.trim()?.[0]?.toUpperCase() ?? "?";
}

/**
 * ダッシュボード上部に表示する認証状態 UI。
 * - 未設定: 「LOCAL MODE」表示（ローカルのみモード）
 * - 未ログイン: 「Google でログイン」ボタン
 * - ログイン済み: displayName とログアウトボタン
 */
export function AuthButton() {
  const { user, loading, configured, signIn, signOut } = useAuth();

  if (!configured) {
    return (
      <span
        className="text-[10px] font-mono tracking-widest text-zinc-600"
        title="Firebase 未設定のためローカルのみで動作中"
      >
        LOCAL MODE
      </span>
    );
  }

  if (loading) {
    return (
      <span className="text-[10px] font-mono tracking-widest text-zinc-700">
        ···
      </span>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={signIn}
        className="text-[10px] font-mono font-semibold tracking-widest text-zinc-300 border border-zinc-800 rounded-md px-3 py-1.5 hover:border-zinc-600 hover:text-white transition-colors"
      >
        Google でログイン
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-950 border border-red-900/60 text-[11px] font-bold text-red-300">
        {initial(user.displayName)}
      </span>
      <span className="text-xs font-semibold text-zinc-200 max-w-[140px] truncate">
        {user.displayName ?? "ユーザー"}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="text-[10px] font-mono tracking-widest text-zinc-600 hover:text-red-400 transition-colors"
      >
        ログアウト
      </button>
    </div>
  );
}

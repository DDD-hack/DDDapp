"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { FirebaseError } from "firebase/app";
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { ref, onValue, set } from "firebase/database";
import { auth, rtdb, isFirebaseConfigured } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  /** /members/{uid} に登録されているか。DB未設定なら常に true。 */
  isMember: boolean;
  signIn: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const IGNORED_AUTH_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured);
  const [isMember, setIsMember] = useState(!isFirebaseConfigured);
  // Firebase設定済みの場合は最初から true にしてフラッシュを防ぐ
  const [memberLoading, setMemberLoading] = useState(isFirebaseConfigured);

  // 認証状態を監視
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      if (!nextUser) {
        setIsMember(false);
        setMemberLoading(false);
      }
    });
  }, []);

  // ログイン後に /members/{uid} を監視し、未登録なら自動登録
  useEffect(() => {
    if (!rtdb || !user) return;
    const memberRef = ref(rtdb, `members/${user.uid}`);

    return onValue(memberRef, (snap) => {
      if (!snap.exists()) {
        // 初回ログイン時に自動登録。楽観的に true にしてフリッカーを防ぐ
        setIsMember(true);
        set(memberRef, {
          name: user.displayName ?? user.email ?? "unknown",
          email: user.email ?? "",
          joinedAt: Date.now(),
        }).catch((err) => {
          console.error("メンバー登録に失敗しました:", err);
          setIsMember(false);
        });
      } else {
        setIsMember(true);
      }
      setMemberLoading(false);
    });
  }, [user]);

  const loading = authLoading || memberLoading;

  async function signIn() {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      if (err instanceof FirebaseError && IGNORED_AUTH_CODES.has(err.code)) return;
      console.error("Google ログインに失敗しました:", err);
      throw err;
    }
  }

  async function signInWithGitHub() {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await signInWithPopup(auth, new GithubAuthProvider());
    } catch (err) {
      if (err instanceof FirebaseError && IGNORED_AUTH_CODES.has(err.code)) return;
      console.error("GitHub ログインに失敗しました:", err);
      throw err;
    }
  }

  async function signOut() {
    if (!isFirebaseConfigured || !auth) return;
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error("ログアウトに失敗しました:", err);
      throw err;
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, configured: isFirebaseConfigured, isMember, signIn, signInWithGitHub, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth は AuthProvider の内側で使ってください");
  }
  return ctx;
}

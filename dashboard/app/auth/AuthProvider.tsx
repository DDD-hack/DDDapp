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
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/lib/firebase";

type AuthContextValue = {
  /** ログイン中のユーザー。未ログイン時は null。 */
  user: User | null;
  /** 認証状態の初期確認が終わるまで true。 */
  loading: boolean;
  /** Firebase 環境変数が設定済みでログイン機能が使えるか。 */
  configured: boolean;
  /** Google アカウントでログインする。 */
  signIn: () => Promise<void>;
  /** ログアウトする。 */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** ユーザーが自分でポップアップを閉じた等、エラー扱いしないコード。 */
const IGNORED_AUTH_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Firebase 未設定なら確認すべき認証状態が無いので初期から loading=false。
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signIn() {
    if (!isFirebaseConfigured) return;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      if (err instanceof FirebaseError && IGNORED_AUTH_CODES.has(err.code)) {
        return;
      }
      console.error("Google ログインに失敗しました:", err);
    }
  }

  async function signOut() {
    if (!isFirebaseConfigured) return;
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error("ログアウトに失敗しました:", err);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, configured: isFirebaseConfigured, signIn, signOut }}
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

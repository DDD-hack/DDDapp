import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Firebase の必須環境変数がすべて設定されているか。
 *
 * 未設定の場合はログイン機能を無効化し、ダッシュボードを
 * 「ローカルのみ」モードで動作させる（ハッカソンで全員が
 * Firebase をセットアップしていなくても動かせるようにするため）。
 */
export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

/**
 * Firebase アプリ本体。
 * Next.js の Fast Refresh / SSR で本モジュールが複数回評価されても
 * 二重初期化しないよう、既存インスタンスがあれば再利用する。
 */
export const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/** Firebase Authentication インスタンス。 */
export const auth: Auth = getAuth(app);

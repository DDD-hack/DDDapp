import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
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
    firebaseConfig.appId &&
    firebaseConfig.databaseURL,
);

/**
 * Firebase アプリ本体。環境変数が未設定の場合は null。
 *
 * 必須キー（apiKey など）が undefined のまま initializeApp() を呼ぶと
 * Firebase SDK が実行時エラーを投げ、本モジュールを import した
 * ダッシュボード全体がモジュール評価時点でクラッシュする。
 * そのため未設定時は初期化自体をスキップし null をエクスポートして、
 * 「ローカルのみ」モードで動作させる。
 *
 * Next.js の Fast Refresh / SSR で本モジュールが複数回評価されても
 * 二重初期化しないよう、既存インスタンスがあれば再利用する。
 */
export const app: FirebaseApp | null = isFirebaseConfigured
  ? getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp()
  : null;

/** Firebase Authentication インスタンス。未設定時は null。 */
export const auth: Auth | null = app ? getAuth(app) : null;

/**
 * Firestore インスタンス。未設定時は null。
 *
 * Vercel 等のクラウド環境で、ローカル daemon への WebSocket が到達できない場合の
 * フォールバック取得経路として `useDaemon` / `useCommits` から使う。
 */
export const db: Firestore | null = app ? getFirestore(app) : null;
/** Firebase Realtime Database インスタンス。未設定時は null。 */
export const rtdb: Database | null = app && firebaseConfig.databaseURL ? getDatabase(app) : null;

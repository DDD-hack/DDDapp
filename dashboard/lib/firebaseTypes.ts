/** Firebase Realtime Database のスキーマ型定義 */

/** /members/{uid} — チームメンバー一覧 */
export type Member = {
  name: string;
  email: string;
  joinedAt: number; // Unix ms
  teamId?: string;  // チーム識別子（Firebaseコンソールで設定）
};

/**
 * /heartbeat/{uid} — 現在の心拍（daemonがリアルタイムで更新）
 * - "ok"      : 10秒以内にサンプルあり
 * - "stale"   : 10秒以上サンプルなし（daemon起動中だが計測途絶え）
 * - "offline" : daemonが未起動 or 長期間未送信（FE側で判定して書き込む）
 */
export type Heartbeat = {
  bpm: number;
  status: "ok" | "stale" | "offline";
  updatedAt: number; // Unix ms
};

/** /commits/{uid}/{pushId} — コミット履歴 */
export type CommitRecord = {
  bpm: number;
  result: "accepted" | "rejected";
  repo: string;
  /** accepted時のみ値あり。rejectedはコミット未実行のため null */
  hash: string | null;
  committedAt: number; // Unix ms
};

/** /stats/{uid} — 集計済み統計（ランキング表示用） */
export type UserStats = {
  /** BPMが閾値以下でrejectedされたコミット数（DEADランキング用） */
  deadCount: number;
  totalAccepted: number;
  /** 歴代最高BPM（accepted・rejectedどちらも対象） */
  maxBpm: number;
  lastCommitAt: number; // Unix ms
};

/** /heatmap/{uid}/{YYYY-MM-DD} — 日別コミット数（ヒートマップ用） */
export type HeatmapDay = {
  accepted: number;
  rejected: number;
  maxBpm: number;
};

// ---- ランキング集計型 ----

export type MemberRankEntry = {
  uid: string;
  name: string;
  teamId: string;
  teamName: string;
  commits: number;
  maxBpm: number;
  avgBpm: number;
  passion: number; // avgBpm × √commits
};

export type TeamRankEntry = {
  teamId: string;
  teamName: string;
  memberCount: number;
  maxBpm: number;
  avgBpm: number;
  passion: number; // チーム平均BPM × √チーム総コミット数
};

/**
 * DB全体のルート構造（ドキュメント用型定義）
 * Firebase SDK は ref(db, path) に型を直接渡せないため、
 * snap.val() のキャスト先として各子型（Member, Heartbeat等）を使う。
 * この型自体はコード上の参照用。
 */
export type DatabaseSchema = {
  members: Record<string, Member>;
  heartbeat: Record<string, Heartbeat>;
  commits: Record<string, Record<string, CommitRecord>>;
  stats: Record<string, UserStats>;
  heatmap: Record<string, Record<string, HeatmapDay>>;
};

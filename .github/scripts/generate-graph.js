#!/usr/bin/env node
// Reads DDD-BPM trailers from PR commits and outputs a Mermaid PR comment.
// Usage: node generate-graph.js <base-sha> <head-sha>

const { execFileSync } = require("child_process");

const baseSha = process.argv[2];
const headSha = process.argv[3];

if (!baseSha || !headSha) {
  console.error("Usage: generate-graph.js <base-sha> <head-sha>");
  process.exit(1);
}

const shaRe = /^[0-9a-fA-F]{40}$/;
if (!shaRe.test(baseSha) || !shaRe.test(headSha)) {
  console.error("base-sha and head-sha must be full 40-character commit SHAs");
  process.exit(1);
}

let logOutput;
try {
  logOutput = execFileSync("git", ["log", `${baseSha}..${headSha}`, "--format=%H %at %s"], {
    encoding: "utf8",
  });
} catch (err) {
  console.error(`git log failed: ${err.message}`);
  process.exit(1);
}

const commits = logOutput
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const parts = line.split(" ");
    return {
      hash: parts[0],
      unixTime: parseInt(parts[1], 10),
      subject: parts.slice(2).join(" "),
    };
  })
  .reverse();

if (commits.length === 0) {
  process.exit(0);
}

// Extract DDD-BPM trailer from each commit
const data = [];
for (const commit of commits) {
  let body;
  try {
    body = execFileSync("git", ["log", "-1", "--format=%B", commit.hash], {
      encoding: "utf8",
    });
  } catch {
    continue;
  }
  // 正しい trailer は "DDD-BPM:"(D 3 つ)。
  // ただし古い prepare-commit-msg hook が "DDDD-BPM:"(D 4 つ)で書いていた
  // 過去コミットが既に存在するので、後方互換として 4 つ目の D も optional に。
  const match = body.match(/^\s*DDDD?-BPM:\s*(\d+)/m);
  if (!match) continue;

  data.push({
    hash: commit.hash.slice(0, 7),
    subject: commit.subject,
    bpm: parseInt(match[1], 10),
    unixTime: commit.unixTime,
  });
}

if (data.length === 0) {
  process.exit(0);
}

const bpms = data.map((c) => c.bpm);
const maxBPM = Math.max(...bpms);
const avgBPM = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
const total = data.length;
const accepted = data.filter((c) => c.bpm > 120).length;
const rejected = total - accepted;
const successRate = Math.round((accepted / total) * 100);
const deadRate = 100 - successRate;

// Top 3 commits by BPM
const medals = ["🥇", "🥈", "🥉"];
const topCommits = [...data].sort((a, b) => b.bpm - a.bpm).slice(0, 3);

// Time band analysis (JST = UTC+9)
const bandLabels = {
  "00-06": "深夜（ 0〜 6時）",
  "06-12": "午前（ 6〜12時）",
  "12-18": "午後（12〜18時）",
  "18-24": "夜  （18〜24時）",
};
const bandData = {};
for (const c of data) {
  const h = (new Date(c.unixTime * 1000).getUTCHours() + 9) % 24;
  const key = h < 6 ? "00-06" : h < 12 ? "06-12" : h < 18 ? "12-18" : "18-24";
  if (!bandData[key]) bandData[key] = { total: 0, accepted: 0 };
  bandData[key].total++;
  if (c.bpm > 120) bandData[key].accepted++;
}
const bands = ["00-06", "06-12", "12-18", "18-24"]
  .filter((k) => bandData[k])
  .map((k) => {
    const b = bandData[k];
    const succ = Math.round((b.accepted / b.total) * 100);
    return { key: k, label: bandLabels[k], succPct: succ, deadPct: 100 - succ, hasDead: b.accepted < b.total };
  });

let bestBand = null;
let worstBand = null;
for (const b of bands) {
  if (!bestBand || b.succPct > bestBand.succPct) bestBand = b;
  if (b.hasDead && (!worstBand || b.deadPct > worstBand.deadPct)) worstBand = b;
}

// Mermaid chart
const threshold = 120;
const xLabels = data.map((_, i) => `"#${i + 1}"`);
const rawMin = Math.min(...bpms);
const rawMax = Math.max(...bpms);
const yMin = rawMin < 40 ? Math.max(0, rawMin - 20) : 40;
const yMax = rawMax > 220 ? rawMax + 20 : 220;

const chart = [
  "```mermaid",
  "%%{init: {'xyChart': {'plotColorPalette': '#2979ff'}}}%%",
  "xychart-beta",
  `  title "Commit BPM History"`,
  `  x-axis [${xLabels.join(", ")}]`,
  `  y-axis "BPM" ${yMin} --> ${yMax}`,
  `  line [${bpms.join(", ")}]`,
  "```",
].join("\n");

const commitTable =
  "| # | BPM | 判定 | コミット |\n|---|-----|------|----------|\n" +
  data.map((c, i) =>
    `| #${i + 1} | ${c.bpm} | ${c.bpm > threshold ? "✅" : "💀"} | ${c.subject} |`
  ).join("\n");

const bestCommitsSection = topCommits
  .map((c, i) => `${medals[i]} **${c.bpm} bpm**  ${c.subject}`)
  .join("\n");

let timeBandSection = "";
if (bands.length > 0) {
  const lines = ["⏰ **時間帯分析**\n\n"];
  if (bestBand) lines.push(`🔥 ゴールデンタイム\n  ${bestBand.label}：成功率 ${bestBand.succPct}%\n\n`);
  if (worstBand && worstBand !== bestBand) lines.push(`💀 危険時間帯\n  ${worstBand.label}：DEAD率 ${worstBand.deadPct}%\n\n`);
  for (const b of bands) {
    if (b === bestBand || b === worstBand) continue;
    lines.push(`🌙 ${b.label}：成功率 ${b.succPct}%\n\n`);
  }
  timeBandSection = "\n" + lines.join("");
}

const body = `## 💗 DDD Heart Rate Report

| 指標 | 値 |
|------|-----|
| 最大心拍 | ${maxBPM} bpm 🔥 |
| 平均心拍 | ${avgBPM} bpm |
| DEAD 回数 | ${rejected} 回 💀 |

📊 **基本統計**
  最大心拍 : ${maxBPM} bpm
  平均心拍 : ${avgBPM} bpm
  成功率   : ${successRate}%（${accepted} / ${total} 回）
  DEAD率   : ${deadRate}%（${rejected} / ${total} 回）

🏆 **ベストコミット**
${bestCommitsSection}
${timeBandSection}
${chart}

${commitTable}

<sub>Generated by [DDD](https://github.com/DDD-hack/DDDapp) ❤️</sub>`;

process.stdout.write(body);

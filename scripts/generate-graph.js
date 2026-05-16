#!/usr/bin/env node
// generate-graph.js — BPM history graph generator
// Called by GitHub Actions. Dependencies (chart.js, chartjs-node-canvas) are
// installed in the Actions workflow, not tracked in a package.json here.

const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const fs = require("fs");
const path = require("path");

const DATA_FILE = process.argv[2] || "data/bpm.json";
const OUT_FILE = process.argv[3] || "public/graph.png";

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`Data file not found: ${DATA_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const labels = raw.map((d) => d.date);
  const values = raw.map((d) => d.bpm);

  const canvas = new ChartJSNodeCanvas({ width: 1200, height: 400 });
  const image = await canvas.renderToBuffer({
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "BPM",
          data: values,
          borderColor: "rgba(99,102,241,1)",
          backgroundColor: "rgba(99,102,241,0.1)",
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false } },
    },
  });

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, image);
  console.log(`Graph written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

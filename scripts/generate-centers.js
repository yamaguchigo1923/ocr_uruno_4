// C:\Users\yamag\project\ocr_uruno_4\scripts\generate-centers.js
// 使い方（PowerShell）:
//   node .\scripts\generate-centers.js
// 上書きしたい場合：
//   set FORCE_OVERWRITE=1; node .\scripts\generate-centers.js

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const CFG_DIR = path.join(ROOT, "src", "app", "config");
const ALL_CENTERS = path.join(CFG_DIR, "all_centers.json");
const CENTERS_DIR = path.join(CFG_DIR, "centers");

// defalt.json（既存）と default.json（将来修正）どちらにも対応
const DEFAULT_JSON_CANDIDATES = [
  path.join(CENTERS_DIR, "default.json"),
  path.join(CENTERS_DIR, "defalt.json"),
];

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function slugifyFallback(name, index) {
  // 日本語はASCIIに落とせないため、空IDのときは連番スラッグにする
  const n = String(index + 1).padStart(2, "0");
  return `center-${n}`;
}

function mergeDeep(base, override) {
  // base（default）に override（id/displayName）を浅く上書き
  return { ...base, ...override };
}

function main() {
  if (!fs.existsSync(ALL_CENTERS)) {
    console.error(`[ERROR] not found: ${ALL_CENTERS}`);
    process.exit(1);
  }
  const defPath =
    DEFAULT_JSON_CANDIDATES.find((p) => fs.existsSync(p)) ||
    DEFAULT_JSON_CANDIDATES[DEFAULT_JSON_CANDIDATES.length - 1];
  if (!fs.existsSync(defPath)) {
    console.error(
      `[ERROR] default template not found. Create one of:\n  - ${DEFAULT_JSON_CANDIDATES.join(
        "\n  - "
      )}`
    );
    process.exit(1);
  }

  const all = readJSON(ALL_CENTERS);
  const def = readJSON(defPath);
  ensureDir(CENTERS_DIR);

  const force = process.env.FORCE_OVERWRITE === "1";

  const created = [];
  const skipped = [];
  all.forEach((item, idx) => {
    const id =
      (item.id || "").trim() ||
      slugifyFallback((item.displayName || "").trim(), idx);
    const displayName = (item.displayName || "").trim() || id;

    const out = mergeDeep(def, { id, displayName });
    const outPath = path.join(CENTERS_DIR, `${id}.json`);

    if (fs.existsSync(outPath) && !force) {
      skipped.push({ id, path: outPath });
      return;
    }
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
    created.push({ id, path: outPath });
  });

  console.log(`[OK] generated: ${created.length}, skipped: ${skipped.length}`);
  if (created.length) {
    created.forEach((c) => console.log(`  + ${c.id} -> ${c.path}`));
  }
  if (skipped.length) {
    console.log(
      `[INFO] skipped existing files (set FORCE_OVERWRITE=1 to overwrite):`
    );
    skipped.forEach((s) => console.log(`  - ${s.id} -> ${s.path}`));
  }
}

main();

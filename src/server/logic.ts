// OCR 後処理ロジック (Python 版から必要最小限移植雛形)

export type TableMatrix = string[][];

// 成分表/見本列を付加し、判定列からフラグ推定
export function processBidTables(raw: TableMatrix): TableMatrix {
  if (!raw.length) return [];
  const header = [...raw[0]];
  if (!header.includes("成分表")) header.push("成分表");
  if (!header.includes("見本")) header.push("見本");

  // 判定候補（銘柄・条件）っぽい列 index を簡易推定
  const prefer = new Set(["銘柄·条件", "銘柄・条件", "銘柄条件"]);
  let judgeIdx: number | null = null;
  raw[0].forEach((h, i) => {
    const norm = (h || "").replace(/[ 　]/g, "").replace("・", "·");
    const cmp = norm.replace("·", "");
    if (prefer.has(norm) || prefer.has(cmp) || cmp === "銘柄条件") {
      if (judgeIdx == null) judgeIdx = i;
    }
  });
  if (judgeIdx == null)
    judgeIdx = raw[0].findIndex((h) => /条件|見本|備考/.test(h || ""));
  if (judgeIdx < 0) judgeIdx = 0;

  const out: TableMatrix = [header];
  const matchSeibun = new Set("成分表提出");
  for (let r = 1; r < raw.length; r++) {
    const row = [...raw[r]];
    while (row.length < header.length) row.push("");
    const val = row[judgeIdx] || "";
    const cnt = [...new Set(val.split(""))].filter((c) =>
      matchSeibun.has(c)
    ).length;
    row[header.indexOf("成分表")] = cnt >= 2 ? "○" : "-";
    row[header.indexOf("見本")] = val.includes("見本") ? "3" : "-";
    out.push(row);
  }
  return out;
}

// 参照テーブルと OCR テーブルから selections を抽出（簡易版）
export function buildSelections(ocrTable: TableMatrix) {
  // OCR header 必須: メーカー / 商品CD / 成分表 / 見本
  if (!ocrTable.length) return [] as Array<[string, string, string, string]>;
  const header = ocrTable[0];
  const colIdx = (name: string) => header.findIndex((h) => h === name);
  const mIdx = colIdx("メーカー");
  const cdIdx = colIdx("商品CD");
  const sIdx = colIdx("成分表");
  const miIdx = colIdx("見本");
  if ([mIdx, cdIdx, sIdx, miIdx].some((i) => i < 0)) return [];
  const out: Array<[string, string, string, string]> = [];
  for (let i = 1; i < ocrTable.length; i++) {
    const r = ocrTable[i];
    const maker = r[mIdx] || "";
    const cd = r[cdIdx] || "";
    if (!maker || !cd) continue;
    out.push([maker, cd, r[sIdx] || "-", r[miIdx] || "-"]);
  }
  return out;
}

// --- カタログ読み込みプレースホルダ ---
// 将来的にセンターごとに catalogs ディレクトリやスプレッドシート範囲から取得。
// 現段階では空配列を返し、呼び出し側で dbg 出力に使用。
export interface CatalogItem {
  maker: string;
  productCode: string;
  name?: string;
  size?: string;
  [k: string]: unknown;
}

export async function loadProductCatalog(
  _centerId: string,
  _log?: (m: string) => void
): Promise<CatalogItem[]> {
  _log?.("[CATALOG] placeholder returning empty list");
  return [];
}

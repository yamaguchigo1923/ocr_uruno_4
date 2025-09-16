// センター設定読み込みユーティリティ
import fs from "fs/promises";
import path from "path";

export interface CenterConfig {
  id: string;
  displayName: string;
  templateSpreadsheetId: string;
  templateSheetId: number;
  exportStartRow: number;
  coverPages?: number;
  poll?: {
    startCol: string;
    endCol: string;
    readyColRelativeIndex: number;
    minReadyRatio: number;
    maxWaitSec: number;
  };
  headers?: {
    judgeCandidates: string[];
    fallbackChars: string;
    needColumns: string[]; // 指定列
  };
  ranges?: {
    catalog: string;
    export: { makerHeader: string; centerName: string; month: string };
  };
}

const cache = new Map<string, CenterConfig>();

export async function loadCenterConfig(
  centerId: string
): Promise<CenterConfig | null> {
  if (cache.has(centerId)) return cache.get(centerId)!;
  const cfgPath = path.join(
    process.cwd(),
    "src",
    "app",
    "config",
    "centers",
    `${centerId}.json`
  );
  try {
    const raw = await fs.readFile(cfgPath, "utf-8");
    const json: CenterConfig = JSON.parse(raw);
    cache.set(centerId, json);
    return json;
  } catch {
    return null;
  }
}

export async function getNeedColumns(
  centerId: string
): Promise<string[] | null> {
  const cfg = await loadCenterConfig(centerId);
  return cfg?.headers?.needColumns ?? null;
}

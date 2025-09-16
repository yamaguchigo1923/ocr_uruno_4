// C:\Users\yamag\project\ocr_uruno_4\src\app\components\centerInfo.tsx
import path from "path";
import { promises as fs } from "fs";

type CenterConfig = {
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
    needColumns: string[];
  };
  ranges?: {
    catalog: string;
    export: { makerHeader: string; centerName: string; month: string };
  };
};

async function loadCenterConfig(
  centerId: string
): Promise<CenterConfig | null> {
  const cfgPath = path.join(
    process.cwd(),
    "src",
    "app",
    "config",
    "centers",
    `${centerId}.json`
  );
  try {
    const json = await fs.readFile(cfgPath, "utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default async function CenterInfo({ centerId }: { centerId: string }) {
  const config = await loadCenterConfig(centerId);

  if (!config) {
    return (
      <div className="p-4 border rounded text-sm">
        センター設定が見つかりません: <code>{centerId}</code>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{config.displayName}</h1>
        <p className="text-xs text-slate-600 mt-1">centerId: {config.id}</p>
      </header>

      <div className="grid gap-2 text-sm">
        <div>
          テンプレートSS ID:{" "}
          <code className="px-1 py-0.5 bg-slate-100 rounded">
            {config.templateSpreadsheetId}
          </code>
        </div>
        <div>
          テンプレート SheetId:{" "}
          <code className="px-1 py-0.5 bg-slate-100 rounded">
            {config.templateSheetId}
          </code>
        </div>
        <div>
          出力開始行:{" "}
          <code className="px-1 py-0.5 bg-slate-100 rounded">
            {config.exportStartRow}
          </code>
        </div>
        <div>
          表紙ページ数:{" "}
          <code className="px-1 py-0.5 bg-slate-100 rounded">
            {config.coverPages ?? 0}
          </code>
        </div>
      </div>

      {config.poll && (
        <div className="text-xs text-slate-600">
          <div>
            ポーリング: {config.poll.startCol}:{config.poll.endCol} / idx=
            {config.poll.readyColRelativeIndex} / minReady=
            {config.poll.minReadyRatio} / maxWait={config.poll.maxWaitSec}s
          </div>
        </div>
      )}

      {config.headers && (
        <div className="text-xs text-slate-600">
          <div>
            判定候補: {config.headers.judgeCandidates.join(" / ")} / 必須列:
            {config.headers.needColumns.join(" / ")}
          </div>
        </div>
      )}
    </section>
  );
}

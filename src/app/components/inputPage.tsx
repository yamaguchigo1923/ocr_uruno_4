"use client";

// 統合入力/処理ページコンポーネント
// 要件:
//  1) 入力ファイル受付 (画像 / PDF / Excel任意)
//  2) センター選択 (既存 CenterSelect を利用 or 親ページでラップ)
//  3) ステップ1: OCR & 整理 (必要列抽出) -> 中間統合表表示
//  4) ステップ2: スプレッドシート出力 -> URL/ID表示
//  5) ログ / 進捗 / エラーハンドリング
//  6) 既存ファイル数を増やさず、API 呼び出しは src/api/ocr.ts / gensheet.ts に集約

import React, { useCallback, useRef, useState } from "react";
import { runStep1 } from "@/api/ocr";
import { runStep2 } from "@/api/gensheet";

// ---- 型定義 (UI / API 間インタフェース) ----
export type Step1FileMeta = { name: string; size: number; type: string };
export type Step1ResultRow = (string | number)[];
export type Step1Result = {
  headers: string[];
  rows: Step1ResultRow[];
  centerId: string;
  sourceFiles: Step1FileMeta[];
  // センター個別の補助情報 (任意)
  meta?: Record<string, unknown>;
};

export type Step2Result = {
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  exportedCount?: number;
  centerId: string;
};

// ---- ユーティリティ: テーブル表示 ----
function DataTable({ data }: { data: Step1Result | null }) {
  if (!data) return null;
  return (
    <div className="border rounded overflow-auto max-h-[480px] text-sm">
      <table className="min-w-full border-collapse">
        <thead className="sticky top-0 bg-slate-100 text-xs">
          <tr>
            {data.headers.map((h, i) => (
              <th key={i} className="px-2 py-1 border whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri} className="even:bg-slate-50">
              {data.headers.map((_, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 border whitespace-nowrap align-top"
                >
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- ログ表示 (出力は親で保持) ----
function LogPanel({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  return (
    <div
      className="border rounded p-2 h-56 overflow-auto bg-slate-50 text-xs"
      ref={ref}
    >
      {logs.map((l, i) => (
        <div key={i} className="font-mono whitespace-pre-wrap">
          {l}
        </div>
      ))}
      {!logs.length && <div className="text-slate-400">(ログなし)</div>}
    </div>
  );
}

// ---- メインコンポーネント ----
export default function InputPage({ centerId }: { centerId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [step1Result, setStep1Result] = useState<Step1Result | null>(null);
  const [step2Result, setStep2Result] = useState<Step2Result | null>(null);
  const [running1, setRunning1] = useState(false);
  const [running2, setRunning2] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // 共通ログ append
  const pushLog = useCallback((msg: string) => {
    setLogs((p) => [...p, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ---- File handlers ----
  function handleInputFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const arr = Array.from(e.target.files || []);
    if (arr.length) setFiles((prev) => [...prev, ...arr]);
    e.target.value = ""; // reset
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }
  function handleExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setExcelFile(f);
    e.target.value = "";
  }
  function clearAll() {
    setFiles([]);
    setExcelFile(null);
    setStep1Result(null);
    setStep2Result(null);
    setLogs([]);
    setError(null);
  }

  // ---- Step1 ----
  async function doStep1() {
    if (!files.length) {
      setError("OCR 対象ファイルがありません");
      return;
    }
    setRunning1(true);
    setError(null);
    setStep1Result(null);
    setStep2Result(null);
    pushLog(`STEP1 開始 (files=${files.length}, center=${centerId})`);
    try {
      const result = await runStep1({
        centerId,
        files,
        excelFile,
        onLog: (m) => pushLog(m),
      });
      setStep1Result(result);
      pushLog(`STEP1 完了 rows=${result.rows.length}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushLog(`STEP1 ERROR: ${msg}`);
    } finally {
      setRunning1(false);
    }
  }

  // ---- Step2 ----
  async function doStep2() {
    if (!step1Result) {
      setError("STEP1 結果がありません");
      return;
    }
    setRunning2(true);
    setError(null);
    pushLog("STEP2 開始 (スプレッドシート出力)");
    try {
      const res = await runStep2({
        centerId,
        step1Result,
        onLog: (m) => pushLog(m),
      });
      setStep2Result(res);
      pushLog(
        `STEP2 完了 spreadsheetId=${res.spreadsheetId || "-"} exported=${
          res.exportedCount ?? "?"
        }`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushLog(`STEP2 ERROR: ${msg}`);
    } finally {
      setRunning2(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">統合 OCR / 出力</h2>
        <p className="text-xs text-slate-500">
          ファイル受付 → OCR整形 → 表確認 → スプレッドシート出力
        </p>
      </header>

      {/* File Inputs */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4 p-4 border rounded">
          <h3 className="font-semibold text-sm">画像 / PDF ファイル</h3>
          <input
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleInputFiles}
            className="text-sm"
          />
          <div className="space-y-1 text-xs">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center justify-between border px-2 py-1 rounded"
              >
                <span className="truncate mr-2">{f.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-red-600 hover:underline"
                >
                  削除
                </button>
              </div>
            ))}
            {!files.length && <div className="text-slate-400">(未選択)</div>}
          </div>
          <div>
            <button
              disabled={running1 || !files.length}
              onClick={doStep1}
              className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              {running1 ? "実行中..." : "ステップ1 実行"}
            </button>
          </div>
        </div>
        <div className="space-y-4 p-4 border rounded">
          <h3 className="font-semibold text-sm">Excel (任意 / 参照)</h3>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcel}
            className="text-sm"
          />
          {excelFile && (
            <div className="text-xs text-slate-600">{excelFile.name}</div>
          )}
          <div className="text-xs text-slate-400">
            参照 Excel がある場合は関連付けて統合可能
          </div>
          <div>
            <button
              disabled={running2 || !step1Result}
              onClick={doStep2}
              className="px-4 py-2 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              {running2 ? "出力中..." : "ステップ2 出力"}
            </button>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={clearAll}
            className="px-3 py-1.5 rounded border text-xs hover:bg-slate-50"
          >
            クリア
          </button>
          {error && (
            <span className="text-red-600 font-medium text-xs">{error}</span>
          )}
        </div>

        <div className="space-y-6">
          <h4 className="font-semibold text-sm">STEP1 テーブル結果</h4>
          {!step1Result && (
            <div className="text-xs text-slate-400">未実行 / 結果なし</div>
          )}
          {step1Result && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600">
                  正規化/統合表
                </div>
                <DataTable data={step1Result} />
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600">
                    参照 Excel (先頭150行以内)
                  </div>
                  {(() => {
                    const ref = step1Result.meta?.refTable as
                      | (string | number)[][]
                      | undefined;
                    if (!ref || !ref.length)
                      return (
                        <div className="text-xs text-slate-400">(無し)</div>
                      );
                    const refHeaders = Array.isArray(ref[0])
                      ? (ref[0] as (string | number)[]).map((c) => String(c))
                      : [];
                    const refRows = ref.slice(1) as (string | number)[][];
                    const refResult: Step1Result = {
                      headers: refHeaders,
                      rows: refRows,
                      centerId: step1Result.centerId,
                      sourceFiles: [],
                    };
                    return <DataTable data={refResult} />;
                  })()}
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-600">
                    参照 + OCR 結合 (combined)
                  </div>
                  {(() => {
                    const combined = step1Result.meta?.combined as
                      | { headers: string[]; rows: (string | number)[][] }
                      | undefined;
                    if (!combined)
                      return (
                        <div className="text-xs text-slate-400">(無し)</div>
                      );
                    const combResult: Step1Result = {
                      headers: combined.headers,
                      rows: combined.rows,
                      centerId: step1Result.centerId,
                      sourceFiles: [],
                    };
                    return <DataTable data={combResult} />;
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <h4 className="font-semibold text-sm">STEP2 出力結果</h4>
          {step2Result ? (
            <div className="text-xs space-y-1">
              <div>
                出力件数: {step2Result.exportedCount ?? "-"} / center:{" "}
                {centerId}
              </div>
              {step2Result.spreadsheetUrl && (
                <div>
                  URL:{" "}
                  <a
                    className="text-blue-600 underline"
                    target="_blank"
                    rel="noreferrer"
                    href={step2Result.spreadsheetUrl}
                  >
                    {step2Result.spreadsheetUrl}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400">未出力</div>
          )}
        </div>
      </section>

      {/* Logs */}
      <section className="space-y-2">
        <h4 className="font-semibold text-sm">ログ</h4>
        <LogPanel logs={logs} />
      </section>
    </div>
  );
}

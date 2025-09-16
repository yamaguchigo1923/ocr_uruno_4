import { NextRequest } from "next/server";
import { loadCenterConfig } from "@/server/centers";
import { analyzeLayout } from "@/server/azure";
import {
  processBidTables,
  buildSelections,
  type TableMatrix,
} from "@/server/logic";

export const runtime = "nodejs"; // Google/Azure SDK 用 (edge不可)

function sseEncoder(ev: string, data: unknown) {
  return `data: ${JSON.stringify({ event: ev, data })}\n\n`;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const centerId = (form.get("centerId") || "default").toString();
  const sheet = (form.get("sheet") || "").toString();
  const files = form.getAll("file") as File[];
  const refFile = form.get("refSheetFile") as File | null;
  const cfg = await loadCenterConfig(centerId);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: string, d: unknown) =>
        controller.enqueue(new TextEncoder().encode(sseEncoder(e, d)));
      try {
        send("dbg", `[STEP1] start center=${centerId} sheet=${sheet}`);
        send(
          "dbg",
          `[STEP1] files=${files.length} ref=${refFile ? refFile.name : "none"}`
        );
        if (!cfg) {
          send("dbg", `[WARN] center config not found: ${centerId}`);
        } else {
          send(
            "dbg",
            `[CFG] needColumns=${cfg.headers?.needColumns?.join(",") || ""}`
          );
        }

        // (1) 参照ファイルパース (Excel / CSV)
        let refTable: TableMatrix = [];
        if (refFile) {
          send("dbg", `[REF] parse ${refFile.name}`);
          try {
            const buf = Buffer.from(await refFile.arrayBuffer());
            if (/\.xlsx?$/i.test(refFile.name)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let XLSX: any;
              try {
                XLSX = await import("xlsx");
              } catch {
                send("error", {
                  stage: "ref_parse",
                  code: "MODULE_NOT_FOUND",
                  message: "xlsx モジュールがインストールされていません",
                });
                throw new Error("xlsx module missing");
              }
              const wb = XLSX.read(buf, { type: "buffer" });
              const sh = wb.Sheets[wb.SheetNames[0]];
              const arr = XLSX.utils.sheet_to_json(sh, {
                header: 1,
                raw: true,
              }) as unknown[];
              if (Array.isArray(arr) && arr.length) {
                const parsed = arr.map((row) =>
                  Array.isArray(row)
                    ? row.map((c: unknown) => (c ?? "").toString())
                    : []
                );
                // 先頭列 (index 0) が空白の行をヘッダ以外で除外し詰める
                if (parsed.length) {
                  const header = parsed[0];
                  const body = parsed.slice(1).filter((r) => {
                    if (!r || !r.length) return false; // 完全空行も除外
                    const first = (r[0] ?? "").toString().trim();
                    return first.length > 0; // 先頭セル非空のみ採用
                  });
                  refTable = [header, ...body];
                } else {
                  refTable = [];
                }
              }
            } else if (/\.csv$/i.test(refFile.name)) {
              const txt = buf.toString("utf-8");
              refTable = txt
                .split(/\r?\n/)
                .filter((l) => l.trim().length)
                .map((l) => l.split(",").map((c) => c.trim()));
            }
          } catch (e) {
            send("dbg", `[REF][ERROR] ${e}`);
          }
          send("ref_table", refTable.slice(0, 150));
        }

        // (2) OCR: 各ファイルを Azure layout 解析 (テーブル一つめのみ簡易抽出)
        const ocrMatrix: TableMatrix = [];
        const headerSeen = new Set<string>();
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          send("dbg", `[OCR] analyze ${f.name}`);
          try {
            const ab = await f.arrayBuffer();
            const doc = await analyzeLayout(ab);
            const tables = doc?.tables || [];
            if (tables.length) {
              const t = tables[0];
              const rows: string[][] = [];
              const h: string[] = [];
              // build header from first row cells rowIndex===0
              interface CellLike {
                rowIndex?: number;
                columnIndex?: number;
                content?: string;
              }
              t.cells?.forEach((cell: CellLike) => {
                if (
                  typeof cell.rowIndex !== "number" ||
                  typeof cell.columnIndex !== "number"
                )
                  return;
                const txt = (cell.content || "").trim();
                if (cell.rowIndex === 0) {
                  h[cell.columnIndex] = txt;
                } else {
                  rows[cell.rowIndex - 1] = rows[cell.rowIndex - 1] || [];
                  rows[cell.rowIndex - 1][cell.columnIndex] = txt;
                }
              });
              const hJoined = h.join("|");
              if (!headerSeen.has(hJoined)) {
                ocrMatrix.push(h.map((x) => x || ""));
                headerSeen.add(hJoined);
              }
              rows.forEach((r) =>
                ocrMatrix.push((r || []).map((x) => x || ""))
              );
            } else {
              // fallback: file name only
              if (!ocrMatrix.length) ocrMatrix.push(["ファイル"]);
              ocrMatrix.push([f.name]);
            }
          } catch (e) {
            const msg = String(e);
            if (msg.includes("@azure/ai-form-recognizer module not found")) {
              send("error", {
                stage: "ocr",
                code: "MODULE_NOT_FOUND",
                message: "Azure OCR モジュールが未インストールです",
                detail: msg,
              });
              // 以降のファイルも同様なので break
              break;
            } else if (msg.includes("AZURE_ENDPOINT / AZURE_KEY not set")) {
              send("error", {
                stage: "ocr",
                code: "MISSING_CREDENTIALS",
                message:
                  "Azure 資格情報が設定されていません (.env.local を確認)",
                detail: msg,
              });
              break;
            } else {
              send("error", {
                stage: "ocr",
                code: "OCR_FAILURE",
                message: "OCR 処理に失敗しました",
                detail: msg,
              });
              send("dbg", `[OCR][ERROR] ${msg}`);
            }
          }
        }
        if (!ocrMatrix.length) {
          ocrMatrix.push(["ファイル"]);
          files.forEach((f) => ocrMatrix.push([f.name]));
        }
        let processed = ocrMatrix;
        if (sheet === "入札書") {
          processed = processBidTables(ocrMatrix as TableMatrix);
        }
        send("ocr_table", processed.slice(0, 300));

        // (2.5) needColumns による正規化 (センター設定があれば)
        const needCols = cfg?.headers?.needColumns;
        // 正規化結果を後続 (combined_table) でも利用するため一時退避
        let normalizedHeaders: string[] | null = null;
        let normalizedRows: string[][] | null = null;
        if (needCols && needCols.length && processed.length) {
          const headerRow = processed[0];
          // ヘッダ名 -> index マップ (重複は最初採用)
          const idxMap: Record<string, number> = {};
          headerRow.forEach((h, i) => {
            if (typeof h === "string" && !(h in idxMap)) idxMap[h.trim()] = i;
          });
          normalizedHeaders = needCols.slice();
          normalizedRows = [];
          for (let r = 1; r < processed.length; r++) {
            const row = processed[r];
            const out: string[] = [];
            for (const col of needCols) {
              const idx = idxMap[col];
              out.push(idx !== undefined ? (row[idx] ?? "").toString() : "");
            }
            // すべて空ならスキップ (不要行除外)
            if (out.some((v) => v && v.trim().length)) normalizedRows.push(out);
          }
          send("normalized_table", {
            headers: normalizedHeaders,
            rows: normalizedRows.slice(0, 500),
          });
          send(
            "dbg",
            `[NORMALIZE] generated cols=${normalizedHeaders.length} rows=${normalizedRows.length}`
          );
        }

        // (2.6) 参照 Excel と OCR(正規化) の結合 (legacy ロジック簡略版)
        // 方針: refTable が存在する場合
        //   1. ベース: refTable のヘッダ (refHeader)
        //   2. 追加: normalized_table (あれば) の列で refHeader に無いものを末尾追加
        //      - 重複ヘッダは "<name>_OCR" サフィックスで追加 (意図的に見分けやすく)
        //   3. 行単位: index で単純整列 (不足セルは空文字), 行数差異は長い側を折り畳み
        try {
          if (refTable.length) {
            const refHeader = (refTable[0] || []).map((c) =>
              (c ?? "").toString()
            );
            const baseRows = refTable
              .slice(1)
              .map((r) =>
                Array.isArray(r) ? r.map((c) => (c ?? "").toString()) : []
              );
            const srcHeaders =
              normalizedHeaders ||
              (processed.length
                ? (processed[0] as string[]).map((c) => (c ?? "").toString())
                : []);
            const srcRows =
              normalizedRows || (processed.slice(1) as string[][]);
            const existing = new Set(refHeader);
            const appendHeaders: string[] = [];
            srcHeaders.forEach((h) => {
              if (!h) return;
              if (existing.has(h)) {
                const alt = `${h}_OCR`;
                appendHeaders.push(alt);
                existing.add(alt);
              } else {
                appendHeaders.push(h);
                existing.add(h);
              }
            });
            const combinedHeaders = refHeader.concat(appendHeaders);
            const rowCount = Math.max(baseRows.length, srcRows.length);
            const combinedRows: string[][] = [];
            for (let i = 0; i < rowCount; i++) {
              const left = baseRows[i] ? [...baseRows[i]] : [];
              // pad left to refHeader length
              if (left.length < refHeader.length) {
                left.length = refHeader.length;
              }
              const rightSrc = srcRows[i] ? [...srcRows[i]] : [];
              // rightSrc を srcHeaders 長さに揃える
              if (rightSrc.length < srcHeaders.length)
                rightSrc.length = srcHeaders.length;
              // rightSrc を appendHeaders 順にマッピング (重複時 _OCR を使うため単純転写)
              const rightOut: string[] = [];
              for (let s = 0; s < srcHeaders.length; s++) {
                const val = rightSrc[s] ?? "";
                rightOut.push(val);
              }
              combinedRows.push(left.concat(rightOut));
            }
            send("combined_table", {
              headers: combinedHeaders,
              rows: combinedRows.slice(0, 500),
            });
            send(
              "dbg",
              `[COMBINED] refCols=${refHeader.length} addCols=${appendHeaders.length} rows=${combinedRows.length}`
            );
          }
        } catch (e) {
          send("dbg", `[COMBINED][ERROR] ${e}`);
        }

        // (3) selections 抽出 (簡易)
        const selections = buildSelections(processed);
        send("selections", selections.slice(0, 50));

        // (4) maker_data / maker_cds モック組立（今後: selections に基づきカタログ参照）
        const makerKey = "MOCKメーカー";
        const maker_cds: Record<string, string[]> = {
          [makerKey]: selections.map(
            (_, i) => `CD${(i + 1).toString().padStart(3, "0")}`
          ),
        };
        const maker_data: Record<string, string[][]> = {
          [makerKey]: selections.map((s) => [makerKey, s[1], "規格X", ""]),
        };
        const flags = selections.map((s, i) => [
          makerKey,
          maker_cds[makerKey][i],
          s[2],
          s[3],
        ]);

        send("calculation_complete", {
          maker_data,
          maker_cds,
          flags,
          center_name: cfg?.displayName || "",
          center_month: "",
        });
        send("dbg", "[STEP1] done");
      } catch (e) {
        const msg = String(e);
        send("error", {
          stage: "fatal",
          code: "FATAL",
          message: "STEP1 で致命的エラー",
          detail: msg,
        });
        send("dbg", `[FATAL] ${msg}`);
      } finally {
        send("done", "ステップ1完了");
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

import { NextRequest } from "next/server";
import { getSheetsClient, getDriveClient, withBackoff } from "@/server/google";
import { loadCenterConfig } from "@/server/centers";

export const runtime = "nodejs";

function sse(ev: string, data: unknown) {
  return `data: ${JSON.stringify({ event: ev, data })}\n\n`;
}

// ヘッダからメーカー列を推定
function detectMakerColumn(headers: string[]): number {
  const patterns = [/メーカー/, /ﾒｰｶｰ/, /メーカー名/];
  for (let i = 0; i < headers.length; i++) {
    const norm = (headers[i] || "").toString().replace(/[\s　]/g, "");
    if (patterns.some((p) => p.test(norm))) return i;
  }
  return -1;
}

// シート名サニタイズ
function sanitizeSheetTitle(t: string): string {
  let v = (t || "")
    .slice(0, 90)
    .replace(/[\\/?*\[\]]/g, " ")
    .trim();
  if (!v) v = "(空)";
  return v;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const centerId: string = body.centerId || "default";
  const headers: string[] = body.headers || [];
  const rows: (string | number)[][] = body.rows || [];
  const cfg = await loadCenterConfig(centerId);
  const makerColIdx = detectMakerColumn(headers);

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: string, d: unknown) =>
        controller.enqueue(enc.encode(sse(e, d)));
      (async () => {
        try {
          send("dbg", `[STEP2] start center=${centerId} rows=${rows.length}`);
          send("dbg", `[STEP2] makerColIdx=${makerColIdx}`);
          const sheets = getSheetsClient();
          const drive = getDriveClient();

          // --- 作成戦略 ---
          const templateSpreadsheetId = process.env.TEMPLATE_SPREADSHEET_ID;
          const forceDrive = process.env.FORCE_DRIVE_SPREADSHEET_CREATE === "1";
          const title = `${cfg?.displayName || centerId}-出力-${new Date()
            .toISOString()
            .slice(0, 10)}`;
          let spreadsheetId: string | undefined;

          if (templateSpreadsheetId) {
            send("progress", { stage: "copy_template" });
            try {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore any (drive copy)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const copyRes: any = await withBackoff(
                () =>
                  drive.files.copy({
                    fileId: templateSpreadsheetId,
                    requestBody: {
                      name: title,
                      parents: process.env.DRIVE_FOLDER_ID
                        ? [process.env.DRIVE_FOLDER_ID]
                        : undefined,
                    },
                    supportsAllDrives: true,
                    fields: "id",
                  }),
                "drive.files.copy",
                { log: (m) => send("dbg", m) }
              );
              spreadsheetId = copyRes?.data?.id;
              send("dbg", `[STEP2] template copied id=${spreadsheetId}`);
            } catch (e) {
              send("dbg", `[TEMPLATE][ERROR] copy failed ${e}`);
            }
          }

          if (!spreadsheetId && !forceDrive) {
            send("progress", { stage: "sheets_create" });
            try {
              const created = await withBackoff(
                () =>
                  sheets.spreadsheets.create({
                    requestBody: {
                      properties: { title },
                      sheets: [
                        {
                          properties: { title: "OCR出力" },
                        },
                      ],
                    },
                  }),
                "sheets.create",
                { log: (m) => send("dbg", m) }
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              spreadsheetId = (created as any).data.spreadsheetId as string;
            } catch (e) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const me: any = e;
              const status = me?.response?.status || me?.code;
              send(
                "dbg",
                `[STEP2] sheets.create failed status=${status} will fallback drive`
              );
              if (Number(status) !== 403) {
                // 403 以外の失敗はそのまま扱い (最終 drive へ)
              }
            }
          }

          if (!spreadsheetId) {
            send("progress", {
              stage: forceDrive ? "drive_create(force)" : "drive_create",
            });
            try {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore any before types
              const fileRes = await drive.files.create({
                requestBody: {
                  name: title,
                  mimeType: "application/vnd.google-apps.spreadsheet",
                  parents: process.env.DRIVE_FOLDER_ID
                    ? [process.env.DRIVE_FOLDER_ID]
                    : undefined,
                },
                supportsAllDrives: true,
                fields: "id",
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              spreadsheetId = (fileRes as any).data.id as string;
              send("dbg", `[STEP2] drive.files.create id=${spreadsheetId}`);
              // rename 初期シート
              try {
                await withBackoff(
                  () =>
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore any
                    sheets.spreadsheets.batchUpdate({
                      spreadsheetId,
                      requestBody: {
                        requests: [
                          {
                            updateSheetProperties: {
                              properties: { sheetId: 0, title: "OCR出力" },
                              fields: "title",
                            },
                          },
                        ],
                      },
                    }),
                  "sheets.batchUpdate.rename",
                  { log: (m) => send("dbg", m) }
                );
              } catch (re) {
                send("dbg", `[WARN] rename initial sheet failed ${re}`);
              }
            } catch (fe) {
              send("dbg", `[FALLBACK-FAIL] drive.files.create ${fe}`);
              throw fe;
            }
          }

          if (!spreadsheetId) throw new Error("create spreadsheet failed");
          send("dbg", `[STEP2] spreadsheet created id=${spreadsheetId}`);

          // (2) フォルダ移動 (コピー時点で親指定していない場合のみ)
          const folderId = process.env.DRIVE_FOLDER_ID;
          if (folderId && !templateSpreadsheetId) {
            try {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore any
              await withBackoff(
                () =>
                  drive.files.update({
                    fileId: spreadsheetId,
                    addParents: folderId,
                    supportsAllDrives: true,
                  }),
                "drive.move",
                { log: (m) => send("dbg", m) }
              );
              send("dbg", `[STEP2] moved to folder ${folderId}`);
            } catch (e) {
              send("dbg", `[WARN] move folder failed ${e}`);
            }
          }

          // (3) ヘッダ + データ書き込み (テンプレに既存シートがあれば 'OCR出力' を利用 / 無い場合既定シート)
          const baseSheetTitle = "OCR出力";
          send("progress", { stage: "write_headers" });
          if (headers.length) {
            await withBackoff(
              () =>
                sheets.spreadsheets.values.update({
                  spreadsheetId,
                  range: `${baseSheetTitle}!A1:${String.fromCharCode(
                    65 + headers.length - 1
                  )}1`,
                  valueInputOption: "RAW",
                  requestBody: { values: [headers] },
                }),
              "values.update.headers",
              { log: (m) => send("dbg", m) }
            );
          }
          send("progress", { stage: "write_rows" });
          if (rows.length) {
            await withBackoff(
              () =>
                sheets.spreadsheets.values.update({
                  spreadsheetId,
                  range: `${baseSheetTitle}!A2`,
                  valueInputOption: "RAW",
                  requestBody: { values: rows },
                }),
              "values.update.rows",
              { log: (m) => send("dbg", m) }
            );
          }

          // (4) メーカー別シート
          try {
            if (headers.length && rows.length && makerColIdx >= 0) {
              send("progress", { stage: "group_rows" });
              const groups = new Map<string, (string | number)[][]>();
              for (const r of rows) {
                const mk = (r[makerColIdx] ?? "").toString().trim() || "(空)";
                if (!groups.has(mk)) groups.set(mk, []);
                groups.get(mk)!.push(r);
              }
              // addSheet リクエスト作成
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const addRequests: any[] = [];
              groups.forEach((_rows, mk) => {
                const title = sanitizeSheetTitle(mk);
                addRequests.push({ addSheet: { properties: { title } } });
              });
              if (addRequests.length) {
                await withBackoff(
                  () =>
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore any
                    sheets.spreadsheets.batchUpdate({
                      spreadsheetId,
                      requestBody: { requests: addRequests },
                    }),
                  "sheets.batchUpdate.addSheet",
                  { log: (m) => send("dbg", m) }
                );
              }
              for (const [mk, gRows] of groups.entries()) {
                const title = sanitizeSheetTitle(mk);
                send("progress", { stage: `maker_sheet:${title}` });
                if (headers.length) {
                  await withBackoff(
                    () =>
                      sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `${title}!A1:${String.fromCharCode(
                          65 + headers.length - 1
                        )}1`,
                        valueInputOption: "RAW",
                        requestBody: { values: [headers] },
                      }),
                    "values.update.maker.headers",
                    { log: (m) => send("dbg", m) }
                  );
                }
                if (gRows.length) {
                  await withBackoff(
                    () =>
                      sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `${title}!A2`,
                        valueInputOption: "RAW",
                        requestBody: { values: gRows },
                      }),
                    "values.update.maker.rows",
                    { log: (m) => send("dbg", m) }
                  );
                }
              }
              send("dbg", `[STEP2] maker sheets created count=${groups.size}`);
            } else {
              send(
                "dbg",
                `[STEP2] maker grouping skipped makerColIdx=${makerColIdx}`
              );
            }
          } catch (e) {
            send("dbg", `[WARN] maker sheet generation failed ${e}`);
          }

          send("progress", { stage: "finalize" });
          send(
            "dbg",
            `[STEP2] values written headers=${headers.length} rows=${rows.length}`
          );
          send("final_url", {
            name: title,
            url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          });
          send("dbg", "[STEP2] done");
        } catch (e) {
          interface MaybeErr {
            message?: string;
            code?: string | number;
            response?: { status?: number; data?: unknown };
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const me: MaybeErr = e as any;
          const status = (me.response?.status || me.code) as
            | number
            | string
            | undefined;
          const msg = me.message || String(e);
          let category = "unknown";
          const suggestions: string[] = [];
          if (status === 401) {
            category = "unauthenticated";
            suggestions.push(
              "SERVICE_ACCOUNT / PRIVATE_KEY 読み込み確認 (.env 再起動)",
              "秘密鍵改行が \\n でエスケープされているか",
              "サービスアカウント鍵が削除されていないか"
            );
          } else if (Number(status) === 403) {
            category = "forbidden";
            suggestions.push(
              "Sheets / Drive API 有効化",
              "DRIVE_FOLDER_ID の共有設定 (閲覧以上)",
              "共有ドライブならメンバー追加",
              "一旦 DRIVE_FOLDER_ID 外して動作確認",
              "組織ポリシー(外部共有禁止等)確認"
            );
          } else {
            suggestions.push(
              "再実行 (一時的エラー)",
              "API クォータ状況確認",
              "サーバーログで詳細スタック確認"
            );
          }
          send("error", {
            step: "step2",
            message: msg,
            status,
            category,
            suggestions,
          });
          send("dbg", `[FATAL][STEP2] status=${status} ${msg}`);
        } finally {
          send("done", "ステップ2完了");
          controller.close();
        }
      })();
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

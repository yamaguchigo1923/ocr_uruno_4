import { NextRequest } from "next/server";
import { getSheetsClient, getDriveClient, withBackoff } from "@/server/google";
import { loadCenterConfig } from "@/server/centers";

export const runtime = "nodejs";

function sse(ev: string, data: unknown) {
  return `data: ${JSON.stringify({ event: ev, data })}\n\n`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const centerId: string = body.centerId || "default";
  const headers: string[] = body.headers || [];
  const rows: (string | number)[][] = body.rows || [];
  // meta など将来利用
  const cfg = await loadCenterConfig(centerId);
  // メーカー列推定: ヘッダに 'メーカー' を含む列 or 0番目
  const makerColIdx = headers.findIndex((h) => /メーカー/.test(h)) ?? -1;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: string, d: unknown) =>
        controller.enqueue(enc.encode(sse(e, d)));
      (async () => {
        try {
          send("dbg", `[STEP2] start center=${centerId} rows=${rows.length}`);
          const sheets = getSheetsClient();
          const drive = getDriveClient();
          // (1) 新規 Spreadsheet 作成 (テンプレ複製は後続タスク)
          send("progress", { stage: "create_spreadsheet" });
          const title = `${cfg?.displayName || centerId}-出力-${new Date()
            .toISOString()
            .slice(0, 10)}`;
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
          const spreadsheetId = (created as any).data.spreadsheetId as
            | string
            | undefined;
          if (!spreadsheetId) throw new Error("create spreadsheet failed");
          send("dbg", `[STEP2] spreadsheet created id=${spreadsheetId}`);
          // (2) フォルダ移動 (親フォルダ指定) - 任意
          const folderId = process.env.DRIVE_FOLDER_ID;
          if (folderId) {
            try {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore googleapis 型詳細導入前の暫定 any
              await withBackoff(
                () =>
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore 型補完前暫定
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
          // (3) ヘッダ + データ書き込み (後続タスクで詳細)
          send("progress", { stage: "write_headers" });
          if (headers.length) {
            await withBackoff(
              () =>
                sheets.spreadsheets.values.update({
                  spreadsheetId,
                  range: `OCR出力!A1:${String.fromCharCode(
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
                  range: `OCR出力!A2`,
                  valueInputOption: "RAW",
                  requestBody: { values: rows },
                }),
              "values.update.rows",
              { log: (m) => send("dbg", m) }
            );
          }

          // (4) メーカー別シート生成 (簡易グルーピング)
          try {
            if (headers.length && rows.length && makerColIdx >= 0) {
              send("progress", { stage: "group_rows" });
              const groups = new Map<string, (string | number)[][]>();
              for (const r of rows) {
                const mk = (r[makerColIdx] ?? "").toString().trim() || "(空)";
                if (!groups.has(mk)) groups.set(mk, []);
                groups.get(mk)!.push(r);
              }
              // 既定シートの次に maker シートを append (batchUpdate)
              // googleapis 型簡略化のため any キャスト
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const requests: any[] = [];
              groups.forEach((_rows, mk) => {
                const title = mk.length > 90 ? mk.slice(0, 90) : mk;
                requests.push({
                  addSheet: { properties: { title } },
                });
              });
              if (requests.length) {
                await withBackoff(
                  () =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (sheets.spreadsheets.batchUpdate as any)({
                      spreadsheetId,
                      requestBody: { requests },
                    }),
                  "sheets.batchUpdate.addSheet",
                  { log: (m) => send("dbg", m) }
                );
              }
              // 各シートにヘッダ + 行書き込み
              for (const [mk, mRows] of groups.entries()) {
                const title = mk.length > 90 ? mk.slice(0, 90) : mk;
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
                if (mRows.length) {
                  await withBackoff(
                    () =>
                      sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `${title}!A2`,
                        valueInputOption: "RAW",
                        requestBody: { values: mRows },
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
          const finalUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
          send("final_url", { name: title, url: finalUrl });
          send("dbg", "[STEP2] done");
        } catch (e) {
          send("dbg", `[FATAL][STEP2] ${e}`);
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

// Health check endpoint: Google Sheets/Drive 権限診断
import { getSheetsClient, getDriveClient } from "@/server/google";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const result: Record<string, unknown> = {
    ok: true,
    started,
    steps: [] as unknown[],
  };
  function push(step: string, data: unknown, ok = true) {
    (result.steps as unknown[]).push({ step, ok, data });
    if (!ok) result.ok = false;
  }
  try {
    // 1. Auth 情報 (サービスアカウントメール) の確認
    const svcEmail =
      process.env.SERVICE_ACCOUNT || process.env.SERVICE_ACCOUNT_EMAIL;
    push("env.service_account", { email: svcEmail || null });

    // 2. Sheets / Drive クライアント初期化
    const sheets = getSheetsClient();
    const drive = getDriveClient();
    push("client.init", { sheets: !!sheets, drive: !!drive });

    // 3. Drive about (権限 / scope 確認)
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore any で取得 (型導入前)
      const about = await drive.about.get({ fields: "user,storageQuota" });
      push("drive.about", {
        user: about.data.user,
        quota: about.data.storageQuota,
      });
    } catch (e) {
      push("drive.about", { error: String(e) }, false);
    }

    // 4. 指定フォルダへのアクセス (DRIVE_FOLDER_ID) - list children 試行
    const folderId = process.env.DRIVE_FOLDER_ID;
    if (folderId) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore any
        const qRes = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          pageSize: 1,
          fields: "files(id,name)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        push("drive.folder.list", { folderId, sample: qRes.data.files });
      } catch (e) {
        push("drive.folder.list", { folderId, error: String(e) }, false);
      }
    } else {
      push("drive.folder.list", { skipped: true });
    }

    // 5. 一時スプレッドシート作成テスト (作成後すぐ削除)
    let tempId: string | undefined;
    // sheets.spreadsheets.create の生エラー保持
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sheetsCreateErr: any = null;
    try {
      const title = `health-check-${new Date().toISOString().slice(0, 19)}`;
      const created = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets: [{ properties: { title: "HC" } }],
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tempId = (created as any).data.spreadsheetId;
      push("sheets.create", { spreadsheetId: tempId, title });
    } catch (e) {
      sheetsCreateErr = e;
      // エラー詳細抽出
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const me: any = e;
      const status = me?.response?.status || me?.code;
      const reason = me?.response?.data?.error?.errors?.[0]?.reason;
      push("sheets.create", { error: String(e), status, reason }, false);
    }

    // 6. drive.files.create フォールバック (sheets.create が 403 の場合)
    let fallbackId: string | undefined;
    if (sheetsCreateErr) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const me: any = sheetsCreateErr;
      const status = Number(me?.response?.status || me?.code);
      if (status === 403) {
        try {
          const title = `health-fallback-${new Date()
            .toISOString()
            .slice(0, 19)}`;
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore any
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
          fallbackId = (fileRes as any).data.id;
          push("drive.files.create.spreadsheet", {
            spreadsheetId: fallbackId,
            title,
          });
        } catch (fe) {
          push("drive.files.create.spreadsheet", { error: String(fe) }, false);
        }
      } else {
        push("drive.files.create.spreadsheet", { skipped: true, status });
      }
    } else {
      push("drive.files.create.spreadsheet", {
        skipped: true,
        reason: "sheets.create succeeded",
      });
    }

    // 7. 既存スプレッドシート読み取りテスト (OCR_RESULT_SHEET_ID) があれば
    const existingId = process.env.OCR_RESULT_SHEET_ID;
    if (existingId) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore any
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: existingId,
        });
        push("sheets.get.existing", {
          spreadsheetId: existingId,
          title: meta.data.properties?.title,
        });
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const me: any = e;
        const status = me?.response?.status || me?.code;
        push(
          "sheets.get.existing",
          { spreadsheetId: existingId, error: String(e), status },
          false
        );
      }
    } else {
      push("sheets.get.existing", { skipped: true });
    }

    // 8. 削除 (tempId / fallbackId)
    for (const id of [tempId, fallbackId]) {
      if (!id) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore any
        await drive.files.delete({ fileId: id, supportsAllDrives: true });
        push("drive.delete", { spreadsheetId: id });
      } catch (e) {
        push("drive.delete", { spreadsheetId: id, error: String(e) }, false);
      }
    }

    // 9. 分析サマリ (suggestions)
    const suggestions: string[] = [];
    interface StepEntry {
      step: string;
      ok: boolean;
      data: unknown;
    }
    const stepsArr = result.steps as StepEntry[];
    const sheetsCreateStep = stepsArr.find((s) => s.step === "sheets.create");
    const driveCreateStep = stepsArr.find(
      (s) => s.step === "drive.files.create.spreadsheet"
    );
    if (sheetsCreateStep && !sheetsCreateStep.ok) {
      const scData = sheetsCreateStep.data as
        | Record<string, unknown>
        | undefined;
      const status = scData?.status as number | string | undefined;
      if (status === 403) {
        if (driveCreateStep && driveCreateStep.ok) {
          suggestions.push(
            "sheets.create(新規作成API) のみ 403: Sheets API の有効化漏れ / ドメイン制限 (管理コンソール) を確認",
            "Google Cloud Console -> APIとサービス -> ライブラリ で 'Google Sheets API' が有効化されているか",
            "組織/Workspace の外部共有やアプリ制限ポリシー (context aware access) が無いか"
          );
        } else if (driveCreateStep && !driveCreateStep.ok) {
          suggestions.push(
            "Drive でも作成 403: 共有ドライブ/フォルダに対しサービスアカウントの権限が '閲覧者' など低すぎる",
            "共有ドライブならサービスアカウントを 'コンテンツ管理者' 以上で追加",
            "個人のマイドライブ配下フォルダならそのフォルダをサービスアカウントメールで共有 (編集権限)"
          );
        }
      }
    }
    if (!suggestions.length)
      suggestions.push("問題が続く場合: health 出力を共有してさらに分析");
    result.suggestions = suggestions;

    // 6. 削除 (権限により失敗する場合もあり、その場合は警告)
    if (tempId) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore any
        await drive.files.delete({ fileId: tempId, supportsAllDrives: true });
        push("drive.delete", { spreadsheetId: tempId });
      } catch (e) {
        push(
          "drive.delete",
          { spreadsheetId: tempId, error: String(e) },
          false
        );
      }
    }

    result.durationMs = Date.now() - started;
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify(
        { ok: false, fatal: String(e), durationMs: Date.now() - started },
        null,
        2
      ),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

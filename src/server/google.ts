// Google + Sheets/Drive クライアント初期化ユーティリティ (雛形)
// 最低限: サービスアカウント JSON(Base64) から認証を生成し googleapis を初期化。
// 型はパッケージ導入後に補完される想定。現段階では疎結合に。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { google, sheets_v4, drive_v3 } from "googleapis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedAuth: any; // GoogleAuth インスタンスキャッシュ
let cachedSheets: sheets_v4.Sheets | null = null;
let cachedDrive: drive_v3.Drive | null = null;

function buildAuth() {
  if (cachedAuth) return cachedAuth;
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ];
  const b64 = process.env.SERVICE_ACCOUNT_JSON_B64;
  let creds: Record<string, unknown> | null = null;
  if (b64) {
    try {
      const jsonStr = Buffer.from(b64, "base64").toString("utf-8");
      creds = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Invalid SERVICE_ACCOUNT_JSON_B64: ${e}`);
    }
  } else {
    // フォールバック: SERVICE_ACCOUNT (メール) と SERVICE_ACCOUNT_PRIVATE_KEY を利用
    const email =
      process.env.SERVICE_ACCOUNT || process.env.SERVICE_ACCOUNT_EMAIL;
    const pk = process.env.SERVICE_ACCOUNT_PRIVATE_KEY;
    if (email && pk) {
      creds = {
        type: "service_account",
        client_email: email,
        private_key: pk.replace(/\\n/g, "\n"),
        token_uri: "https://oauth2.googleapis.com/token",
      };
    } else {
      throw new Error(
        "SERVICE_ACCOUNT_JSON_B64 not set and fallback SERVICE_ACCOUNT / SERVICE_ACCOUNT_PRIVATE_KEY not provided"
      );
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = new google.auth.GoogleAuth({
    credentials: creds as any,
    scopes,
  });
  cachedAuth = auth;
  return auth;
}

export function getSheetsClient() {
  if (cachedSheets) return cachedSheets;
  const auth = buildAuth();
  cachedSheets = google.sheets({ version: "v4", auth });
  return cachedSheets;
}

export function getDriveClient() {
  if (cachedDrive) return cachedDrive;
  const auth = buildAuth();
  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

// 汎用バックオフ（HTTP ステータスに応じた再試行）
export async function withBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  opt?: {
    retries?: number;
    baseDelayMs?: number;
    retryStatus?: number[];
    log?: (m: string) => void;
  }
) {
  const retries = opt?.retries ?? 6;
  const base = opt?.baseDelayMs ?? 600;
  const retryStatus = new Set(
    opt?.retryStatus ?? [408, 429, 500, 502, 503, 504]
  );
  let delay = base;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fn();
      opt?.log?.(`[OK][${label}] try=${i}`);
      return res;
    } catch (e: unknown) {
      interface MaybeErr {
        code?: number | string;
        response?: { status?: number };
      }
      const me = e as MaybeErr;
      const status = me?.code || me?.response?.status;
      if (i < retries - 1 && retryStatus.has(Number(status))) {
        opt?.log?.(
          `[RETRY][${label}] status=${status} sleep=${Math.round(delay)}ms`
        );
        await new Promise((r) =>
          setTimeout(r, delay + Math.random() * delay * 0.3)
        );
        delay = Math.min(delay * 2, 30_000);
        continue;
      }
      opt?.log?.(`[ERROR][${label}] ${status || ""} ${e}`);
      throw e;
    }
  }
  throw new Error(`[${label}] retries exceeded`);
}

// Azure Document Intelligence (Form Recognizer) クライアントユーティリティ
// 動的ロード: ビルド時に依存が解決できない場合でも実行時エラーへ遅延させる
// 型は開発時に有効。実行時は require で評価。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FormRecMod: any | null = null;
async function ensureModule() {
  if (FormRecMod) return FormRecMod;
  try {
    // 動的 import (eval でバンドラの静的解析回避: 依存未インストール時の即死防止)
    const importer = new Function(
      'return import("@azure/ai-form-recognizer").catch(()=>null)'
    );
    FormRecMod = await importer();
    if (!FormRecMod) {
      throw new Error();
    }
    return FormRecMod;
  } catch {
    throw new Error(
      "@azure/ai-form-recognizer module not found or failed dynamic import. Run: npm install @azure/ai-form-recognizer"
    );
  }
}

// 型パッケージ未ロード時も動作するため any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: any | null = null;

export async function getDocClient() {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.AZURE_ENDPOINT;
  const key = process.env.AZURE_KEY;
  if (!endpoint || !key) throw new Error("AZURE_ENDPOINT / AZURE_KEY not set");
  const mod = await ensureModule();
  const { DocumentAnalysisClient, AzureKeyCredential } = mod;
  cachedClient = new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(key)
  );
  return cachedClient;
}

// 単一ファイルバッファを prebuilt-layout で解析（例外時は再試行呼び出し側）
export async function analyzeLayout(buffer: ArrayBuffer) {
  const client = await getDocClient();
  try {
    const poller = await client.beginAnalyzeDocument("prebuilt-layout", buffer);
    return await poller.pollUntilDone();
  } catch (e) {
    // 明示的なエラーラップ
    throw new Error(`[AZURE_OCR_ERROR] ${(e as Error).message}`);
  }
}

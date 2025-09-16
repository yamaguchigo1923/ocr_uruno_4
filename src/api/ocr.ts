// STEP1: OCR & 整理 API 呼び出しラッパ
// Next.js Route Handler をここで直接書くのではなく、UI から利用するクライアント関数を提供。
// 実際のサーバ処理実装は後続。現段階ではモック相当の挙動で UI 構築を進める。

export type RunStep1Params = {
  centerId: string;
  files: File[];
  excelFile: File | null;
  onLog?: (msg: string) => void;
};

export type Step1Result = {
  headers: string[];
  rows: (string | number)[][];
  centerId: string;
  sourceFiles: { name: string; size: number; type: string }[];
  meta?: Record<string, unknown>;
};

// TODO: 実装時に実 API エンドポイントへ POST し SSE を受信しながら加工する
export async function runStep1(params: RunStep1Params): Promise<Step1Result> {
  const { centerId, files, excelFile, onLog } = params;
  const fd = new FormData();
  fd.append("centerId", centerId);
  fd.append("sheet", "入札書"); // 必要に応じ変更
  files.forEach((f) => fd.append("file", f));
  if (excelFile) fd.append("refSheetFile", excelFile);

  const res = await fetch("/api/step1", { method: "POST", body: fd });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let headers: string[] = [];
  let rows: (string | number)[][] = [];
  interface NormalizedPayload {
    headers: string[];
    rows: (string | number)[][];
  }
  let normalized: NormalizedPayload | null = null as NormalizedPayload | null;
  let refTable: (string | number)[][] | null = null;
  interface CombinedPayload {
    headers: string[];
    rows: (string | number)[][];
  }
  let combined: CombinedPayload | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    chunk.split("\n\n").forEach((line) => {
      if (!line.startsWith("data:")) return;
      const json = line.slice(5).trim();
      if (!json) return;
      try {
        interface SSEPayload {
          event: string;
          data: unknown;
        }
        const ev = JSON.parse(json) as SSEPayload;
        if (ev.event === "dbg" && typeof ev.data === "string") onLog?.(ev.data);
        else if (ev.event === "ref_table") {
          if (Array.isArray(ev.data)) {
            const tbl = ev.data as unknown[];
            if (tbl.length && Array.isArray(tbl[0])) {
              refTable = tbl as (string | number)[][];
            }
          }
        } else if (ev.event === "combined_table") {
          const d = ev.data as unknown;
          if (
            d &&
            typeof d === "object" &&
            Array.isArray((d as { headers?: unknown }).headers) &&
            Array.isArray((d as { rows?: unknown }).rows)
          ) {
            const h = (d as { headers: unknown[] }).headers.every(
              (x) => typeof x === "string"
            )
              ? (d as { headers: string[] }).headers
              : [];
            const r = (d as { rows: unknown[] }).rows.filter((row) =>
              Array.isArray(row)
            ) as (string | number)[][];
            if (h.length) combined = { headers: h, rows: r };
          }
        } else if (ev.event === "normalized_table") {
          const d = ev.data as unknown;
          if (
            d &&
            typeof d === "object" &&
            Array.isArray((d as { headers?: unknown }).headers) &&
            Array.isArray((d as { rows?: unknown }).rows)
          ) {
            const h = (d as { headers: unknown[] }).headers.every(
              (x) => typeof x === "string"
            )
              ? (d as { headers: string[] }).headers
              : [];
            const r = (d as { rows: unknown[] }).rows.filter((row) =>
              Array.isArray(row)
            ) as (string | number)[][];
            if (h.length) normalized = { headers: h, rows: r };
          }
        } else if (ev.event === "ocr_table") {
          if (Array.isArray(ev.data)) {
            const table = ev.data as unknown[];
            if (table.length) {
              const first = table[0];
              if (Array.isArray(first))
                headers = (first as unknown[]).map((c) => String(c));
              rows = (table.slice(1) as unknown[]).filter((r) =>
                Array.isArray(r)
              ) as (string | number)[][];
            }
          }
        } else if (ev.event === "done") {
          onLog?.("STEP1 完了");
        }
      } catch {
        /* ignore */
      }
    });
  }
  return {
    headers: normalized
      ? (normalized as NormalizedPayload).headers
      : combined
      ? (combined as CombinedPayload).headers
      : headers.length
      ? headers
      : ["ファイル", "商品名", "規格"],
    rows: normalized ? (normalized as NormalizedPayload).rows : rows,
    centerId,
    sourceFiles: files.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    })),
    meta: {
      mocked: false,
      normalizedOriginal: normalized
        ? { rawHeaders: headers, rawRows: rows }
        : undefined,
      refTable,
      combined,
    },
  };
}

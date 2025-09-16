// STEP2: スプレッドシート出力 API 呼び出しラッパ (モック)
import type { Step1Result } from "./ocr";

export type RunStep2Params = {
  centerId: string;
  step1Result: Step1Result;
  onLog?: (msg: string) => void;
};

export type Step2Result = {
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  exportedCount?: number;
  centerId: string;
};

export async function runStep2(params: RunStep2Params): Promise<Step2Result> {
  const { centerId, step1Result, onLog } = params;
  const { headers, rows, sourceFiles, meta } = step1Result;
  const payload = JSON.stringify({
    centerId,
    headers,
    rows,
    sourceFiles,
    meta,
  });
  const res = await fetch("/api/step2", {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let outId: string | undefined;
  let outUrl: string | undefined;
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
        else if (
          ev.event === "progress" &&
          typeof ev.data === "object" &&
          ev.data
        ) {
          const d = ev.data as { stage?: string };
          if (d.stage) onLog?.(`[PROGRESS] ${d.stage}`);
        } else if (
          ev.event === "final_url" &&
          typeof ev.data === "object" &&
          ev.data
        ) {
          const d = ev.data as { url?: string } & Record<string, unknown>;
          outUrl = d.url;
          const match = outUrl?.match(/\/d\/(.+?)\/edit/);
          if (match) outId = match[1];
        }
      } catch {
        /* ignore */
      }
    });
  }
  return {
    spreadsheetId: outId,
    spreadsheetUrl: outUrl,
    exportedCount: step1Result.rows.length,
    centerId,
  };
}

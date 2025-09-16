// C:\Users\yamag\project\ocr_uruno_4\src\app\components\inputExcel.tsx
"use client";

import { useState } from "react";

type Table = { headers: string[]; rows: (string | number)[][] };

export default function InputExcel() {
  const [fileName, setFileName] = useState<string>("");
  const [table, setTable] = useState<Table | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const XLSX = await import("xlsx");
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<any>(sheet, {
      header: 1,
      raw: true,
    }) as any[][];
    const headers = (json[0] || []).map(String);
    const rows = (json.slice(1) || []).map((r) =>
      (r || []).map((c) => (c ?? "").toString())
    );
    setTable({ headers, rows });
  }

  return (
    <section className="space-y-3">
      <header className="font-semibold">Excel 入力領域</header>
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="text-sm"
        />
        {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
      </div>

      {table && (
        <div className="border rounded overflow-auto max-h-96">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                {table.headers.map((h, i) => (
                  <th key={i} className="px-2 py-1 border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {(r || []).map((c, ci) => (
                    <td key={ci} className="px-2 py-1 border whitespace-nowrap">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

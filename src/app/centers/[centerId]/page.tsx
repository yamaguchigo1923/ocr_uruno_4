// C:\Users\yamag\project\ocr_uruno_4\src\app\centers\[centerId]\page.tsx
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import path from "path";
import { promises as fs } from "fs";
import CenterInfo from "@/app/components/centerInfo";

async function existsCenter(centerId: string) {
  const p = path.join(
    process.cwd(),
    "src",
    "app",
    "config",
    "centers",
    `${centerId}.json`
  );
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export default async function Page({
  params,
}: {
  // Next.js 15 では params は Promise 型として渡されるため await が必要
  params: Promise<{ centerId: string }>;
}) {
  const { centerId } = await params;

  const ok = await existsCenter(centerId);
  if (!ok) return notFound();

  return (
    <main className="p-6 space-y-6">
      <CenterInfo centerId={centerId} />
      {/* ここにアップロード/解析UIなどを追加 */}
    </main>
  );
}

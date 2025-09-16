// C:\Users\yamag\project\ocr_uruno_4\src\app\centers\[centerId]\page.tsx
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import path from "path";
import { promises as fs } from "fs";
import CenterSelect from "@/app/components/centerSelect";
import CenterInfo from "@/app/components/centerInfo";
import InputPageClient from "./InputPageClient";

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
  params: { centerId: string };
}) {
  const { centerId } = params;
  const ok = await existsCenter(centerId);
  if (!ok) return notFound();
  return (
    <main className="p-6 space-y-10">
      <section className="space-y-6">
        <CenterSelect />
        <CenterInfo centerId={centerId} />
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">処理</h2>
        <InputPageClient centerId={centerId} />
      </section>
    </main>
  );
}

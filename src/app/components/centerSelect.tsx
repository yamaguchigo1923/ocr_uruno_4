// C:\Users\yamag\project\ocr_uruno_4\src\app\components\centerSelect.tsx
"use client";

import { useRouter, usePathname } from "next/navigation";
import centers from "@/app/config/all_centers.json";

type Center = { id: string; displayName: string };

export default function CenterSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const list = (centers as Center[]).filter((c) => c.id && c.displayName);

  const currentId =
    list.find((c) => pathname?.startsWith(`/centers/${c.id}`))?.id ?? "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val) router.push(`/centers/${val}`);
  }

  return (
    <div className="mb-4">
      <select
        value={currentId}
        onChange={handleChange}
        className="px-3 py-2 border rounded text-sm"
      >
        <option value="" disabled>
          給食センターを選択
        </option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

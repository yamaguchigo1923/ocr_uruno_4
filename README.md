This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## OCR / Sheets Export (Project Specific Notes)

### Environment Variables

Set the following in `.env.local` (never commit real secrets):

| Key                        | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `AZURE_ENDPOINT`           | Azure Document Intelligence endpoint                         |
| `AZURE_KEY`                | Azure Document Intelligence key                              |
| `SERVICE_ACCOUNT_JSON_B64` | Base64 encoded Google service account JSON                   |
| `DRIVE_FOLDER_ID`          | (Optional) Destination Drive folder to move new spreadsheets |
| `TEMPLATE_SPREADSHEET_ID`  | (Planned) For future template copy feature                   |

### 403 The caller does not have permission (Google Sheets / Drive)

If you see logs like:

```
[ERROR][sheets.create] 403 Error: The caller does not have permission
```

Check these points:

1. Share the target Drive folder (and any template spreadsheet) with the service account email shown in your JSON (`client_email`). Grant at least Editor.
2. Enable APIs in Google Cloud Console (same project as the service account):
   - Google Sheets API
   - Google Drive API
3. If using a Shared Drive, ensure the service account has explicit access to that shared drive (Add member → service account email → Content manager / Editor).
4. If your organization restricts external sharing, allow the service account domain or move the folder into a drive the service account can access.
5. Regenerate and re-encode the JSON if you rotated keys: `cat service-account.json | base64 -w0` (on macOS/Linux; for Windows use PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json'))`).
6. Confirm the base64 string has no line breaks in `.env.local`.

### Service Account JSON Loading

`SERVICE_ACCOUNT_JSON_B64` is decoded at runtime (dynamic import + runtime check). If missing or invalid, Step2 will fail before spreadsheet creation. Ensure the value matches the entire JSON file.

### Excel Reference Table Filtering

During Step1, reference Excel rows whose first column cell is blank are skipped (compacted). This prevents large trailing empty blocks from bloating the combined table.

### Combined Table Logic

When a reference Excel and OCR normalized table are both present:

1. Base columns = reference header row.
2. Additional OCR-normalized columns appended. If a header name collides, an `_OCR` suffix is added.
3. Rows are aligned by index; shorter side is padded with empty strings.

### Maker Sheets (Step2)

Step2 groups rows by the first header containing `メーカー`. A sheet per maker is added with identical headers and its subset of rows. If no such column exists, grouping is skipped.

---

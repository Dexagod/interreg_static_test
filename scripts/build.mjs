/**
 * Build a file-server-friendly static index:
 * - FLAT files: index.html, page-2.html, ...
 * - RELATIVE links everywhere (./style.css, ./page-2.html)
 * - Cards link to original IedereenOveral pages
 *
 * Machine-friendly exports:
 * - llms.txt (guidance for agents)  <-- now linked from HTML head + body
 * - catalog.json (small "start here" index)
 * - page-1.json, page-2.json, ... (paged arrays)
 * - record-<key>.json (one record per location)
 * - buildings.json (full pretty JSON)
 * - buildings.jsonl (+ .txt copy)
 *
 * Run:
 *   node scripts/build.mjs
 *
 * Env:
 *   DATA=data/buildings.json
 *   DIST=dist
 *   PAGE_SIZE=100
 */

import fs from "node:fs/promises";
import path from "node:path";

const CFG = {
  dataPath: process.env.DATA || "data/buildings.json",
  dist: process.env.DIST || "dist",
  pageSize: Number(process.env.PAGE_SIZE || "100"),
};

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function pageFilename(pageIndex) {
  return pageIndex === 0 ? "index.html" : `page-${pageIndex + 1}.html`;
}
function pageJsonFilename(pageIndex) {
  return `page-${pageIndex + 1}.json`;
}

function safeKeyForFile(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function recordFilename(b) {
  const k = safeKeyForFile(b.key || `${b.id || ""}-${b.slug || ""}` || "record");
  return `record-${k || "record"}.json`;
}

function layout({ title, body }) {
  // ✅ llms.txt is discoverable in HTML head (and also linked in body below)
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./style.css" />
  <link rel="alternate" type="text/plain" href="./llms.txt" title="LLM instructions" />
</head>
<body>
  <header class="wrap">
    <div class="brand">
      <a href="./index.html" class="brand__link">IedereenOveral — Static index</a>
      <div class="brand__sub">JS-free index with persistent links to the original pages.</div>
    </div>
  </header>
  <main class="wrap">
    ${body}
  </main>
  <footer class="wrap footer">
    <div>
      Agent guide: <a href="./llms.txt">llms.txt</a> ·
      Source of truth:
      <a href="https://iedereen.overal.info/" rel="noopener noreferrer">iedereen.overal.info</a>.
    </div>
  </footer>
</body>
</html>`;
}

function pager({ pageIndex, pageCount }) {
  const prevFile = pageIndex > 0 ? pageFilename(pageIndex - 1) : null;
  const nextFile = pageIndex < pageCount - 1 ? pageFilename(pageIndex + 1) : null;

  return `<nav class="pager" aria-label="Pagination">
    <div class="pager__left">
      ${
        prevFile
          ? `<a class="btn" href="./${prevFile}">← Previous</a>`
          : `<span class="btn btn--disabled">← Previous</span>`
      }
    </div>
    <div class="pager__mid">Page ${pageIndex + 1} / ${pageCount}</div>
    <div class="pager__right">
      ${
        nextFile
          ? `<a class="btn" href="./${nextFile}">Next →</a>`
          : `<span class="btn btn--disabled">Next →</span>`
      }
    </div>
  </nav>`;
}

function card(b) {
  const title = b.title || b.key || b.url;
  const desc = b.description ? escapeHtml(b.description) : "";
  const imgSrc = b.image && /^https?:\/\//i.test(b.image) ? b.image : null;

  const recFile = recordFilename(b);

  const img = imgSrc
    ? `<img class="card__img" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(
        title
      )}" loading="lazy" referrerpolicy="no-referrer" />`
    : "";

  return `<article class="card">
    <a class="card__inner" href="${escapeHtml(b.url)}" rel="noopener noreferrer">
      ${img}
      <div class="card__body">
        <h2 class="card__title">${escapeHtml(title)}</h2>
        ${desc ? `<p class="card__desc">${desc}</p>` : ""}
        <div class="card__meta">
          <span>${escapeHtml(b.url)}</span>
          <span class="sep">·</span>
          <a class="metaLink" href="./${escapeHtml(recFile)}">json</a>
        </div>
      </div>
    </a>
  </article>`;
}

async function main() {
  const raw = await fs.readFile(CFG.dataPath, "utf8");
  const buildings = JSON.parse(raw);

  await fs.rm(CFG.dist, { recursive: true, force: true });
  await ensureDir(CFG.dist);

  // CSS
  await fs.writeFile(
    path.join(CFG.dist, "style.css"),
    `
:root { color-scheme: light; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.45; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 16px; }
.brand__link { font-weight: 700; text-decoration: none; color: inherit; }
.brand__sub { color: #555; font-size: 0.95rem; margin-top: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { border: 1px solid #e6e6e6; border-radius: 12px; overflow: hidden; background: #fff; }
.card__inner { display: block; color: inherit; text-decoration: none; }
.card__img { width: 100%; height: 160px; object-fit: cover; background: #f3f3f3; display: block; }
.card__body { padding: 12px; }
.card__title { margin: 0 0 6px; font-size: 1.05rem; }
.card__desc { margin: 0 0 8px; color: #333; font-size: 0.95rem; }
.card__meta { color: #666; font-size: 0.78rem; word-break: break-all; display: flex; gap: 8px; flex-wrap: wrap; }
.sep { opacity: 0.6; }
.metaLink { color: inherit; text-decoration: underline; }
.pager { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; margin: 16px 0; }
.pager__left { justify-self: start; }
.pager__right { justify-self: end; }
.btn { display: inline-block; padding: 8px 10px; border-radius: 10px; border: 1px solid #ddd; text-decoration: none; color: inherit; background: #fafafa; }
.btn--disabled { opacity: 0.45; cursor: not-allowed; }
.footer { color: #666; font-size: 0.9rem; border-top: 1px solid #eee; margin-top: 20px; }
.hint { color: #555; margin-top: 6px; }
    `.trim(),
    "utf8"
  );

  // Full exports
  await fs.writeFile(path.join(CFG.dist, "buildings.json"), JSON.stringify(buildings, null, 2), "utf8");

  const jsonl = buildings.map((b) => JSON.stringify(b)).join("\n") + "\n";
  await fs.writeFile(path.join(CFG.dist, "buildings.jsonl"), jsonl, "utf8");
  await fs.writeFile(path.join(CFG.dist, "buildings.jsonl.txt"), jsonl, "utf8");

  // Per-record JSON + catalog
  const catalog = [];
  for (const b of buildings) {
    const rec = {
      ...b,
      note: "This record is an index entry. For more detail, follow `url` (original page).",
    };
    const fn = recordFilename(b);
    await fs.writeFile(path.join(CFG.dist, fn), JSON.stringify(rec, null, 2), "utf8");

    catalog.push({
      key: b.key || null,
      title: b.title || null,
      url: b.url,
      record: `./${fn}`,
    });
  }
  await fs.writeFile(path.join(CFG.dist, "catalog.json"), JSON.stringify(catalog, null, 2), "utf8");

  // HTML + paged JSON
  const pages = chunk(buildings, CFG.pageSize);
  const pageCount = pages.length;

  for (let i = 0; i < pageCount; i++) {
    const items = pages[i];

    const pageJson = items.map((b) => ({
      ...b,
      record: `./${recordFilename(b)}`,
    }));
    await fs.writeFile(path.join(CFG.dist, pageJsonFilename(i)), JSON.stringify(pageJson, null, 2), "utf8");

    // ✅ also link llms.txt in the visible hint
    const body = `
      <h1>Locaties</h1>
      <p class="hint">
        Total: ${buildings.length}. Clicking a card opens the original persistent URL.
        Agent guide: <a href="./llms.txt">llms.txt</a>.
        Machine starts: <a href="./catalog.json">catalog.json</a>.
        Per-page: <a href="./${pageJsonFilename(i)}">${pageJsonFilename(i)}</a>.
        Full: <a href="./buildings.json">buildings.json</a> (large), <a href="./buildings.jsonl">buildings.jsonl</a>.
      </p>
      ${pager({ pageIndex: i, pageCount })}
      <section class="grid">
        ${items.map(card).join("\n")}
      </section>
      ${pager({ pageIndex: i, pageCount })}
    `;

    const html = layout({ title: `Locaties — page ${i + 1}`, body });
    await fs.writeFile(path.join(CFG.dist, pageFilename(i)), html, "utf8");
  }

  // llms.txt (root, relative hosting friendly)
  const llmsTxt = `# IedereenOveral — Static index

This site is a JS-free, static INDEX of locations from https://iedereen.overal.info/.
It is designed to be easy for agents to traverse.

## What you can get here
Each location record includes:
- title
- description (often a short locality/address line from the listing)
- image (listing preview thumbnail when available)
- url (the ORIGINAL persistent location page on iedereen.overal.info)

## Start here (small and reliable)
- ./catalog.json — list of all locations with pointers to per-record JSON files

## Per-location (recommended)
- ./record-<key>.json — a single location record (small, easy to parse)
- Each record has url which is the original persistent page.

## Paged exports
- ./page-1.json, ./page-2.json, ... — same data in pages (mirrors HTML pagination)

## Notes
This static index does NOT necessarily contain detailed accessibility measurements/fields.
If you need details not present in the record, follow url to the original page.
`;
  await fs.writeFile(path.join(CFG.dist, "llms.txt"), llmsTxt, "utf8");

  console.log(`Built static site in ./${CFG.dist}`);
  console.log(`HTML pages: ${pageCount} (flat files)`);
  console.log(`Machine: llms.txt, catalog.json, page-N.json, record-*.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

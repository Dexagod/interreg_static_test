/**
 * Build a file-server-friendly static index:
 * - FLAT files (no directories): index.html, page-2.html, page-3.html, ...
 * - RELATIVE links everywhere (./style.css etc) so it works under any base path
 * - Cards link directly to original IedereenOveral pages
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

function layout({ title, body }) {
  // NOTE: relative stylesheet path
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <header class="wrap">
    <div class="brand">
      <a href="./index.html" class="brand__link">IedereenOveral — Static index</a>
      <div class="brand__sub">Pure static listing with persistent links to the original pages.</div>
    </div>
  </header>
  <main class="wrap">
    ${body}
  </main>
  <footer class="wrap footer">
    <div>
      Source of truth remains
      <a href="https://iedereen.overal.info/" rel="noopener noreferrer">iedereen.overal.info</a>.
      This site only republishes a traversible index.
    </div>
  </footer>
</body>
</html>`;
}

function pageFilename(pageIndex) {
  // pageIndex is 0-based
  return pageIndex === 0 ? "index.html" : `page-${pageIndex + 1}.html`;
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
        <div class="card__meta">${escapeHtml(b.url)}</div>
      </div>
    </a>
  </article>`;
}

async function main() {
  const raw = await fs.readFile(CFG.dataPath, "utf8");
  const buildings = JSON.parse(raw);

  await fs.rm(CFG.dist, { recursive: true, force: true });
  await ensureDir(CFG.dist);

  // CSS in root (referenced as ./style.css everywhere)
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
.card__meta { color: #666; font-size: 0.78rem; word-break: break-all; }
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

  // Machine-readable exports in root (relative links)
  await fs.writeFile(path.join(CFG.dist, "buildings.json"), JSON.stringify(buildings, null, 2), "utf8");
  await fs.writeFile(
    path.join(CFG.dist, "buildings.ndjson"),
    buildings.map((b) => JSON.stringify(b)).join("\n") + "\n",
    "utf8"
  );

  // Paginated pages (flat)
  const pages = chunk(buildings, CFG.pageSize);
  const pageCount = pages.length;

  for (let i = 0; i < pageCount; i++) {
    const items = pages[i];

    const body = `
      <h1>Locaties</h1>
      <p class="hint">
        Total: ${buildings.length}. Clicking a card opens the original persistent URL.
        Exports: <a href="./buildings.json">buildings.json</a>, <a href="./buildings.ndjson">buildings.ndjson</a>.
      </p>
      ${pager({ pageIndex: i, pageCount })}
      <section class="grid">
        ${items.map(card).join("\n")}
      </section>
      ${pager({ pageIndex: i, pageCount })}
    `;

    const html = layout({ title: `Locaties — page ${i + 1}`, body });
    const file = pageFilename(i);

    await fs.writeFile(path.join(CFG.dist, file), html, "utf8");
  }

  console.log(`Built static site in ./${CFG.dist}`);
  console.log(`Files: ${pageCount} HTML pages + style.css + buildings.json + buildings.ndjson`);
  console.log(`Open: ${path.join(CFG.dist, "index.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

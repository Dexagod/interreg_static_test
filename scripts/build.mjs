/**
 * Build a file-server / Solid-Pod friendly static index:
 * - FLAT files: index.html, page-2.html, page-3.html, ...
 * - RELATIVE links everywhere (./style.css etc)
 * - Cards link to original IedereenOveral pages
 *
 * Agent guidance:
 * - llms.txt (linked in HTML head + footer)
 * - locations.tsv (title<TAB>url) small + fast; avoids "dataset trap"
 *
 * Optional (OFF by default):
 * - buildings.json, buildings.jsonl (only if EXPORT_JSON=true)
 *
 * Run:
 *   node scripts/build.mjs
 *
 * Env:
 *   DATA=data/buildings.json
 *   DIST=dist
 *   PAGE_SIZE=100
 *   EXPORT_JSON=false|true   (default false)
 */

import fs from "node:fs/promises";
import path from "node:path";

const CFG = {
  dataPath: process.env.DATA || "data/buildings.json",
  dist: process.env.DIST || "dist",
  pageSize: Number(process.env.PAGE_SIZE || "100"),
  exportJson: String(process.env.EXPORT_JSON || "false").toLowerCase() === "true",
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

function layout({ title, body }) {
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
      Agent guide: <a href="./llms.txt">llms.txt</a> · Quick map: <a href="./locations.tsv">locations.tsv</a> ·
      Source of truth: <a href="https://iedereen.overal.info/" rel="noopener noreferrer">iedereen.overal.info</a>
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

function tsvEscape(s) {
  // keep it simple: replace tabs/newlines
  return String(s ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
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

  // llms.txt (explicitly tells agents not to waste time on exports)
  const llmsTxt = `# IedereenOveral — Static index

This site is a JS-free INDEX of locations from https://iedereen.overal.info/.

## Intended agent behavior
1) Search/filter by location name using the HTML pages (or locations.tsv).
2) Open only the relevant original pages via the \`url\` links.
3) Extract detailed accessibility observations from the original pages.

## What is stored here
Only basic listing info:
- title
- description (often locality/address line)
- image (listing preview thumbnail if available)
- url (the ORIGINAL persistent location page)

This index does NOT aim to contain full accessibility measurements/fields.
If you need detailed fields (e.g., wheelchair toilet, door widths), follow \`url\`.
`;
  await fs.writeFile(path.join(CFG.dist, "llms.txt"), llmsTxt, "utf8");

  // locations.tsv (tiny, fast, hard to misinterpret as “full dataset”)
  // Format: title<TAB>url
  const tsvLines = [
    "title\turl",
    ...buildings.map((b) => `${tsvEscape(b.title || b.key || "")}\t${tsvEscape(b.url || "")}`),
  ];
  await fs.writeFile(path.join(CFG.dist, "locations.tsv"), tsvLines.join("\n") + "\n", "utf8");

  // Optional exports (OFF by default)
  if (CFG.exportJson) {
    await fs.writeFile(path.join(CFG.dist, "buildings.json"), JSON.stringify(buildings, null, 2), "utf8");
    const jsonl = buildings.map((b) => JSON.stringify(b)).join("\n") + "\n";
    await fs.writeFile(path.join(CFG.dist, "buildings.jsonl"), jsonl, "utf8");
    await fs.writeFile(path.join(CFG.dist, "buildings.jsonl.txt"), jsonl, "utf8");
  }

  // HTML pages
  const pages = chunk(buildings, CFG.pageSize);
  const pageCount = pages.length;

  for (let i = 0; i < pageCount; i++) {
    const items = pages[i];

    const body = `
      <h1>Locaties</h1>
      <p class="hint">
        Total: ${buildings.length}. Clicking a card opens the original persistent URL.
        Agent guide: <a href="./llms.txt">llms.txt</a> · Quick map: <a href="./locations.tsv">locations.tsv</a>
        ${CFG.exportJson ? `· (exports enabled)` : ``}
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

  console.log(`Built static site in ./${CFG.dist}`);
  console.log(`HTML pages: ${pageCount} (flat files)`);
  console.log(`Agent files: llms.txt, locations.tsv`);
  console.log(`JSON exports: ${CFG.exportJson ? "ON" : "OFF"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * IedereenOveral listing-only extractor
 *
 * - Crawls listing pages via bottom <nav role="navigation"> pagination
 * - Extracts each listing item from its <a href="locaties/00000-slug/">
 * - Pulls ONLY listing info (no detail page visits):
 *   - url (absolute, normalized)
 *   - title (best title text inside the item)
 *   - description (best short non-title text; usually address line)
 *   - image (preview thumbnail; ignores medal/icon images)
 *
 * Output: data/buildings.json
 *
 * Run:
 *   node scripts/extract.mjs
 *
 * Env:
 *   START_URL=https://iedereen.overal.info/
 *   OUT=data/buildings.json
 *   MAX_LOCATIONS=0         (0 = no limit)
 *   MAX_LISTING_PAGES=0     (0 = until "next" stops)
 *   HEADFUL=false|true
 */

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const CFG = {
  startUrl: process.env.START_URL || "https://iedereen.overal.info/",
  outFile: process.env.OUT || "data/buildings.json",
  maxLocations: Number(process.env.MAX_LOCATIONS || "0"),
  maxListingPages: Number(process.env.MAX_LISTING_PAGES || "0"),
  headful: String(process.env.HEADFUL || "false").toLowerCase() === "true",
};

function normalizeSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function normalizeUrl(u) {
  return u.endsWith("/") ? u : `${u}/`;
}
function stripQueryHash(url) {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
function parseKey(url) {
  const m = url.match(/\/locaties\/([^/]+)\/?$/);
  const key = m ? m[1] : null;
  const idMatch = key?.match(/^(\d{5})-(.+)$/);
  return {
    key: key || null,
    id: idMatch ? idMatch[1] : null,
    slug: idMatch ? idMatch[2] : null,
  };
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function assertJsRendered(page, label) {
  const bodyText = normalizeSpace(await page.locator("body").innerText().catch(() => ""));
  if (bodyText.toLowerCase().includes("doesn't work properly without javascript enabled")) {
    throw new Error(`[${label}] Page did not render (JS-disabled message visible).`);
  }
}

async function tryDismissCookieBanners(page) {
  const buttons = [/accep/i, /akkoord/i, /agree/i, /^ok$/i, /alles accep/i];
  for (const rx of buttons) {
    const loc = page.getByRole("button", { name: rx }).first();
    if (await loc.count()) {
      try {
        await loc.click({ timeout: 1500 });
        await page.waitForTimeout(250);
      } catch {}
    }
  }
}

/**
 * -------- Pagination: bottom <nav role="navigation">, next via aria-label --------
 */
async function getCurrentListingPageNumber(page) {
  const txt = await page
    .locator('nav[role="navigation"] li[aria-current="true"] p')
    .first()
    .textContent()
    .catch(() => "");
  const n = Number(normalizeSpace(txt));
  return Number.isFinite(n) ? n : null;
}

async function clickNextListingPage(page) {
  const nav = page.locator('nav[role="navigation"]').first();
  if (!(await nav.count())) return false;

  const before = await getCurrentListingPageNumber(page);
  const beforeFirstHref = await page
    .locator('a[href*="locaties/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);

  const nextBtn = nav.locator('[aria-label="Volgende pagina"]').first();
  if (!(await nextBtn.count())) return false;

  const disabled = await nextBtn.getAttribute("aria-disabled").catch(() => null);
  if (String(disabled).toLowerCase() === "true") return false;

  try {
    await nextBtn.scrollIntoViewIfNeeded();
    await nextBtn.click({ timeout: 4000 });
  } catch {
    const li = nextBtn.locator("xpath=ancestor::li[1]");
    if (await li.count()) {
      try {
        await li.click({ timeout: 4000 });
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => null);

  // wait for aria-current page number change (best signal)
  if (before !== null) {
    await page
      .waitForFunction(
        (prev) => {
          const cur = document.querySelector('nav[role="navigation"] li[aria-current="true"] p');
          const t = cur?.textContent?.trim() || "";
          const n = Number(t);
          return Number.isFinite(n) && n !== prev;
        },
        before,
        { timeout: 10000 }
      )
      .catch(() => null);
  }

  // additional: wait for first href to change (SPA render)
  if (beforeFirstHref) {
    await page
      .waitForFunction(
        (prevHref) => {
          const a = document.querySelector('a[href*="locaties/"]');
          const h = a?.getAttribute("href") || "";
          return h && h !== prevHref;
        },
        beforeFirstHref,
        { timeout: 10000 }
      )
      .catch(() => null);
  }

  const after = await getCurrentListingPageNumber(page);
  if (before !== null && after !== null && before === after) return false;

  await page.waitForTimeout(500);
  return true;
}

/**
 * Extract listing items from current page.
 *
 * Uses the <a href="locaties/..."> itself as the root (so it never mixes cards).
 * Picks the preview image by filtering out medal/icon images.
 */
async function collectEntriesOnCurrentListingPage(page) {
  return await page.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const normalizeUrl = (u) => (u.endsWith("/") ? u : u + "/");

    const toAbs = (href) => {
      if (!href) return null;
      href = String(href).trim();
      try {
        if (/^https?:\/\//i.test(href)) return new URL(href).toString();
        if (href.startsWith("/")) return new URL(href, location.origin).toString();
        href = href.replace(/^\.?\//, "");
        return new URL("/" + href, location.origin).toString();
      } catch {
        return null;
      }
    };

    const isLoc = (hrefAbs) => {
      try {
        const u = new URL(hrefAbs);
        return /^\/locaties\/\d{5}-/i.test(u.pathname);
      } catch {
        return false;
      }
    };

    // Filter out medal/icon images; keep the preview (xano thumbnail etc.)
    const isDecorationImg = (src, alt) => {
      const s = String(src || "");
      const a = String(alt || "");
      return (
        /goud|zilver|brons|medaille/i.test(s) ||
        /goud|zilver|brons|medaille/i.test(a) ||
        /icon|logo|favicon|precomposed|sprite|apple-touch/i.test(s) ||
        // most medal assets are local "images/..."
        /^images\//i.test(s)
      );
    };

    const pickPreviewImage = (a) => {
      const imgs = [...a.querySelectorAll("img")];

      // Prefer the “real” preview: external xano thumbnail, often has "thumbnail_" and tpl=big
      const prefer = imgs.find((img) => {
        const src = img.getAttribute("src") || "";
        const alt = img.getAttribute("alt") || "";
        if (!src) return false;
        if (isDecorationImg(src, alt)) return false;
        return /xano\.io|thumbnail_|tpl=big/i.test(src);
      });
      if (prefer) return prefer.getAttribute("src") || null;

      // Otherwise: first non-decoration img
      const cand = imgs.find((img) => {
        const src = img.getAttribute("src") || "";
        const alt = img.getAttribute("alt") || "";
        if (!src) return false;
        if (isDecorationImg(src, alt)) return false;
        return true;
      });
      return cand ? cand.getAttribute("src") : null;
    };

    const pickTitle = (a) => {
      // In your snippet, the title is a <p class="ww-text-content"> with text "'t Kroonrad"
      // The anchor also contains other <p> like "3294 Molenstede", so:
      // - choose the first short line that has no postal-code pattern and is not too long.
      const ps = [...a.querySelectorAll("p.ww-text-content, p")].map((p) => norm(p.textContent)).filter(Boolean);

      const isPostalLine = (t) => /\b\d{4}\b/.test(t); // 3294 Molenstede
      const isTooLong = (t) => t.length > 80;

      // best: first non-postal, not too long
      const best = ps.find((t) => !isPostalLine(t) && !isTooLong(t));
      if (best) return best;

      // fallback: first <p>
      return ps[0] || null;
    };

    const pickDescription = (a, title) => {
      // Often the second line is the address/postal+locality, which is useful.
      const ps = [...a.querySelectorAll("p.ww-text-content, p")].map((p) => norm(p.textContent)).filter(Boolean);

      // Prefer postal/locality line
      const postal = ps.find((t) => /\b\d{4}\b/.test(t));
      if (postal) return postal;

      // Else, pick first line that's not the title and not huge
      const other = ps.find((t) => t !== title && t.length <= 120);
      return other || null;
    };

    const anchors = [...document.querySelectorAll('a[href*="locaties/"]')];

    const out = [];
    for (const a of anchors) {
      const href = a.getAttribute("href");
      const abs = toAbs(href);
      if (!abs || !isLoc(abs)) continue;

      const u = new URL(abs);
      const url = normalizeUrl(u.origin + u.pathname);

      const title = pickTitle(a);
      const description = pickDescription(a, title);

      const img = pickPreviewImage(a);
      const imageAbs = img ? toAbs(img) : null;

      out.push({ url, title, description, image: imageAbs });
    }

    // de-dupe by url
    const m = new Map();
    for (const e of out) {
      const prev = m.get(e.url);
      if (!prev) m.set(e.url, e);
      else {
        m.set(e.url, {
          url: e.url,
          title: prev.title || e.title,
          description: prev.description || e.description,
          image: prev.image || e.image,
        });
      }
    }
    return [...m.values()];
  });
}

async function discoverAllEntries(page) {
  await page.goto(CFG.startUrl, { waitUntil: "domcontentloaded" });
  await assertJsRendered(page, "start");
  await tryDismissCookieBanners(page);

  await page.waitForSelector('a[href*="locaties/"]', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(800);

  const all = new Map(); // url -> {url,title,description,image}
  let pageCount = 0;

  while (true) {
    pageCount++;
    const cur = await getCurrentListingPageNumber(page);

    const entries = await collectEntriesOnCurrentListingPage(page);

    for (const e of entries) {
      const cleanUrl = normalizeUrl(stripQueryHash(e.url));
      const prev = all.get(cleanUrl);
      all.set(cleanUrl, {
        url: cleanUrl,
        title: prev?.title || e.title || null,
        description: prev?.description || e.description || null,
        image: prev?.image || e.image || null,
      });
    }

    console.log(
      `[listing] page=${cur ?? "?"} pageCount=${pageCount} foundHere=${entries.length} totalUnique=${all.size}`
    );

    if (CFG.maxLocations > 0 && all.size >= CFG.maxLocations) break;
    if (CFG.maxListingPages > 0 && pageCount >= CFG.maxListingPages) break;

    const didNext = await clickNextListingPage(page);
    if (!didNext) break;
  }

  let items = [...all.values()].sort((a, b) => a.url.localeCompare(b.url));
  if (CFG.maxLocations > 0) items = items.slice(0, CFG.maxLocations);

  console.log(`[listing] DONE discovered=${items.length}`);
  return items;
}

async function main() {
  await ensureDir(path.dirname(CFG.outFile));

  console.log(`[config] startUrl=${CFG.startUrl}`);
  console.log(`[config] outFile=${CFG.outFile}`);

  const browser = await chromium.launch({ headless: !CFG.headful });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    locale: "nl-BE",
  });

  const listingPage = await context.newPage();
  const entries = await discoverAllEntries(listingPage);

  await browser.close();

  if (entries.length === 0) {
    console.error(`[fatal] Discovered 0 locations.`);
    process.exit(2);
  }

  // Final output objects
  const buildings = entries.map((e) => {
    const keyInfo = parseKey(e.url);
    return {
      url: e.url,
      ...keyInfo,
      title: e.title || keyInfo.key || e.url,
      description: e.description || null,
      image: e.image || null,
      canonical: e.url,
    };
  });

  await fs.writeFile(CFG.outFile, JSON.stringify(buildings, null, 2), "utf8");
  console.log(`Wrote ${buildings.length} records to ${CFG.outFile}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});

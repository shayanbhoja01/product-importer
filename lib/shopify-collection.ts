// Checks product counts (total vs. in-stock) for a Shopify collection,
// matching what a real visitor sees when browsing the storefront page and
// clicking "Load More" — not just Shopify's raw backend collection
// membership, which can be larger than what a theme actually displays.
//
// Approach:
//  1. Pull the collection's public JSON feed (`/collections/{handle}/products.json`)
//     to get accurate per-product stock availability.
//  2. Separately walk the actual storefront collection pages
//     (`/collections/{handle}?page=N`, plain HTML) and count the distinct
//     product links that really render there — this is the number a
//     shopper would get by clicking "Load More" until the end.
//  3. Report the storefront-visible count as the total, using the JSON
//     data to determine which of those visible products are in stock.
//  4. If the storefront pages don't yield any product links at all (e.g. a
//     fully JS-rendered/headless storefront our plain HTML fetch can't
//     see), fall back to the JSON feed's totals and flag that a fallback
//     was used, rather than silently reporting zero.

export interface StockCheckResult {
  input: string;
  collectionUrl: string;
  totalProducts: number;
  inStock: number;
  outOfStock: number;
  /** How the total was determined — for transparency in the UI. */
  countedFrom: "storefront" | "collection-data";
}

/** Generic failure: network error, timeout, unexpected server error, etc. */
export class StockCheckError extends Error {}

/**
 * Raised specifically when the site does not appear to be a Shopify store
 * at all (no valid Shopify product feed found), as opposed to a transient
 * network problem. Used to distinguish "skip — not Shopify" from "failed".
 */
export class NotShopifyError extends StockCheckError {}

const PAGE_SIZE = 250; // Shopify's max page size for the JSON feed
const MAX_PAGES = 40; // safety cap (=10,000 products) to avoid runaway loops
const PAGE_BATCH_SIZE = 6; // pages fetched concurrently per round, to stay fast

const MAX_HTML_PAGES = 30; // safety cap for storefront pagination walk
const HTML_BATCH_SIZE = 4; // storefront pages fetched concurrently per round

/**
 * Accepts either a bare store domain, a homepage URL, or a full collection
 * URL, and normalizes it to a collection handle + JSON feed base URL.
 */
function resolveCollectionFeed(input: string): { origin: string; handle: string } {
  let trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new StockCheckError("Not a valid URL or domain.");
  }

  const match = parsed.pathname.match(/\/collections\/([a-zA-Z0-9-_%]+)/);
  const handle = match ? match[1] : "all";

  return { origin: `${parsed.protocol}//${parsed.host}`, handle };
}

interface ProductInfo {
  handle: string;
  available: boolean;
}

interface PageFetch {
  products: any[];
}

/**
 * Fetches one page of the collection's JSON feed. Classifies failures so
 * callers can tell "definitely not Shopify" apart from a transient error.
 */
async function fetchJsonPage(origin: string, handle: string, page: number): Promise<PageFetch> {
  const url = `${origin}/collections/${handle}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    throw new StockCheckError(`Could not reach ${origin} (${(err as Error).message}).`);
  }

  if (res.status === 404) {
    throw new NotShopifyError(`${origin} returned 404 for collection "${handle}".`);
  }
  if (!res.ok) {
    throw new StockCheckError(
      `${origin} returned ${res.status} for collection "${handle}". It may be password-protected or temporarily unavailable.`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    throw new NotShopifyError(
      `${origin} did not return JSON (got "${contentType || "unknown"}") — this doesn't look like a Shopify store.`
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new NotShopifyError(`${origin} did not return valid JSON — this doesn't look like a Shopify store.`);
  }

  if (!data || !Array.isArray(data.products)) {
    throw new NotShopifyError(
      `${origin} responded, but not in Shopify's product-feed format — this doesn't look like a Shopify store.`
    );
  }

  return { products: data.products };
}

/**
 * Fetch every product in a collection's JSON feed and return per-product
 * stock availability, keyed by handle. This is Shopify's raw collection
 * membership — it can include more products than a theme actually renders
 * (see module doc comment), so it's used only as an availability lookup,
 * not as the reported total.
 */
async function pullJsonAvailability(
  origin: string,
  handle: string
): Promise<Map<string, boolean>> {
  const availability = new Map<string, boolean>();
  let nextPage = 1;
  let reachedEnd = false;

  while (!reachedEnd && nextPage <= MAX_PAGES) {
    const batchPages = Array.from(
      { length: Math.min(PAGE_BATCH_SIZE, MAX_PAGES - nextPage + 1) },
      (_, i) => nextPage + i
    );

    const batchResults = await Promise.all(batchPages.map((p) => fetchJsonPage(origin, handle, p)));

    for (const { products } of batchResults) {
      if (!products.length) {
        reachedEnd = true;
        break;
      }
      for (const product of products) {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const available = variants.some((v: any) => v.available === true);
        if (product.handle) availability.set(product.handle, available);
      }
      if (products.length < PAGE_SIZE) {
        reachedEnd = true;
        break;
      }
    }

    nextPage += batchPages.length;
  }

  return availability;
}

/** Extracts distinct product handles (e.g. "co-21") from a collection page's raw HTML. */
function extractProductHandles(html: string): Set<string> {
  const handles = new Set<string>();
  // Matches /products/{handle} regardless of an optional locale prefix
  // (e.g. /en-us/products/co-21) and ignores query strings/fragments.
  const regex = /\/products\/([a-zA-Z0-9%_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html))) {
    try {
      handles.add(decodeURIComponent(m[1]));
    } catch {
      handles.add(m[1]);
    }
  }
  return handles;
}

async function fetchCollectionHtml(origin: string, handle: string, page: number): Promise<string | null> {
  const url = `${origin}/collections/${handle}?page=${page}`;
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Walks the actual storefront collection pages (plain HTML, the same pages
 * a shopper's "Load More" button pages through) and returns the set of
 * distinct product handles that genuinely render there. Stops once a page
 * contributes no new products — that's the real end of the list.
 *
 * Returns an empty set if the storefront pages don't contain recognizable
 * product links at all (e.g. a fully JS-rendered storefront), signaling
 * callers to fall back to the JSON feed's totals instead.
 */
async function fetchStorefrontHandles(origin: string, handle: string): Promise<Set<string>> {
  const seen = new Set<string>();
  let page = 1;

  while (page <= MAX_HTML_PAGES) {
    const batchPages = Array.from(
      { length: Math.min(HTML_BATCH_SIZE, MAX_HTML_PAGES - page + 1) },
      (_, i) => page + i
    );

    const batchHtml = await Promise.all(batchPages.map((p) => fetchCollectionHtml(origin, handle, p)));

    let stop = false;
    for (const html of batchHtml) {
      if (!html) {
        stop = true;
        break;
      }
      const before = seen.size;
      for (const h of extractProductHandles(html)) seen.add(h);
      if (seen.size === before) {
        // This page added nothing new — we've reached the end of the list.
        stop = true;
        break;
      }
    }

    if (stop) break;
    page += batchPages.length;
  }

  return seen;
}

/**
 * Fetch a collection's stock counts, matching what a real visitor sees on
 * the storefront. If the URL pointed at a specific (non-"all") collection
 * and that fails, automatically falls back to checking the store's "all
 * products" collection before concluding the site isn't Shopify.
 */
export async function checkCollectionStock(input: string): Promise<StockCheckResult> {
  const { origin, handle } = resolveCollectionFeed(input);

  async function pull(handleToUse: string): Promise<StockCheckResult> {
    // Run both lookups concurrently — they're independent data sources.
    const [availability, storefrontHandles] = await Promise.all([
      pullJsonAvailability(origin, handleToUse),
      fetchStorefrontHandles(origin, handleToUse),
    ]);

    if (storefrontHandles.size > 0) {
      let inStock = 0;
      for (const h of storefrontHandles) {
        if (availability.get(h)) inStock += 1;
      }
      const total = storefrontHandles.size;
      return {
        input,
        collectionUrl: `${origin}/collections/${handleToUse}`,
        totalProducts: total,
        inStock,
        outOfStock: total - inStock,
        countedFrom: "storefront",
      };
    }

    // Fallback: storefront HTML didn't yield any product links (e.g. a
    // headless/JS-rendered storefront) — report the JSON feed's totals
    // instead of a false zero, flagged so the UI can note the difference.
    const total = availability.size;
    const inStock = Array.from(availability.values()).filter(Boolean).length;
    return {
      input,
      collectionUrl: `${origin}/collections/${handleToUse}`,
      totalProducts: total,
      inStock,
      outOfStock: total - inStock,
      countedFrom: "collection-data",
    };
  }

  try {
    return await pull(handle);
  } catch (err) {
    // If a specific collection handle failed, give the store one more
    // chance via its default "all products" collection before giving up —
    // avoids false "not Shopify" verdicts caused by a wrong/renamed handle.
    if (handle !== "all" && err instanceof NotShopifyError) {
      try {
        return await pull("all");
      } catch {
        throw err; // report the original error, it's the more informative one
      }
    }
    throw err;
  }
}

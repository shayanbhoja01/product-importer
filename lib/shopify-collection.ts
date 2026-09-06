// Checks product counts (total vs. in-stock) for a Shopify collection page
// using the storefront's public `/collections/{handle}/products.json` feed.
// Same principle as the importer: no HTML scraping, just Shopify's own
// structured JSON, so this only works against live Shopify stores.

export interface StockCheckResult {
  input: string;
  collectionUrl: string;
  totalProducts: number;
  inStock: number;
  outOfStock: number;
}

/** Generic failure: network error, timeout, unexpected server error, etc. */
export class StockCheckError extends Error {}

/**
 * Raised specifically when the site does not appear to be a Shopify store
 * at all (no valid Shopify product feed found), as opposed to a transient
 * network problem. Used to distinguish "skip — not Shopify" from "failed".
 */
export class NotShopifyError extends StockCheckError {}

const PAGE_SIZE = 250; // Shopify's max page size for this endpoint
const MAX_PAGES = 40; // safety cap (=10,000 products) to avoid runaway loops
const PAGE_BATCH_SIZE = 6; // pages fetched concurrently per round, to stay fast

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

interface PageFetch {
  products: any[];
}

/**
 * Fetches one page of a collection feed. Classifies failures so callers can
 * tell "definitely not Shopify" apart from "network hiccup / transient error".
 */
async function fetchPage(origin: string, handle: string, page: number): Promise<PageFetch> {
  const url = `${origin}/collections/${handle}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    throw new StockCheckError(`Could not reach ${origin} (${(err as Error).message}).`);
  }

  if (res.status === 404) {
    // 404 on Shopify's own collection endpoint most often means either the
    // collection handle doesn't exist, or this isn't a Shopify store at all.
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
 * Fetch every product in a collection and count stock status.
 *
 * Pages are fetched in concurrent batches (rather than one at a time) to
 * keep total wall-clock time low — this matters because each site check
 * runs inside a single serverless function call with a hard time limit, and
 * sequential page-by-page fetching for a large catalog could exceed it.
 */
async function pullAllPages(
  origin: string,
  handle: string
): Promise<{ total: number; inStock: number }> {
  let total = 0;
  let inStock = 0;
  let nextPage = 1;
  let reachedEnd = false;

  while (!reachedEnd && nextPage <= MAX_PAGES) {
    const batchPages = Array.from(
      { length: Math.min(PAGE_BATCH_SIZE, MAX_PAGES - nextPage + 1) },
      (_, i) => nextPage + i
    );

    const batchResults = await Promise.all(
      batchPages.map((p) => fetchPage(origin, handle, p))
    );

    for (const { products } of batchResults) {
      if (!products.length) {
        reachedEnd = true;
        break; // an empty page means every page after it is also empty
      }
      for (const product of products) {
        total += 1;
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.some((v: any) => v.available === true)) inStock += 1;
      }
      if (products.length < PAGE_SIZE) {
        reachedEnd = true;
        break; // a short page is always the last page
      }
    }

    nextPage += batchPages.length;
  }

  return { total, inStock };
}

/**
 * Fetch every product in a collection (across pages) and count stock status.
 * If the URL pointed at a specific (non-"all") collection and that fails,
 * automatically falls back to checking the store's "all products" collection
 * before concluding the site isn't Shopify.
 */
export async function checkCollectionStock(input: string): Promise<StockCheckResult> {
  const { origin, handle } = resolveCollectionFeed(input);

  async function pull(handleToUse: string): Promise<StockCheckResult> {
    const { total, inStock } = await pullAllPages(origin, handleToUse);
    return {
      input,
      collectionUrl: `${origin}/collections/${handleToUse}`,
      totalProducts: total,
      inStock,
      outOfStock: total - inStock,
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

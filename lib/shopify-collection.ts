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

export class StockCheckError extends Error {}

const PAGE_SIZE = 250; // Shopify's max page size for this endpoint
const MAX_PAGES = 40; // safety cap (=10,000 products) to avoid runaway loops

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

async function fetchPage(origin: string, handle: string, page: number): Promise<any[]> {
  const url = `${origin}/collections/${handle}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    throw new StockCheckError(`Could not reach ${origin} (${(err as Error).message}).`);
  }

  if (!res.ok) {
    throw new StockCheckError(
      `${origin} returned ${res.status} for collection "${handle}". It may not exist, be password-protected, or this may not be a Shopify store.`
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new StockCheckError(
      `${origin} didn't return valid product JSON — it may not be a Shopify store.`
    );
  }

  if (!Array.isArray(data.products)) {
    throw new StockCheckError(`Unexpected response shape from ${origin}.`);
  }
  return data.products;
}

/** Fetch every product in a collection (across pages) and count stock status. */
export async function checkCollectionStock(input: string): Promise<StockCheckResult> {
  const { origin, handle } = resolveCollectionFeed(input);

  let total = 0;
  let inStock = 0;
  let page = 1;

  while (page <= MAX_PAGES) {
    const products = await fetchPage(origin, handle, page);
    if (!products.length) break;

    for (const product of products) {
      total += 1;
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const hasStock = variants.some((v: any) => v.available === true);
      if (hasStock) inStock += 1;
    }

    if (products.length < PAGE_SIZE) break; // last page
    page += 1;
  }

  return {
    input,
    collectionUrl: `${origin}/collections/${handle}`,
    totalProducts: total,
    inStock,
    outOfStock: total - inStock,
  };
}

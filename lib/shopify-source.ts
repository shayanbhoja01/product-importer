// Fetches product data from any public Shopify storefront using the
// built-in `/products/{handle}.js` endpoint that every Shopify theme exposes.
// No scraping/DOM-parsing needed since Shopify serves this as structured JSON.

export interface ScrapedVariant {
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  options: string[]; // e.g. ["Small", "Red"]
}

export interface ScrapedProduct {
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  images: string[];
  optionNames: string[]; // e.g. ["Size", "Color"]
  variants: ScrapedVariant[];
  sourceUrl: string;
}

export class ScrapeError extends Error {}

/**
 * Given any Shopify product page URL, derive the store domain + handle
 * and fetch the product's public JSON representation.
 */
export async function scrapeShopifyProduct(url: string): Promise<ScrapedProduct> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ScrapeError("Not a valid URL.");
  }

  const match = parsed.pathname.match(/\/products\/([a-zA-Z0-9-_%]+)/);
  if (!match) {
    throw new ScrapeError(
      "URL doesn't look like a Shopify product page (expected /products/<handle>)."
    );
  }
  const handle = match[1];
  const jsonUrl = `${parsed.protocol}//${parsed.host}/products/${handle}.js`;

  let res: Response;
  try {
    res = await fetch(jsonUrl, {
      headers: { Accept: "application/json" },
      // Some stores are behind password protection / bot protection.
      cache: "no-store",
    });
  } catch (err) {
    throw new ScrapeError(`Could not reach the source site (${(err as Error).message}).`);
  }

  if (!res.ok) {
    throw new ScrapeError(
      `Source site returned ${res.status} for ${jsonUrl}. The product may not exist, the store may be password-protected, or it isn't a Shopify store.`
    );
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new ScrapeError(
      "Source site didn't return valid product JSON. It may not be a Shopify store."
    );
  }

  if (!data || !data.title) {
    throw new ScrapeError("Product JSON was empty or malformed.");
  }

  const images: string[] = Array.isArray(data.images)
    ? data.images.map((img: string) => (img.startsWith("//") ? `https:${img}` : img))
    : [];

  const optionNames: string[] = Array.isArray(data.options)
    ? data.options.map((o: any) => (typeof o === "string" ? o : o.name)).filter(Boolean)
    : [];

  const variants: ScrapedVariant[] = Array.isArray(data.variants)
    ? data.variants.map((v: any) => ({
        title: v.title || "Default Title",
        price: centsToAmount(v.price),
        compareAtPrice: v.compare_at_price ? centsToAmount(v.compare_at_price) : null,
        sku: v.sku || "",
        options: [v.option1, v.option2, v.option3].filter(
          (o: any) => o !== null && o !== undefined
        ),
      }))
    : [];

  return {
    title: data.title,
    descriptionHtml: data.description || "",
    vendor: data.vendor || "",
    productType: data.product_type || "",
    images,
    optionNames: optionNames.length ? optionNames : ["Title"],
    variants: variants.length
      ? variants
      : [{ title: "Default Title", price: "0.00", compareAtPrice: null, sku: "", options: [] }],
    sourceUrl: url,
  };
}

// Shopify's /products/{handle}.js always returns variant prices as an
// integer number of cents (e.g. 2500 = $25.00). Convert to a decimal string.
function centsToAmount(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "0.00";
  return (n / 100).toFixed(2);
}

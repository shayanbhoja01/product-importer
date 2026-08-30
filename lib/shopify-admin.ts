import { ScrapedProduct } from "./shopify-source";

const API_VERSION = "2024-10";

function adminEndpoint(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) {
    throw new Error("SHOPIFY_STORE_DOMAIN is not configured on the server.");
  }
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
}

async function shopifyGraphQL<T = any>(query: string, variables: Record<string, any>): Promise<T> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    throw new Error("SHOPIFY_ADMIN_TOKEN is not configured on the server.");
  }

  const res = await fetch(adminEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify Admin API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify Admin API error: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.data as T;
}

/** Search the destination store for an existing product with this exact title. */
export async function findProductByTitle(title: string): Promise<boolean> {
  const escaped = title.replace(/"/g, '\\"');
  const query = `
    query FindByTitle($query: String!) {
      products(first: 1, query: $query) {
        edges { node { id title } }
      }
    }
  `;
  const data = await shopifyGraphQL<{ products: { edges: { node: { id: string; title: string } }[] } }>(
    query,
    { query: `title:"${escaped}"` }
  );
  const edges = data.products.edges;
  // Exact (case-insensitive) title match — Shopify's search can return
  // partial/fuzzy matches, so we confirm before treating it as a duplicate.
  return edges.some((e) => e.node.title.trim().toLowerCase() === title.trim().toLowerCase());
}

function guessImageFilename(url: string, index: number): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").pop() || "";
    const ext = (last.split(".").pop() || "jpg").split("?")[0].toLowerCase();
    const safeExt = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? ext : "jpg";
    return `image-${index}.${safeExt}`;
  } catch {
    return `image-${index}.jpg`;
  }
}

/**
 * Create a product on the destination store from scraped data, with tags applied.
 * Uses the `productSet` mutation (Shopify's recommended single-call mutation for
 * syncing product data from an external source) so options, variants, and images
 * are all created together atomically.
 */
export async function createProduct(product: ScrapedProduct, tags: string[]): Promise<string> {
  const mutation = `
    mutation ImportProduct($input: ProductSetInput!, $synchronous: Boolean!) {
      productSet(synchronous: $synchronous, input: $input) {
        product { id title }
        userErrors { field message }
      }
    }
  `;

  const hasRealOptions = !(product.optionNames.length === 1 && product.optionNames[0] === "Title");

  // Build the option name -> distinct values list, preserving first-seen order.
  const optionValuesByIndex: string[][] = product.optionNames.map(() => []);
  if (hasRealOptions) {
    for (const variant of product.variants) {
      product.optionNames.forEach((_, i) => {
        const val = variant.options[i];
        if (val && !optionValuesByIndex[i].includes(val)) {
          optionValuesByIndex[i].push(val);
        }
      });
    }
  }

  const productOptions = hasRealOptions
    ? product.optionNames.map((name, i) => ({
        name,
        values: optionValuesByIndex[i].map((v) => ({ name: v })),
      }))
    : [{ name: "Title", values: [{ name: "Default Title" }] }];

  const files = product.images.map((src, i) => ({
    originalSource: src,
    filename: guessImageFilename(src, i),
    contentType: "IMAGE",
    alt: product.title,
  }));

  const variants = product.variants.map((v) => ({
    price: v.price,
    compareAtPrice: v.compareAtPrice || null,
    sku: v.sku || undefined,
    optionValues: hasRealOptions
      ? product.optionNames.map((name, i) => ({
          optionName: name,
          name: v.options[i] || optionValuesByIndex[i][0] || "Default Title",
        }))
      : [{ optionName: "Title", name: "Default Title" }],
  }));

  const input: Record<string, any> = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor || undefined,
    productType: product.productType || undefined,
    tags,
    status: process.env.IMPORT_STATUS === "ACTIVE" ? "ACTIVE" : "DRAFT",
    productOptions,
    files: files.length ? files : undefined,
    variants,
  };

  const data = await shopifyGraphQL<{
    productSet: {
      product: { id: string; title: string } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(mutation, { input, synchronous: true });

  const { product: created, userErrors } = data.productSet;
  if (userErrors && userErrors.length) {
    throw new Error(userErrors.map((e) => e.message).join("; "));
  }
  if (!created) {
    throw new Error("Product was not created and no specific error was returned by Shopify.");
  }
  return created.id;
}

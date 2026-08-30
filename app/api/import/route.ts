import { NextRequest, NextResponse } from "next/server";
import { scrapeShopifyProduct, ScrapeError } from "@/lib/shopify-source";
import { findProductByTitle, createProduct } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow generous time for multi-URL imports on Netlify

export interface ImportResult {
  url: string;
  status: "Imported" | "Already Exists" | "Failed";
  title?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: { urls?: string[]; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const urls = (body.urls || []).map((u) => u.trim()).filter(Boolean);
  const tags = (body.tags || []).map((t) => t.trim()).filter(Boolean);

  if (!urls.length) {
    return NextResponse.json({ error: "No URLs provided." }, { status: 400 });
  }
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Server is missing SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN environment variables.",
      },
      { status: 500 }
    );
  }

  const results: ImportResult[] = [];

  // Process sequentially to stay well within Shopify's API rate limits.
  for (const url of urls) {
    try {
      const product = await scrapeShopifyProduct(url);

      const exists = await findProductByTitle(product.title);
      if (exists) {
        results.push({ url, status: "Already Exists", title: product.title });
        continue;
      }

      await createProduct(product, tags);
      results.push({ url, status: "Imported", title: product.title });
    } catch (err) {
      const message = err instanceof ScrapeError ? err.message : (err as Error).message;
      results.push({ url, status: "Failed", error: message || "Unknown error." });
    }
  }

  return NextResponse.json({ results });
}

import { NextRequest, NextResponse } from "next/server";
import { checkCollectionStock, NotShopifyError, StockCheckError } from "@/lib/shopify-collection";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface StockCheckRow {
  input: string;
  status: "Done" | "Skipped" | "Failed";
  collectionUrl?: string;
  totalProducts?: number;
  inStock?: number;
  outOfStock?: number;
  countedFrom?: "storefront" | "collection-data";
  note?: string;
}

export async function POST(req: NextRequest) {
  let body: { sites?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sites = (body.sites || []).map((s) => s.trim()).filter(Boolean);
  if (!sites.length) {
    return NextResponse.json({ error: "No websites provided." }, { status: 400 });
  }

  const results: StockCheckRow[] = [];

  for (const site of sites) {
    try {
      const r = await checkCollectionStock(site);
      results.push({
        input: site,
        status: "Done",
        collectionUrl: r.collectionUrl,
        totalProducts: r.totalProducts,
        inStock: r.inStock,
        outOfStock: r.outOfStock,
        countedFrom: r.countedFrom,
        note:
          r.countedFrom === "collection-data"
            ? "Storefront page count unavailable — showing Shopify's full collection data instead."
            : undefined,
      });
    } catch (err) {
      if (err instanceof NotShopifyError) {
        // Not a Shopify store (or no matching collection found even after
        // falling back to "all") — skip it rather than counting it as a
        // hard failure, since this is an expected, normal outcome for a
        // mixed list of websites.
        results.push({ input: site, status: "Skipped", note: "Not a Shopify store — skipped." });
      } else {
        const message = err instanceof StockCheckError ? err.message : (err as Error).message;
        results.push({ input: site, status: "Failed", note: message || "Unknown error." });
      }
    }
  }

  return NextResponse.json({ results });
}

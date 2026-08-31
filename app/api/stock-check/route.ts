import { NextRequest, NextResponse } from "next/server";
import { checkCollectionStock, StockCheckError } from "@/lib/shopify-collection";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface StockCheckRow {
  input: string;
  status: "Done" | "Failed";
  collectionUrl?: string;
  totalProducts?: number;
  inStock?: number;
  outOfStock?: number;
  error?: string;
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
      });
    } catch (err) {
      const message = err instanceof StockCheckError ? err.message : (err as Error).message;
      results.push({ input: site, status: "Failed", error: message || "Unknown error." });
    }
  }

  return NextResponse.json({ results });
}

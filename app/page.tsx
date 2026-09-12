"use client";

import { useMemo, useState } from "react";
import type { ImportResult } from "./api/import/route";
import type { StockCheckRow } from "./api/stock-check/route";

type RowState = ImportResult & { pending?: boolean };
type StockRowState = StockCheckRow & { pending?: boolean };

export default function Home() {
  const [tab, setTab] = useState<"import" | "stock">("import");

  return (
    <div className="wrap">
      <div className="masthead">
        <h1>Product Importer</h1>
        <span className="tag">manifest v1</span>
      </div>

      <div className="tabs">
        <button className={`tab-btn ${tab === "import" ? "tab-btn-active" : ""}`} onClick={() => setTab("import")}>
          Import Products
        </button>
        <button className={`tab-btn ${tab === "stock" ? "tab-btn-active" : ""}`} onClick={() => setTab("stock")}>
          Check Stock Counts
        </button>
      </div>

      {tab === "import" ? <ImportTool /> : <StockCheckTool />}
    </div>
  );
}

function ImportTool() {
  const [urlsText, setUrlsText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const urls = useMemo(
    () =>
      urlsText
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean),
    [urlsText]
  );

  const tags = useMemo(
    () =>
      tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsText]
  );

  const counts = useMemo(() => {
    const c = { Imported: 0, "Already Exists": 0, Failed: 0 };
    for (const r of results) {
      if (!r.pending) c[r.status] += 1;
    }
    return c;
  }, [results]);

  async function handleImport() {
    if (!urls.length || running) return;
    setError(null);
    setRunning(true);
    setResults(urls.map((url) => ({ url, status: "Imported", pending: true } as RowState)));

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, tags }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setResults(data.results);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setRunning(false);
    }
  }

  function downloadLog() {
    if (!results.length) return;
    const header = "URL,Status,Title,Error\n";
    const rows = results
      .map((r) => {
        const cell = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
        return [cell(r.url), cell(r.status), cell(r.title || ""), cell(r.error || "")].join(",");
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `import-log-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <p className="sub">Paste Shopify product URLs, tag them, and bring them into your store.</p>

      <div className="card">
        <div className="field-block">
          <label className="field-label" htmlFor="urls">
            Product URLs
            {urls.length > 0 && <span className="count-pill">{urls.length}</span>}
          </label>
          <textarea
            id="urls"
            placeholder={"https://source-store.com/products/example-1\nhttps://source-store.com/products/example-2"}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            disabled={running}
          />
          <p className="field-hint">One URL per line. Each must be a live Shopify product page.</p>
        </div>

        <div className="field-block">
          <label className="field-label" htmlFor="tags">
            Tags
          </label>
          <input
            id="tags"
            type="text"
            placeholder="imported, wholesale, summer-2026"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            disabled={running}
          />
          <p className="field-hint">Comma-separated. Applied to every product in this batch.</p>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={handleImport} disabled={!urls.length || running}>
            {running && <span className="spinner" />}
            {running ? `Importing ${urls.length} product${urls.length === 1 ? "" : "s"}…` : "Import Products"}
          </button>
          {!!results.length && !running && (
            <button className="link-btn" onClick={downloadLog}>
              ↓ Download log (.csv)
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {!!results.length && (
        <div className="card">
          <div className="results-head">
            <h2>Results</h2>
          </div>

          <div className="manifest">
            {results.map((r, i) => (
              <div className="row" key={r.url + i}>
                <span className="row-index mono">{String(i + 1).padStart(2, "0")}</span>
                <div className="row-main">
                  <div className="row-title">{r.pending ? "Waiting for result…" : r.title || "—"}</div>
                  <div className="row-url">{r.url}</div>
                  {r.status === "Failed" && r.error && <div className="row-error">{r.error}</div>}
                </div>
                <StatusStamp result={r} />
              </div>
            ))}
          </div>

          {!running && (
            <div className="summary-strip">
              <span>
                <b>{counts.Imported}</b> imported
              </span>
              <span>
                <b>{counts["Already Exists"]}</b> already existed
              </span>
              <span>
                <b>{counts.Failed}</b> failed
              </span>
            </div>
          )}
        </div>
      )}

      {!results.length && (
        <div className="card">
          <div className="empty-state">No imports run yet. Paste URLs above to get started.</div>
        </div>
      )}

      <footer className="note">Imports create products as drafts. Review before publishing.</footer>
    </>
  );
}

function StatusStamp({ result }: { result: RowState }) {
  if (result.pending) return <span className="stamp stamp-pending">Pending</span>;
  if (result.status === "Imported") return <span className="stamp stamp-imported">Imported</span>;
  if (result.status === "Already Exists") return <span className="stamp stamp-exists">Already Exists</span>;
  return <span className="stamp stamp-failed">Failed</span>;
}

function StockCheckTool() {
  const [sitesText, setSitesText] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StockRowState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sites = useMemo(
    () =>
      sitesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [sitesText]
  );

  const counts = useMemo(() => {
    const c = { Done: 0, Skipped: 0, Failed: 0 };
    for (const r of results) {
      if (!r.pending) c[r.status] += 1;
    }
    return c;
  }, [results]);

  const totals = useMemo(() => {
    return results.reduce(
      (acc, r) => {
        if (!r.pending && r.status === "Done") {
          acc.total += r.totalProducts || 0;
          acc.inStock += r.inStock || 0;
          acc.outOfStock += r.outOfStock || 0;
        }
        return acc;
      },
      { total: 0, inStock: 0, outOfStock: 0 }
    );
  }, [results]);

  async function runChecks(indices: number[]) {
    setRunning(true);

    // Adaptive backoff: a small pause between sites by default, but if we
    // see several rate-limit failures in a row, that's the signature of a
    // shared/aggregate limit (e.g. many stores behind the same regional
    // security provider tracking our one source IP across all of them,
    // not just per-site) — so we back off much harder and longer until
    // a request succeeds again, rather than hammering into a quota that
    // isn't going to reset on its own in milliseconds.
    let consecutiveRateLimited = 0;

    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      const site = sites[i];
      let wasRateLimited = false;

      try {
        const res = await fetch("/api/stock-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sites: [site] }),
        });

        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new Error(
            res.status === 504
              ? "Timed out — this store's catalog may be too large to check in one request."
              : `Server returned an unexpected response (HTTP ${res.status}).`
          );
        }

        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        const row: StockRowState = data.results?.[0] || {
          input: site,
          status: "Failed",
          note: "No result returned.",
        };
        wasRateLimited = row.status === "Failed" && !!row.note?.includes("rate-limiting");
        setResults((prev) => prev.map((r, idx) => (idx === i ? row : r)));
      } catch (err) {
        const message = (err as Error).message;
        wasRateLimited = message.includes("rate-limiting");
        setResults((prev) =>
          prev.map((r, idx) => (idx === i ? { input: site, status: "Failed", note: message } : r))
        );
      }

      consecutiveRateLimited = wasRateLimited ? consecutiveRateLimited + 1 : 0;

      if (n < indices.length - 1) {
        // Base pause between any two sites. On top of that, once a run of
        // rate-limit failures shows up, wait substantially longer — the
        // pause grows with how many we've seen in a row, up to a cap.
        const backoffMs =
          consecutiveRateLimited >= 2
            ? Math.min(4000 * 2 ** (consecutiveRateLimited - 2), 20000)
            : 350;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    setRunning(false);
  }

  async function handleCheck() {
    if (!sites.length || running) return;
    setError(null);
    setResults(sites.map((input) => ({ input, status: "Done", pending: true } as StockRowState)));
    await runChecks(sites.map((_, i) => i));
  }

  async function retryFailed() {
    if (running) return;
    const failedIndices = results
      .map((r, i) => (r.status === "Failed" ? i : -1))
      .filter((i) => i >= 0);
    if (!failedIndices.length) return;
    setResults((prev) =>
      prev.map((r, idx) => (failedIndices.includes(idx) ? { ...r, pending: true } : r))
    );
    await runChecks(failedIndices);
  }

  function downloadLog() {
    if (!results.length) return;
    const header =
      "Website,Status,Collection Checked,Total Products,In Stock,Out of Stock,Counted From,Note\n";
    const rows = results
      .map((r) => {
        const cell = (v: string | number | undefined) =>
          `"${String(v ?? "").replace(/"/g, '""')}"`;
        return [
          cell(r.input),
          cell(r.status),
          cell(r.collectionUrl || ""),
          cell(r.totalProducts ?? ""),
          cell(r.inStock ?? ""),
          cell(r.outOfStock ?? ""),
          cell(r.countedFrom === "storefront" ? "Storefront page" : r.countedFrom === "collection-data" ? "Shopify collection data (fallback)" : ""),
          cell(r.note || ""),
        ].join(",");
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = `stock-check-log-${stamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <p className="sub">
        Paste any mix of website URLs — non-Shopify sites are automatically skipped, and counts
        match what a shopper actually sees on the store's page.
      </p>

      <div className="card">
        <div className="field-block">
          <label className="field-label" htmlFor="sites">
            Websites
            {sites.length > 0 && <span className="count-pill">{sites.length}</span>}
          </label>
          <textarea
            id="sites"
            placeholder={"https://source-store.com\nhttps://another-store.com/collections/all\nhttps://some-non-shopify-site.com"}
            value={sitesText}
            onChange={(e) => setSitesText(e.target.value)}
            disabled={running}
          />
          <p className="field-hint">
            One per line. A bare domain checks the store's "all products" collection; paste a specific
            collection URL to check just that one. Sites that aren't Shopify stores are skipped, not
            treated as errors.
          </p>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={handleCheck} disabled={!sites.length || running}>
            {running && <span className="spinner" />}
            {running ? `Checking ${sites.length} site${sites.length === 1 ? "" : "s"}…` : "Check Stock Counts"}
          </button>
          {!!results.length && !running && (
            <button className="link-btn" onClick={downloadLog}>
              ↓ Download log (.csv)
            </button>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
      </div>

      {!!results.length && (
        <div className="card">
          <div className="results-head">
            <h2>Results</h2>
            {!running && counts.Failed > 0 && (
              <button className="link-btn" onClick={retryFailed}>
                ↻ Retry {counts.Failed} failed
              </button>
            )}
          </div>

          <div className="manifest">
            {results.map((r, i) => (
              <div className="row" key={r.input + i}>
                <span className="row-index mono">{String(i + 1).padStart(2, "0")}</span>
                <div className="row-main">
                  <div className="row-title">
                    {r.pending
                      ? "Checking…"
                      : r.status === "Done"
                      ? `${r.totalProducts} total · ${r.inStock} in stock · ${r.outOfStock} out of stock`
                      : r.status === "Skipped"
                      ? "Not a Shopify store"
                      : "—"}
                  </div>
                  <div className="row-url">{r.collectionUrl || r.input}</div>
                  {r.status === "Failed" && r.note && <div className="row-error">{r.note}</div>}
                  {r.status === "Done" && r.countedFrom === "collection-data" && (
                    <div className="row-note">
                      Storefront page count unavailable — showing Shopify's raw collection data instead.
                    </div>
                  )}
                </div>
                <StockStamp result={r} />
              </div>
            ))}
          </div>

          {!running && (
            <div className="summary-strip">
              <span>
                <b>{counts.Done}</b> checked
              </span>
              <span>
                <b>{counts.Skipped}</b> skipped (not Shopify)
              </span>
              <span>
                <b>{counts.Failed}</b> failed
              </span>
              <span>
                <b>{totals.total}</b> total products
              </span>
              <span>
                <b>{totals.inStock}</b> in stock
              </span>
              <span>
                <b>{totals.outOfStock}</b> out of stock
              </span>
            </div>
          )}
        </div>
      )}

      {!results.length && (
        <div className="card">
          <div className="empty-state">No checks run yet. Paste website URLs above to get started.</div>
        </div>
      )}
    </>
  );
}

function StockStamp({ result }: { result: StockRowState }) {
  if (result.pending) return <span className="stamp stamp-pending">Pending</span>;
  if (result.status === "Done") return <span className="stamp stamp-imported">Done</span>;
  if (result.status === "Skipped") return <span className="stamp stamp-exists">Skipped</span>;
  return <span className="stamp stamp-failed">Failed</span>;
}

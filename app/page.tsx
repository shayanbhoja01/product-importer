"use client";

import { useMemo, useState } from "react";
import type { ImportResult } from "./api/import/route";

type RowState = ImportResult & { pending?: boolean };

export default function Home() {
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
    <div className="wrap">
      <div className="masthead">
        <h1>Product Importer</h1>
        <span className="tag">manifest v1</span>
      </div>
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
    </div>
  );
}

function StatusStamp({ result }: { result: RowState }) {
  if (result.pending) return <span className="stamp stamp-pending">Pending</span>;
  if (result.status === "Imported") return <span className="stamp stamp-imported">Imported</span>;
  if (result.status === "Already Exists") return <span className="stamp stamp-exists">Already Exists</span>;
  return <span className="stamp stamp-failed">Failed</span>;
}

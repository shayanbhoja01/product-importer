# Product Importer

Paste Shopify product URLs, add tags, click **Import Products** — this scrapes each
product from its source Shopify store and creates it as a **draft** product in your
destination store, with images, variants, and tags applied.

No database, no queues, no complex dashboard — just the import flow.

It also has a second tab: **Check Stock Counts** — paste any Shopify store or
collection URL and see total vs. in-stock product counts, pulled the same
no-scraping way from Shopify's public collection JSON feed.

## How it works

1. For each pasted URL, the app calls the source store's built-in
   `https://{store}/products/{handle}.js` endpoint (every Shopify storefront exposes
   this — no scraping/HTML parsing needed).
2. It checks your destination store for an existing product with the same title.
   If found, it's skipped and marked **Already Exists**.
3. Otherwise, it creates the product via Shopify's Admin GraphQL API
   (`productSet` mutation), including images, all variants, and your tags.
4. Products are created as **drafts** — review and publish them yourself in Shopify
   admin. (To import as live/active products instead, see Environment Variables below.)
5. Results show in a table you can also download as a CSV log.

## Requirements

- A **destination Shopify store** (where products get created)
- A **custom app Admin API access token** for that store, with `read_products` and
  `write_products` scopes

### Getting your Admin API token

1. In your Shopify admin: **Settings → Apps and sales channels → Develop apps**
2. **Create an app** → name it anything (e.g. "Product Importer")
3. **Configuration → Admin API scopes** → enable `read_products`, `write_products` → Save
4. **Install app**
5. **API credentials** tab → **Reveal token once** next to Admin API access token →
   copy the value starting with `shpat_...`

This token is created entirely inside your own store — never share it, and never enter
it into an authorization/OAuth screen on another website.

## Deploying to Netlify (recommended — no command line needed)

**Option A — Drag and drop:**
1. Run `npm install` then `npm run build` locally, or ask me to prepare a build for you.
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag in the project folder.
3. Once deployed, go to **Site configuration → Environment variables** and add:
   - `SHOPIFY_STORE_DOMAIN` → e.g. `2aa093-5.myshopify.com` (no `https://`, no trailing slash)
   - `SHOPIFY_ADMIN_TOKEN` → your `shpat_...` token
   - *(optional)* `IMPORT_STATUS` → set to `ACTIVE` if you want products published live
     immediately instead of created as drafts
4. Trigger a redeploy so the new environment variables take effect.

**Option B — GitHub (better for future updates):**
1. Push this project to a new GitHub repository.
2. In Netlify: **Add new site → Import an existing project** → connect the repo.
3. Netlify auto-detects Next.js — no build settings to configure.
4. Add the same environment variables as above under **Site configuration → Environment variables**.
5. Every future push to the repo auto-redeploys the site.

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in your real values
npm run dev
```

Visit `http://localhost:3000`.

## Stock Count Checker (second tab)

- Paste a bare domain (e.g. `source-store.com`) to check that store's default
  "all products" collection, or a specific collection URL
  (e.g. `source-store.com/collections/summer-sale`) to check just that one.
- Pulls every product in the collection (handles pagination automatically, up
  to 10,000 products) via Shopify's public `/collections/{handle}/products.json`
  feed — same principle as the importer, so it only works on Shopify stores.
- A product counts as "in stock" if at least one of its variants is available.
- This only reports counts — it doesn't create, modify, or import anything.

## Notes & limits

- Only works with **source URLs that are Shopify product pages** (`/products/{handle}`).
  Non-Shopify sites, password-protected stores, or pages without a matching handle will
  show as **Failed** with a reason.
- Duplicate check matches on **exact product title** (case-insensitive), per the original
  spec — titles that differ even slightly will be treated as new products.
- URLs are processed one at a time to stay within Shopify's API rate limits. Large batches
  will take a bit longer but won't fail from rate limiting.
- No data is stored anywhere — results exist only in your browser for that session.
  Download the CSV log if you want to keep a record.

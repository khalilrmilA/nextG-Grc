# GRCEye Marketing Site (Next.js 14)

The public-facing pages of grceye.com — Landing, Features, Solutions, Blog, News, FAQ, Contact.

This is a separate Next.js 14 App Router project. The existing Vite app at `../frontend/` is untouched.

## Why Next.js for the marketing site?

- **Server-side rendered metadata** — every page emits its title, description, OG tags, and canonical URL in the initial HTML, before any JavaScript runs. Best for SEO crawlers.
- **Per-page metadata** via the App Router `metadata` API.
- **Self-referencing canonicals** via `alternates.canonical` on every page.

## Pages

| Route | File |
|---|---|
| `/` | `app/page.tsx` |
| `/features-landing` | `app/features-landing/page.tsx` |
| `/solutions` | `app/solutions/page.tsx` |
| `/blog` | `app/blog/page.tsx` |
| `/news` | `app/news/page.tsx` |
| `/faq` | `app/faq/page.tsx` |
| `/contact` | `app/contact/page.tsx` |

Each `page.tsx` is a server component that exports `metadata` (title/description/canonical). The interactive content lives in a co-located `…View.tsx` client component.

## Architecture

```
        User browser → port 3000 (Next.js, this app)
                        │
                ┌───────┴────────┐
                │                │
        Public pages         /app/*, /login, /register
        (rendered here)      (proxied to Vite on 4000 via next.config.js rewrites)
                                      │
                              port 4000 (existing Vite app at ../frontend/)
                                      │
                              port 8000 (FastAPI backend, unchanged)
```

Users only ever hit port 3000. The rewrites in `next.config.js` transparently forward `/app/*`, `/login`, and `/register` to the existing Vite app, so the dashboard and auth flow keep working unchanged.

## Setup

```bash
cd marketing
npm install
cp .env.example .env.local
```

## Run (development)

```bash
npm run dev
# Next.js → http://localhost:3000
```

You also need:
- The Vite app running on port 4000 (`cd ../frontend && npm run dev -- --port 4000`)
- The FastAPI backend on port 8000 (`cd ../backend && python -m uvicorn app.main:app --reload --port 8000`)

The marketing site itself works standalone, but `/app/*` and `/login` will 502 if Vite isn't up.

## Build (production)

```bash
npm run build
npm run start
```

## Running on a server with PM2 (no terminal sessions)

```bash
npm install -g pm2
pm2 start "npm run dev" --name marketing --cwd ./marketing
pm2 start "npm run dev -- --port 4000" --name frontend --cwd ./frontend
pm2 start "python -m uvicorn app.main:app --port 8000" --name backend --cwd ./backend
pm2 save
pm2 startup
```

For production, swap `npm run dev` for `npm run build && npm run start` on the marketing and frontend apps.

## Public assets

`public/logo.png`, `public/sitemap.xml`, `public/robots.txt`, and `public/datasheets/GRCEye_Datasheet_2026.pdf` are copied from the Vite app's `public/`. If you update them in the Vite app, copy them here too — or remove from the Vite app once Next.js is the canonical entry point.

## SEO checklist (already done)

- [x] Per-page `<title>` and meta description via `export const metadata`
- [x] Self-referencing canonical via `alternates.canonical`
- [x] Open Graph tags per page (title, description, url, image)
- [x] Twitter Card tags
- [x] Organization + WebSite JSON-LD in `app/layout.tsx` (sitewide)
- [x] FAQPage JSON-LD on `/faq`
- [x] ContactPage JSON-LD on `/contact`
- [x] sitemap.xml
- [x] robots.txt

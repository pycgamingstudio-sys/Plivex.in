# Plivex

GST-ready billing and invoicing for Indian small businesses: invoices, quotations, clients (CRM), expenses, stock and team roles, in Hindi and English.

Live: https://plivex.in

## Features
- GST invoices with server-side totals, automatic invoice numbers and PDF download
- Quotations, clients, leads, expenses and stock tracking
- Team workspaces with roles: admin, manager, employee, storekeeper, accountant
- 14-day free trial and PayU subscriptions
- Hindi / English interface
- Optional AI business assistant

## Tech stack
React 18, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Supabase (auth and database).

## Getting started
npm install, then copy .env.example to .env and fill in the values, then npm run dev.

## Deploy on Netlify
1. Connect this GitHub repository to your Netlify site.
2. Build command: `npm run build`. Publish directory: `dist`.
3. Add the variables from `.env.example` under Site configuration → Environment variables.
4. Redeploy after configuration changes. `netlify.toml` includes the single-page-app redirect for React Router.

## Environment variables
See `.env.example`. Real values are never committed; configure them in Netlify. `GEMINI_API_KEY` belongs only in Supabase Edge Function secrets and must never be exposed as a `VITE_` variable.

## Project structure
- src/api: backend client
- src/components: UI and feature components
- src/lib: stores, auth, helpers, translations
- src/pages: screens
- public: static files
- scripts: maintenance helpers

## Scripts
- npm run dev: start locally
- npm run build: production build
- npm run test:membership: run unit tests

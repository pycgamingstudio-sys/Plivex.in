# Cloudflare Pages deployment (keep Netlify live)

This repository can be deployed to Cloudflare Pages as a **second, parallel deployment**. Do not disconnect or delete the existing Netlify site while testing.

## Create the Cloudflare Pages project

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Connect the GitHub repository `pycgamingstudio-sys/Plivex.in` and select the `main` branch.
3. Use these build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: repository root (leave blank/default)
4. Add the same required environment variables currently used by the working Netlify deployment under Cloudflare Pages → Settings → Environment variables. Copy the existing values securely; do not commit secrets to GitHub.

## Environment variables

Copy the existing production values for:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`
- `VITE_ASSISTANT_API_BASE_URL` (if it is used by the current deployment)

The `VITE_*` variables are included in browser-side code at build time. Never put a Supabase service-role/secret key or a Gemini API key in a `VITE_*` variable. Keep the Gemini API key in the relevant Supabase Edge Function secrets.

Do not replace API URLs with the website URL unless the backend is actually hosted there. Confirm the correct values against Netlify's existing environment-variable settings.

## SPA routes

The repository's `public/_redirects` contains:

```text
/*  /index.html  200
```

This supports client-side routes on Cloudflare Pages and is also compatible with Netlify.

## Safe cutover checklist

- First test the generated `*.pages.dev` URL; leave Netlify and `plivex.in` unchanged.
- Test sign-in/sign-out, refresh on nested routes, Supabase reads/writes, AI/assistant calls, invoices/PDF downloads, and payment return URLs.
- Check Supabase Auth redirect/allowed URLs, CORS, payment-provider allowlists, and any backend origin allowlists for the new Pages hostname.
- Only after all tests pass should you consider moving the custom domain. A DNS/domain change can affect the live site; do not change it during initial setup.
- Keep the Netlify project and deployment available as rollback until Cloudflare is verified.

A successful GitHub build alone does not prove that runtime integrations or production environment variables are correct.

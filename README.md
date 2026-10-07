# Plivex

React + Vite frontend. Backend: your own Supabase project (login, database) plus the
endpoints published on the Lovable app (`/api/public/<name>`).

Environment variables (set in Netlify, see `.env.example`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Run locally: `npm install` then `npm run dev`. Build: `npm run build`.

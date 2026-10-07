# Deploy steps

1. Netlify > Site settings > Environment variables: add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL.
2. Supabase > Authentication > URL Configuration: add your Netlify address to Site URL and Redirect URLs.
3. Supabase > Authentication > Providers > Email: Confirm email ON.
4. Deploy (use a separate branch first, test, then merge to main).

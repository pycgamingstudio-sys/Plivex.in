# assistant-chat deployed source

The currently deployed Supabase Edge Function uses `source/index.ts` as its entrypoint and imports the sibling `_shared/*.mjs` modules.

Keep this source tree in version control together. The root `index.ts` is a legacy repository file and is **not** a faithful snapshot of deployed version 83.

Before deploying this function, use the explicit entrypoint `source/index.ts` and include every file under `_shared/`. Do not deploy the legacy root `index.ts` as a replacement. The repository test suite checks that all relative imports resolve.

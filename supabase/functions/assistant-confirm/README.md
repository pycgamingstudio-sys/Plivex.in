# assistant-confirm deployed source

This directory contains the exact deployed Supabase Edge Function v24 source snapshot.

The deployed entrypoint is `source/index.ts`; its local `_shared/*.mjs` imports are required. The root `index.ts` is a legacy repository version and must not be used to replace the deployed function without a reviewed migration of behavior.

Deploy only with explicit `source/index.ts` entrypoint and all local shared files included.

# Phase 2 — Assistant confirmation split (branch-only)

**Branch:** `remove-lovable`  
**Status:** Source changes committed to the branch; not deployed to Supabase or Netlify. Production behavior is unchanged.

## Changes committed

1. `supabase/functions/assistant-chat/index.ts`
   - Captured from the currently deployed `assistant-chat` source for a reviewable branch copy.
   - Removed the `mode: "confirm_action"` write path and its direct insert helper.
   - Added an explicit CORS allowlist for:
     - `https://plivex.in`
     - `https://www.plivex.in`
     - `https://plivex.netlify.app`
   - Rejects requests with an unapproved Origin. The wrapper sets the matching allowlisted Origin on normal and preflight responses.
   - Keeps chat proposals separate from record creation.

2. `supabase/functions/assistant-confirm/index.ts`
   - Added a separate confirmation endpoint.
   - Verifies the caller through Supabase Auth using the bearer token; derives workspace ID from the verified user's `profiles` row.
   - Uses the user's authenticated Supabase client, not a service-role key, so existing RLS policies remain in force.
   - Allows only the five currently proposed action types: client, expense, lead, stock item, quotation.
   - Validates/normalizes action input and restricts CORS to the same three production frontend origins.

3. `src/components/AssistantWidget.jsx`
   - The Confirm & Add button now invokes `assistant-confirm`, not `assistant-chat` with `mode: "confirm_action"`.
   - Retry continues to retry the confirmation endpoint for a failed confirmation.

## Verification status

- [x] Branch-only commits created.
- [x] Source-level guard confirms the `assistant-chat` copy no longer contains the inline `confirm_action` branch or the old wildcard CORS setting.
- [ ] Type-check/lint/build not run in this environment.
- [ ] No Edge Function deployed; `assistant-confirm` must be deployed before this frontend branch can use it.
- [ ] Need test cases for unauthenticated requests, each allowed Origin, rejected Origin, each action type, malformed action, and role/RLS rejection.
- [ ] Need verify the existing Supabase RLS policies match the expected role permissions for all five insert tables; no policies were changed.
- [ ] Do not merge to `main`, deploy functions, or switch production traffic without explicit approval.

## Important boundary

This is a focused assistant-confirmation fix, not completion of the entire Lovable backend migration. The remaining API endpoints, email-provider replacement, PayU test flow, backend source parity, and full integration tests are still outstanding. No database schema, RLS policy, DB function, or user data was changed.

# Plivex Phase 3 — UI/UX QA scope

This change set is a presentation-layer refinement for the unified Plivex workspace.

## Reviewed surfaces
- Dashboard summary cards, activity panels, quick actions and plan status
- Shared page headers, form controls, focus states and empty states
- Sales, CRM, stock, purchase and reports table/card surfaces
- Invoice desk editing layout, A4 preview frame and invoice design selection
- Workspace onboarding, authentication and loading states
- Guest landing page, About content and Free/Basic/Pro pricing
- Settings, business profile and workspace identity header

## Product guardrails
- Preserve the existing Plivex violet identity and the distinct colour families of business cards.
- Keep country-aware tax, locale, currency and payment capabilities accurately described.
- Present one Plivex product and one consistent workspace identity.
- Do not change primary/bottom navigation, route order, labels or More placement.
- Do not change payment logic, database schema, customer records or production data.

## Validation checklist
- [ ] CI membership and global regression suites
- [ ] ESLint and TypeScript checks
- [ ] Production and unified single-app builds
- [ ] Migration validation and isolated database replay
- [ ] Manual visual review at desktop, tablet and narrow Android widths
- [ ] Review the deployment preview before merge

The automated checks are run by GitHub Actions. A manual browser/device visual review remains a separate owner review step; this document does not claim that review has already been performed.

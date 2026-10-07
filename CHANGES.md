# What changed (new backend, full version)

Login, signup, password reset, team/invites, payments, trial lock AND all business data now use the new backend.

Server-backed (shared across devices, per workspace):
invoices (totals, number and stock change calculated by the server), quotations, clients, expenses, stock, services, leads, business profile.

Still in the browser only (no server table yet): quick templates, activity feed, payment-logs page, settings, invoice drafts, UTR reference / reminder settings on an invoice.

Switched off for now: Google sign-in, payment-reminder emails, staff presence card, invite emails (share the invite code yourself).

Behaviour changes:
- Invoice number is assigned by the server (INV-001, INV-002...).
- Deleting an invoice marks it Cancelled (it stays listed, excluded from revenue totals).
- Demo data is no longer created; every workspace starts empty.
- Invoices cannot be imported from CSV (create them in the invoice builder).
- Role rules are enforced by the server; a blocked change shows a "Could not save" message.

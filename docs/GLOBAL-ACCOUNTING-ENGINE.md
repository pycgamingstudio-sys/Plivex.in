# Plivex Global Accounting Engine

## Scope

The accounting engine is additive and isolated in the private `global` schema. It does not read, modify, or migrate India edition business tables. Amounts are stored as integer minor currency units.

## Chart of accounts

Every new Global workspace receives a standard chart of accounts. Existing Global workspaces receive only missing standard account definitions; no opening balances or financial entries are fabricated.

| Code | Account | Class | Normal balance |
|---|---|---|---|
| 1000 | Cash on Hand | Asset | Debit |
| 1010 | Bank Account | Asset | Debit |
| 1100 | Accounts Receivable | Asset | Debit |
| 1200 | Inventory | Asset | Debit |
| 2000 | Accounts Payable | Liability | Credit |
| 2100 | Tax Payable | Liability | Credit |
| 3000 | Owner Equity | Equity | Credit |
| 3100 | Retained Earnings | Equity | Credit |
| 4000 | Sales Revenue | Revenue | Credit |
| 4100 | Other Income | Revenue | Credit |
| 5000 | Cost of Goods Sold | Expense | Debit |
| 6000 | Operating Expenses | Expense | Debit |
| 6100 | Bank & Payment Fees | Expense | Debit |

## Posting rules

- A posted journal has 2–100 lines, all for one workspace and its base currency.
- Every line has exactly one positive debit or credit.
- Total debits must equal total credits exactly.
- Posting checks active workspace membership, role, active account ownership, currency, request fingerprint, and idempotency key.
- Journal headers and lines are append-only. Corrections must be new reversing/correcting entries.
- Authenticated users can read their workspace ledger through RLS; journal writes are server-side only.
- The `global-accounting` Edge Function exposes posting and report actions with input validation.

## Automatic source journals

The source transaction and journal post in the same database transaction:

- Invoice changes from draft to issued: debit Accounts Receivable; credit Sales Revenue and, when present, Tax Payable.
- Invoice payment recorded against a payable invoice: debit Cash or Bank; credit Accounts Receivable.
- Expense created: debit Operating Expenses; credit Cash or Bank.

An accounting failure aborts the source write, avoiding a business record that has no corresponding journal. Financial fields on an accounted expense cannot be edited or deleted; use a correcting journal instead.

## Part 3B: purchasing, refunds and foreign-currency payables

- Supplier purchase bills are created as drafts and explicitly posted by an authorized accounting role.
- Purchase bills retain source-currency totals, functional-currency totals, FX rate numerator/denominator, rate date and rate source. The functional-currency conversion is checked against each line and tax component.
- Posting a purchase bill creates an inventory debit, a recoverable-tax asset debit only for the explicitly designated recoverable amount, and an accounts-payable credit. Non-recoverable purchase tax is capitalized into inventory cost.
- Posting also creates stock receipt movements and updates stock quantities in the same transaction as the journal.
- Supplier payments retain payment-date FX evidence. The payable is settled at its current carrying value; the difference between carrying value and actual cash paid posts to realized FX gain or loss.
- Open foreign-currency supplier payables can be revalued at a supplied period-end rate. The change posts to unrealized FX gain or loss and updates the payable carrying value. Revaluations are append-only and idempotent.
- Refunds automatically debit Sales Returns & Allowances and reverse the proportional tax payable component, with a credit to cash/bank. Cumulative tax rounding is reconciled across partial refunds.
- New accounts include Recoverable Purchase Tax, Sales Returns & Allowances, Foreign Exchange Gain and Foreign Exchange Loss.

## Reports

- Trial balance by account and date range.
- General ledger by account, including chronological running balance.
- Income statement for a selected period.
- Balance sheet as of a selected date, including unclosed earnings and a balance check.

## Explicit limitations

- Posting and reports currently use the workspace base currency only. Foreign-currency conversion, FX gain/loss accounting, and multi-currency revaluation are not inferred.
- No opening balances are created automatically; they require reviewed, balanced opening journal entries.
- Refunds and purchases are not yet automatically journal-posted. Refund tax allocation and purchase/stock valuation need dedicated reviewed workflows before they can affect financial statements.
- The first release is an accounting ledger foundation, not a claim of jurisdiction-specific statutory accounting or tax compliance.

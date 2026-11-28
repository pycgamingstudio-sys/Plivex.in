import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "supabase/recovered_remote_migrations/manifest.json"), "utf8"));
const fail = (message) => { console.error("FAIL:", message); process.exit(1); };
const history = manifest.recovered_historical_sources || [];
const missing = manifest.recovered_missing_sources || [];
const pairs = manifest.basename_matches || [];
const normalized = pairs.filter((x) => x.normalized_sql_match === true);
const localOnly = manifest.local_only_files || [];

if (manifest.remote_ledger_entries !== 52 || history.length !== 39 || missing.length !== 37
  || manifest.local_migration_files !== 123 || pairs.length !== 17
  || normalized.length !== 13 || pairs.length - normalized.length !== 4 || localOnly.length !== 106) {
  fail("Migration reconciliation counts differ from the reviewed archive with 52 remote entries, 39 historical sources and 106 local-only migrations");
}
if (new Set(history.map((x) => x.version)).size !== 39) fail("Duplicate archived remote migration version");

for (const entry of history) {
  const path = resolve(root, entry.path);
  if (!existsSync(path)) fail("Missing archived SQL: " + entry.path);
  const content = readFileSync(path);
  const sha = createHash("sha1").update(Buffer.from("blob " + content.length + "\0")).update(content).digest("hex");
  if (sha !== entry.blob_sha) fail("Archived SQL Git blob hash mismatch: " + entry.path);
}
if (manifest.recovered_missing_sources_count !== missing.length) fail("Recovered missing-source count does not match the manifest");
for (const entry of missing) {
  const path = resolve(root, entry.path);
  if (!existsSync(path)) fail("Missing recovered remote SQL: " + entry.path);
  const content = readFileSync(path);
  const sha = createHash("sha1").update(Buffer.from("blob " + content.length + "\0")).update(content).digest("hex");
  if (sha !== entry.blob_sha) fail("Recovered remote SQL Git blob hash mismatch: " + entry.path);
}
for (const entry of pairs) if (!existsSync(resolve(root, entry.local_path))) fail("Missing local migration: " + entry.local_path);
for (const name of localOnly) if (!existsSync(resolve(root, "supabase/migrations", name))) fail("Missing local-only migration: " + name);

const remotePlan = [
  ...history.map((x) => ({ version: x.version, path: x.path, kind: "remote-archive" })),
  ...normalized.map((x) => ({ version: x.remote_version, path: x.local_path, kind: "normalized-local-match" })),
].sort((a, b) => a.version.localeCompare(b.version));
if (remotePlan.length !== 52 || new Set(remotePlan.map((x) => x.version)).size !== 52) fail("Remote replay plan is not 52 unique versions");

const localPaths = [...pairs.map((x) => x.local_path), ...localOnly.map((x) => "supabase/migrations/" + x)];
const candidatePlan = [
  ...missing.map((x) => ({ version: x.version, path: x.path, kind: "recovered-history" })),
  ...localPaths.map((path) => {
    const match = basename(path).match(/^(\d{12,14})_/);
    if (!match) fail("Unsortable local migration filename: " + path);
    return { version: match[1], path, kind: "current-local" };
  }),
].sort((a, b) => a.version.localeCompare(b.version));
if (candidatePlan.length !== 160 || new Set(candidatePlan.map((x) => x.path)).size !== 160) {
  fail("Candidate replay plan must contain 37 recovered historical and all 123 current local migrations");
}

function run(command, args, env, input) {
  const result = spawnSync(command, args, { cwd: root, env, input, encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(command + " failed: " + result.status);
  }
  return result.stdout || "";
}
function envFor(port, database = "postgres") {
  return { ...process.env, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: process.env.PGUSER || "supabase_admin", PGPASSWORD: "postgres", PGDATABASE: database };
}
function psql(port, db, args, input) {
  return run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", db, ...args], envFor(port, db), input);
}
function query(port, db, sql) {
  return psql(port, db, ["-A", "-t", "-c", sql]).trim();
}
function resetDb(port) {
  // Each disposable container is created with a fresh replay database already
  // selected as pg_cron's database. Do not drop it: pg_cron holds a connection.
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/migration-replay-bootstrap.sql")]);
}
function replay(port, plan, applyRemoteCompatibilityBridge = false) {
  let seeded = false;
  let compatibilityBridgeApplied = false;
  for (const entry of plan) {
    console.log("APPLY", entry.version, entry.kind, entry.path);
    psql(port, "plivex_migration_replay", ["-f", resolve(root, entry.path)]);
    if (entry.version === "20261025030833") {
      psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/migration-replay-preexisting-functions.sql")]);
    }
    if (applyRemoteCompatibilityBridge && entry.version === "20261027143138") {
      // The read-only production snapshot already has Pro-first current_plan
      // ordering, while the archived 20261025030902 source does not. Reapply
      // the local-only compatibility migration in this disposable replay to
      // reconstruct the observed function state without altering the archive.
      console.log("APPLY COMPATIBILITY BRIDGE 202610280004 (disposable database only)");
      psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/migrations/202610280004_fix_overlapping_subscription_tier_priority.sql")]);
      compatibilityBridgeApplied = true;
    }
    if (entry.version === "20261112071603") {
      psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/migration-replay-seed-india.sql")]);
      seeded = true;
    }
  }
  if (!seeded) fail("India sentinel was not seeded after the historical base schema");
  if (applyRemoteCompatibilityBridge && !compatibilityBridgeApplied) {
    fail("Remote compatibility bridge was not applied at the expected migration boundary");
  }
}
function assertRls(port, includeGlobal) {
  const required = ["profiles","subscriptions","payment_logs","plan_limits","plan_features","usage_counters","assistant_action_batches","invoice_share_links"];
  if (includeGlobal) required.push("payment_refunds","invoice_share_rate_limits");
  const values = required.map((name) => "('" + name + "')").join(",");
  const unsafe = query(port, "plivex_migration_replay", `
    SELECT string_agg(required.table_name, ',')
    FROM (VALUES ${values}) AS required(table_name)
    WHERE to_regclass('public.' || required.table_name) IS NULL
       OR NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
                        WHERE c.oid = to_regclass('public.' || required.table_name)), false);
  `);
  if (unsafe) fail("Required public tables missing or without RLS: " + unsafe);
}
function assertGlobalFoundation(port) {
  const missing = query(port, "plivex_migration_replay", "SELECT string_agg(t.name, ',') FROM (VALUES ('workspaces'),('user_profiles'),('workspace_members'),('business_profiles'),('clients'),('products'),('stock_levels'),('stock_movements'),('invoices'),('invoice_items'),('invoice_payments'),('expenses'),('quotations'),('quotation_items')) AS t(name) WHERE to_regclass('global.' || t.name) IS NULL OR NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('global.' || t.name)), false);");
  if (missing) fail("Global foundation tables missing or RLS disabled: " + missing);
  const usage = query(port, "plivex_migration_replay", "SELECT has_schema_privilege('authenticated','global','USAGE')::text || '|' || has_schema_privilege('anon','global','USAGE')::text;");
  if (usage !== "true|false") fail("Global schema grants are not least-privilege: " + usage);
  const inventoryCatalog = query(port, "plivex_migration_replay", "SELECT (to_regprocedure('public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='stock_movements' AND column_name='idempotency_key')::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_products_create_stock_level' AND NOT tgisinternal)::text");
  if (inventoryCatalog !== "true|true|true") fail("Global inventory RPC, idempotency column or product stock trigger missing: " + inventoryCatalog);
  if (query(port, "plivex_migration_replay", "SELECT has_function_privilege('authenticated','public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)','EXECUTE')::text || '|' || has_function_privilege('service_role','public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)','EXECUTE')::text") !== "false|true") fail("Global inventory RPC is not service-role-only");
  const invoiceCatalog = query(port, "plivex_migration_replay", "SELECT (to_regprocedure('public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_record_invoice_payment(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='invoices' AND column_name='creation_idempotency_key')::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='invoice_payments' AND column_name='idempotency_key')::text");
  if (invoiceCatalog !== "true|true|true|true") fail("Global invoice/payment ledger RPC or idempotency columns missing: " + invoiceCatalog);
  const fxExpenseCatalog = query(port, "plivex_migration_replay", "SELECT (to_regprocedure('public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamp with time zone,text)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='expenses' AND column_name='transaction_amount_minor')::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='expenses' AND column_name='fx_snapshot_id')::text || '|' || EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='global' AND indexname='global_expenses_idempotency_idx')::text");
  if (fxExpenseCatalog !== "true|true|true|true") fail("Global multi-currency expense RPC, provenance columns or idempotency index missing: " + fxExpenseCatalog);
  const taxAuditCatalog = query(port, "plivex_migration_replay", "SELECT (to_regprocedure('public.global_publish_tax_rule_version(uuid,text)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='global' AND table_name='tax_calculation_audit')::text");
  if (taxAuditCatalog !== "true|true|true") fail("Global tax-rule publication or append-only tax audit storage missing: " + taxAuditCatalog);
  const quotationCatalog = query(port, "plivex_migration_replay", "SELECT (to_regclass('global.quotations') IS NOT NULL)::text || '|' || (to_regclass('global.quotation_items') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='quotations' AND column_name='creation_fingerprint')::text || '|' || COALESCE((SELECT relrowsecurity::text FROM pg_class WHERE oid='global.quotations'::regclass),'false')");
  if (quotationCatalog !== "true|true|true|true|true") fail("Global quotation tables, fingerprint, RLS or RPC missing: " + quotationCatalog);
  const quotationPrivileges = query(port, "plivex_migration_replay", "SELECT has_table_privilege('anon','global.quotations','SELECT')::text || '|' || has_table_privilege('authenticated','global.quotations','SELECT')::text || '|' || has_function_privilege('anon','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE')::text || '|' || has_function_privilege('authenticated','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE')::text || '|' || has_function_privilege('service_role','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)','EXECUTE')::text");
  if (quotationPrivileges !== "false|false|false|false|true") fail("Global quotation data/RPC privileges are not service-role-only: " + quotationPrivileges);
  const quotationTaxPrivileges = query(port, "plivex_migration_replay", "SELECT has_function_privilege('anon','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)','EXECUTE')::text || '|' || has_function_privilege('authenticated','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)','EXECUTE')::text || '|' || has_function_privilege('service_role','public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)','EXECUTE')::text || '|' || (position('auth.role()' in lower(pg_get_functiondef('public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)'::regprocedure))) > 0)::text || '|' || (position('service_role' in lower(pg_get_functiondef('public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid,bigint,jsonb)'::regprocedure))) > 0)::text");
  if (quotationTaxPrivileges !== "false|false|true|true|true") fail("Tax-aware quotation RPC is not restricted to the trusted server role: " + quotationTaxPrivileges);
  const workspacePolicyShape = query(port, "plivex_migration_replay", "SELECT (SELECT count(*) FROM pg_policies WHERE (schemaname,tablename) IN (('global','approval_policies'),('global','workspace_branches'),('public','purchase_orders'),('public','warehouses')) AND cmd='ALL')::text || '|' || (SELECT count(*) FROM pg_policies WHERE policyname IN ('global_approval_policies_admin_read','global_branches_member_read','purchase orders read','warehouses read'))::text || '|' || (SELECT count(*) FROM pg_policies WHERE policyname IN ('global_approval_policies_admin_insert','global_approval_policies_admin_update','global_approval_policies_admin_delete','global_branches_admin_insert','global_branches_admin_update','global_branches_admin_delete','purchase orders insert','purchase orders update','purchase orders delete','warehouses insert','warehouses update','warehouses delete'))::text");
  if (workspacePolicyShape !== "0|4|12") fail("Workspace RLS policy split did not preserve read and role-scoped write policies: " + workspacePolicyShape);
  const shareCatalog = query(port, "plivex_migration_replay", "SELECT (to_regclass('global.invoice_share_links') IS NOT NULL)::text || '|' || (to_regclass('global.invoice_share_rate_limits') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_create_invoice_share(uuid,uuid,uuid,text,timestamp with time zone)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_resolve_invoice_share(text)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_check_invoice_share_rate_limit(text,integer,integer)') IS NOT NULL)::text || '|' || COALESCE((SELECT relrowsecurity::text FROM pg_class WHERE oid='global.invoice_share_rate_limits'::regclass),'false')");
  if (shareCatalog !== "true|true|true|true|true|true") fail("Global secure invoice share tables, RLS or RPCs missing: " + shareCatalog);
  const sharePrivileges = query(port, "plivex_migration_replay", "SELECT has_table_privilege('anon','global.invoice_share_rate_limits','SELECT')::text || '|' || has_table_privilege('authenticated','global.invoice_share_rate_limits','SELECT')::text || '|' || has_function_privilege('anon','public.global_check_invoice_share_rate_limit(text,integer,integer)','EXECUTE')::text || '|' || has_function_privilege('authenticated','public.global_check_invoice_share_rate_limit(text,integer,integer)','EXECUTE')::text || '|' || has_function_privilege('service_role','public.global_check_invoice_share_rate_limit(text,integer,integer)','EXECUTE')::text");
  if (sharePrivileges !== "false|false|false|false|true") fail("Global invoice share rate limit privileges are not service-role-only: " + sharePrivileges);
  console.log("PASS Global foundation table/RLS/grant and inventory RPC catalog assertions");
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-isolation-foundation.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-owner-provisioning.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-business-data.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-invoice-ledger.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-accounting.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-accounting-part3b.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/india-compliance-records.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-multicurrency-expense.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-tax-audit.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-enterprise-controls.integration.sql")]);
  const approvalCatalog = query(port, "plivex_migration_replay", "SELECT (to_regclass('global.approval_policies') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='approval_requests' AND column_name='consumed_at')::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_expense_approval_gate' AND NOT tgisinternal)::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_invoice_issue_approval_gate' AND NOT tgisinternal)::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_invoice_payment_approval_gate' AND NOT tgisinternal)::text || '|' || (to_regprocedure('public.global_set_approval_policy(uuid,uuid,text,boolean,bigint,text[],boolean)') IS NOT NULL)::text");
  if (approvalCatalog !== "true|true|true|true|true|true") fail("Part 9 approval policies, triggers or policy RPC missing: " + approvalCatalog);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-expense-approval-gates.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-invoice-approval-gates.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-quotations.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-quotation-wrapper-auth.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/document-ocr-worker.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-part4-resource-list.integration.sql")]);
}
function applyForcedMigrationRollback(port, db, migrationPath) {
  const migration = readFileSync(migrationPath, "utf8")
    .replace(/(^|\n)begin;\s*/i, "$1")
    .replace(/\ncommit;\s*$/i, "");
  const forcedRollback = "BEGIN;\n" + migration +
    "\nDO $global_rollback$ BEGIN RAISE EXCEPTION 'intentional Global migration rollback verification'; END $global_rollback$;\n";
  return spawnSync("psql", ["-X","-v","ON_ERROR_STOP=1","-d",db], {
    cwd: root, env: envFor(port, db), input: forcedRollback, encoding: "utf8",
  });
}
function assertGlobalMigrationRollback(port) {
  const db = "plivex_global_rollback";
  const create = spawnSync("createdb", ["-h","127.0.0.1","-p",String(port),"-U",process.env.PGUSER || "supabase_admin",db], {
    cwd: root, env: envFor(port, "postgres"), encoding: "utf8",
  });
  if (create.status !== 0) fail("Could not create isolated Global migration rollback database: " + (create.stderr || ""));
  try {
    psql(port, db, ["-f", resolve(root, "supabase/tests/migration-replay-bootstrap.sql")]);
    const foundationPath = resolve(root, "supabase/migrations/202611150001_global_isolation_foundation.sql");
    const provisioningPath = resolve(root, "supabase/migrations/202611150002_global_owner_provisioning.sql");
    const businessDataPath = resolve(root, "supabase/migrations/202611150003_global_business_data_foundation.sql");
    const businessRpcPath = resolve(root, "supabase/migrations/202611150004_global_business_records_rpc.sql");
    const businessProfilePath = resolve(root, "supabase/migrations/202611150005_global_business_profile_records.sql");

    const foundationRollback = applyForcedMigrationRollback(port, db, foundationPath);
    if (foundationRollback.status === 0) fail("Global foundation migration rollback probe unexpectedly committed");
    if (query(port, db, "SELECT to_regnamespace('global') IS NOT NULL") !== "f") {
      fail("Global foundation rollback left the global schema behind");
    }

    // Reapply the foundation, then force a failure inside the owner-provisioning migration.
    psql(port, db, ["-f", foundationPath]);
    const provisioningRollback = applyForcedMigrationRollback(port, db, provisioningPath);
    if (provisioningRollback.status === 0) fail("Global owner-provisioning migration rollback probe unexpectedly committed");
    const residue = query(port, db, "SELECT (to_regprocedure('public.global_get_auth_context(uuid)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_provision_owner_workspace(uuid,text,text,text,text,text)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_update_user_profile(uuid,text,text,text)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='user_profiles' AND column_name='phone')::text");
    if (residue !== "false|false|false|false") fail("Global owner-provisioning rollback left functions or columns behind: " + residue);

    // Apply the two prerequisites, then force a failure after all business tables,
    // policies, indexes and triggers have been created.
    psql(port, db, ["-f", foundationPath]);
    psql(port, db, ["-f", provisioningPath]);
    const businessRollback = applyForcedMigrationRollback(port, db, businessDataPath);
    if (businessRollback.status === 0) fail("Global business-data migration rollback probe unexpectedly committed");
    const businessResidue = query(port, db, "SELECT string_agg(t.name, ',') FROM (VALUES ('clients'),('products'),('stock_levels'),('stock_movements'),('invoices'),('invoice_items'),('invoice_payments'),('expenses')) AS t(name) WHERE to_regclass('global.' || t.name) IS NOT NULL");
    if (businessResidue) fail("Global business-data rollback left tables behind: " + businessResidue);

    // Reapply the three prerequisites, then force a failure after the private RPC is created.
    psql(port, db, ["-f", foundationPath]);
    psql(port, db, ["-f", provisioningPath]);
    psql(port, db, ["-f", businessDataPath]);
    const rpcRollback = applyForcedMigrationRollback(port, db, businessRpcPath);
    if (rpcRollback.status === 0) fail("Global business-records RPC migration rollback probe unexpectedly committed");
    const rpcResidue = query(port, db, "SELECT (to_regprocedure('public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer)') IS NOT NULL)::text");
    if (rpcResidue !== "false") fail("Global business-records RPC rollback left its function behind: " + rpcResidue);

    // Apply the original RPC, then force a failure in the forward-only profile extension.
    psql(port, db, ["-f", businessRpcPath]);
    const profileRollback = applyForcedMigrationRollback(port, db, businessProfilePath);
    if (profileRollback.status === 0) fail("Global business-profile migration rollback probe unexpectedly committed");
    const profileResidue = query(port, db, "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='business_profiles' AND column_name='tax_registration_effective_from')::text || '|' || (pg_get_functiondef('public.global_business_records(uuid,uuid,text,text,uuid,jsonb,integer)'::regprocedure) LIKE '%when ''business_profiles''%')::text");
    if (profileResidue !== "false|false") fail("Global business-profile rollback left its column or RPC changes behind: " + profileResidue);
    // The inventory extension must roll back its idempotency column, trigger and RPC atomically.
    psql(port, db, ["-f", businessProfilePath]);
    const triggerPrivilegesPath = resolve(root, "supabase/migrations/202611150006_global_trigger_function_privileges.sql");
    psql(port, db, ["-f", triggerPrivilegesPath]);
    const inventoryPath = resolve(root, "supabase/migrations/202611150007_global_inventory_movement_rpc.sql");
    const inventoryRollback = applyForcedMigrationRollback(port, db, inventoryPath);
    if (inventoryRollback.status === 0) fail("Global inventory migration rollback probe unexpectedly committed");
    const inventoryResidue = query(port, db, "SELECT (to_regprocedure('public.global_record_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='stock_movements' AND column_name='idempotency_key')::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_products_create_stock_level' AND NOT tgisinternal)::text");
    if (inventoryResidue !== "false|false|false") fail("Global inventory rollback left its function, column or trigger behind: " + inventoryResidue);
    // Apply inventory, then verify the invoice/payment ledger migration rolls back all DDL atomically.
    psql(port, db, ["-f", inventoryPath]);
    const invoiceLedgerPath = resolve(root, "supabase/migrations/202611150008_global_invoice_draft_and_payment_ledger.sql");
    const invoiceLedgerRollback = applyForcedMigrationRollback(port, db, invoiceLedgerPath);
    if (invoiceLedgerRollback.status === 0) fail("Global invoice/payment migration rollback probe unexpectedly committed");
    const invoiceLedgerResidue = query(port, db, "SELECT (to_regprocedure('public.global_create_invoice_draft(uuid,uuid,uuid,text,date,date,text,jsonb,uuid)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_record_invoice_payment(uuid,uuid,uuid,bigint,text,date,text,text,text,uuid)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='invoices' AND column_name='creation_idempotency_key')::text || '|' || EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='global' AND indexname='global_invoices_creation_idempotency_idx')::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='invoice_payments' AND column_name='idempotency_key')::text || '|' || EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='global' AND indexname='global_invoice_payments_idempotency_idx')::text");
    if (invoiceLedgerResidue !== "false|false|false|false|false|false") fail("Global invoice/payment rollback left functions, columns or indexes behind: " + invoiceLedgerResidue);
    // Part 7 migrations are independently replayed and transactionally rolled back.
    const enterprisePath = resolve(root, "supabase/migrations/20261116120000_global_enterprise_controls.sql");
    const taxAuditPath = resolve(root, "supabase/migrations/20261116121000_global_tax_audit_and_publication.sql");
    const fxExpensePath = resolve(root, "supabase/migrations/20261116122000_global_multicurrency_expenses.sql");
    const enterpriseHardeningPath = resolve(root, "supabase/migrations/20261116123000_global_enterprise_hardening.sql");
    psql(port, db, ["-f", enterprisePath]);
    const taxAuditRollback = applyForcedMigrationRollback(port, db, taxAuditPath);
    if (taxAuditRollback.status === 0) fail("Global tax-audit migration rollback probe unexpectedly committed");
    const taxAuditResidue = query(port, db, "SELECT (to_regprocedure('public.global_publish_tax_rule_version(uuid,text)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_append_tax_calculation_audit(uuid,uuid,uuid,integer,jsonb)') IS NOT NULL)::text || '|' || (to_regclass('global.tax_calculation_audit') IS NOT NULL)::text");
    if (taxAuditResidue !== "false|false|false") fail("Global tax-audit rollback left functions or table behind: " + taxAuditResidue);
    psql(port, db, ["-f", taxAuditPath]);
    const fxRollback = applyForcedMigrationRollback(port, db, fxExpensePath);
    if (fxRollback.status === 0) fail("Global multi-currency expense migration rollback probe unexpectedly committed");
    const fxResidue = query(port, db, "SELECT (to_regprocedure('public.global_create_expense_with_fx(uuid,uuid,text,text,bigint,text,date,uuid,numeric,numeric,text,text,timestamp with time zone,text)') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='expenses' AND column_name='transaction_amount_minor')::text");
    if (fxResidue !== "false|false") fail("Global FX expense rollback left its RPC or columns behind: " + fxResidue);
    psql(port, db, ["-f", fxExpensePath]);
    const enterpriseHardeningRollback = applyForcedMigrationRollback(port, db, enterpriseHardeningPath);
    if (enterpriseHardeningRollback.status === 0) fail("Global enterprise hardening migration rollback probe unexpectedly committed");
    const hardeningResidue = query(port, db, "SELECT (to_regprocedure('public.global_can_export(uuid,uuid,text)') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_cancel_approval_request(uuid,uuid,uuid)') IS NOT NULL)::text || '|' || (SELECT position('DELETE' in pg_get_triggerdef(t.oid)) > 0 FROM pg_trigger t WHERE t.tgname='audit_events_immutable')::text");
    if (hardeningResidue !== "false|false|false") fail("Global enterprise hardening rollback left functions or trigger changes behind: " + hardeningResidue);
    psql(port, db, ["-f", enterpriseHardeningPath]);
    // The manager-expense migration replaces the accounting RPC, so its rollback
    // probe must start from the real pre-Part-9 accounting function definition.
    const accountingPath = resolve(root, "supabase/migrations/20261116100000_global_accounting_double_entry.sql");
    psql(port, db, ["-f", accountingPath]);
    const approvalPath = resolve(root, "supabase/migrations/20261116170000_part9_expense_approval_gates.sql");
    const managerExpenseAccountingPath = resolve(root, "supabase/migrations/202611170002_part9_manager_expense_accounting.sql");
    const approvalRollback = applyForcedMigrationRollback(port, db, approvalPath);
    if (approvalRollback.status === 0) fail("Part 9 approval-gates migration rollback probe unexpectedly committed");
    const approvalResidue = query(port, db, "SELECT (to_regclass('global.approval_policies') IS NOT NULL)::text || '|' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='global' AND table_name='approval_requests' AND column_name='consumed_at')::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_expense_approval_gate' AND NOT tgisinternal)::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_invoice_issue_approval_gate' AND NOT tgisinternal)::text || '|' || EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='global_invoice_payment_approval_gate' AND NOT tgisinternal)::text || '|' || (to_regprocedure('public.global_set_approval_policy(uuid,uuid,text,boolean,bigint,text[],boolean)') IS NOT NULL)::text");
    if (approvalResidue !== "false|false|false|false|false|false") fail("Part 9 approval-gates rollback left schema objects behind: " + approvalResidue);
    const managerExpenseAccountingRollback = applyForcedMigrationRollback(port, db, managerExpenseAccountingPath);
    if (managerExpenseAccountingRollback.status === 0) fail("Manager-expense accounting migration rollback probe unexpectedly committed");
    const accountingRoleGuard = query(port, db, "SELECT position($guard$v_role='manager'andcoalesce(p_source_type,'manual')in('invoice_issued','invoice_payment')$guard$ in regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='global_post_journal_entry'");
    if (accountingRoleGuard !== "t") fail("Manager-expense accounting rollback did not restore the original role guard");
    psql(port, db, ["-f", managerExpenseAccountingPath]);
    psql(port, db, ["-f", invoiceLedgerPath]);
    const quotationPath = resolve(root, "supabase/migrations/20261117170000_global_quotations_workflow.sql");
    const quotationRollback = applyForcedMigrationRollback(port, db, quotationPath);
    if (quotationRollback.status === 0) fail("Global quotations migration rollback probe unexpectedly committed");
    const quotationResidue = query(port, db, "SELECT (to_regclass('global.quotations') IS NOT NULL)::text || '|' || (to_regclass('global.quotation_items') IS NOT NULL)::text || '|' || (to_regprocedure('public.global_manage_quotation(uuid,uuid,text,uuid,uuid,text,date,date,text,jsonb,text,uuid)') IS NOT NULL)::text");
    if (quotationResidue !== "false|false|false") fail("Global quotations rollback left tables or RPC behind: " + quotationResidue);
    console.log("PASS actual DDL rollback for Global foundation, inventory, invoice, tax-audit, FX-expense, enterprise-hardening, Part 9 approval-gates and manager-expense accounting migrations");
  } finally {
    const drop = spawnSync("dropdb", ["-h","127.0.0.1","-p",String(port),"-U",process.env.PGUSER || "supabase_admin",db], {
      cwd: root, env: envFor(port, "postgres"), encoding: "utf8",
    });
    if (drop.status !== 0) console.error("WARN: disposable rollback database cleanup failed:", drop.stderr || "");
  }
}
function assertGlobalBackupRestore(port) {
  const sourceDb = "plivex_migration_replay";
  const restoredDb = "plivex_global_restore_drill";
  const tempDir = mkdtempSync(resolve(process.env.TMPDIR || "/tmp", "plivex-global-restore-"));
  const dumpPath = resolve(tempDir, "candidate.dump");
  const create = spawnSync("createdb", ["-h","127.0.0.1","-p",String(port),"-U",process.env.PGUSER || "supabase_admin",restoredDb], {
    cwd: root, env: envFor(port, "postgres"), encoding: "utf8",
  });
  if (create.status !== 0) fail("Could not create disposable restore-drill database: " + (create.stderr || ""));
  try {
    const dump = spawnSync("pg_dump", ["-Fc","--no-owner","--no-privileges","--exclude-extension=pg_cron","-f",dumpPath,sourceDb], {
      cwd: root, env: envFor(port, sourceDb), encoding: "utf8",
    });
    if (dump.status !== 0) fail("Disposable candidate backup failed: " + (dump.stderr || ""));
    const restore = spawnSync("pg_restore", ["--exit-on-error","--no-owner","--no-privileges","-d",restoredDb,dumpPath], {
      cwd: root, env: envFor(port, restoredDb), encoding: "utf8",
    });
    if (restore.status !== 0) fail("Disposable candidate restore failed: " + (restore.stderr || ""));
    const sourceSummary = query(port, sourceDb, "SELECT concat_ws('|',(SELECT count(*) FROM global.workspaces),(SELECT count(*) FROM global.workspace_members),(SELECT count(*) FROM global.invoices),(SELECT count(*) FROM global.expenses),(SELECT count(*) FROM pg_policies WHERE schemaname='global'),(SELECT count(*) FROM public.subscriptions WHERE id='22222222-2222-4222-8222-222222222222'))");
    const restoredSummary = query(port, restoredDb, "SELECT concat_ws('|',(SELECT count(*) FROM global.workspaces),(SELECT count(*) FROM global.workspace_members),(SELECT count(*) FROM global.invoices),(SELECT count(*) FROM global.expenses),(SELECT count(*) FROM pg_policies WHERE schemaname='global'),(SELECT count(*) FROM public.subscriptions WHERE id='22222222-2222-4222-8222-222222222222'))");
    if (!sourceSummary || sourceSummary !== restoredSummary) {
      fail("Global backup/restore verification mismatch: source=" + sourceSummary + " restored=" + restoredSummary);
    }
    const sourceIndia = query(port, sourceDb, "SELECT concat_ws('|',gateway,txnid,amount_minor_units::text,currency) FROM public.payment_logs WHERE source='stage4-migration-replay'");
    const restoredIndia = query(port, restoredDb, "SELECT concat_ws('|',gateway,txnid,amount_minor_units::text,currency) FROM public.payment_logs WHERE source='stage4-migration-replay'");
    if (sourceIndia !== restoredIndia || !sourceIndia) fail("India payment-log data changed during disposable Global restore drill");
    console.log("PASS disposable PostgreSQL custom-format backup/restore, Global RLS policy counts and India payment-log integrity");
  } finally {
    const drop = spawnSync("dropdb", ["-h","127.0.0.1","-p",String(port),"-U",process.env.PGUSER || "supabase_admin",restoredDb], {
      cwd: root, env: envFor(port, "postgres"), encoding: "utf8",
    });
    rmSync(tempDir, { recursive: true, force: true });
    if (drop.status !== 0) console.error("WARN: disposable restore-drill database cleanup failed:", drop.stderr || "");
  }
}

function assertRemoteIndia(port) {
  const sub = query(port, "plivex_migration_replay", `
    SELECT concat_ws('|',gateway,provider,txnid,payu_txnid,status::text,tier::text,amount::text,currency)
    FROM public.subscriptions WHERE id='22222222-2222-4222-8222-222222222222';
  `);
  if (sub !== "payu|payu|PAYU-INDIA-REGRESSION-001|PAYU-INDIA-REGRESSION-001|active|basic|1299|INR") {
    fail("Remote historical replay changed India PayU row: " + sub);
  }
  const lead = query(port, "plivex_migration_replay", `
    SELECT concat_ws('|',allowed::text,max_count::text,period)
    FROM public.plan_features f JOIN public.plan_limits l ON l.plan=f.plan AND l.resource='leads'
    WHERE f.plan='basic' AND f.feature='lead_pipeline';
  `);
  if (lead !== "true|200|total") fail("Remote Basic entitlement source did not replay: " + lead);
}
function assertCandidateIndia(port) {
  const sub = query(port, "plivex_migration_replay", `
    SELECT concat_ws('|',gateway,provider,txnid,payu_txnid,status::text,tier::text,
      amount_minor_units::text,amount_major::text,payment_status,billing_period,
      COALESCE(country_code,'<null>'),COALESCE(locale_code,'<null>'))
    FROM public.subscriptions WHERE id='22222222-2222-4222-8222-222222222222';
  `);
  const expected = "payu|payu|PAYU-INDIA-REGRESSION-001|PAYU-INDIA-REGRESSION-001|active|basic|129900|1299.00|success|year|<null>|<null>";
  if (sub !== expected) fail("India PayU subscription backfill mismatch: " + sub);
  const log = query(port, "plivex_migration_replay", `
    SELECT concat_ws('|',gateway,txnid,amount_minor_units::text,amount_major::text,currency)
    FROM public.payment_logs WHERE source='stage4-migration-replay';
  `);
  if (log !== "payu|PAYU-INDIA-REGRESSION-001|129900|1299.00|INR") fail("India PayU payment-log backfill mismatch: " + log);
  const lead = query(port, "plivex_migration_replay", `
    SELECT concat_ws('|',allowed::text,max_count::text,period)
    FROM public.plan_features f JOIN public.plan_limits l ON l.plan=f.plan AND l.resource='leads'
    WHERE f.plan='basic' AND f.feature='lead_pipeline';
  `);
  if (lead !== "true|200|total") fail("Candidate replay changed the seeded India Basic entitlement: " + lead);
}
function assertRollback(port) {
  const before = query(port, "plivex_migration_replay", "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'");
  const sql = "BEGIN; CREATE TABLE public.__stage4_rollback_probe(id integer PRIMARY KEY); INSERT INTO public.__stage4_rollback_probe VALUES (1); DO $rollback$ BEGIN RAISE EXCEPTION 'intentional rollback probe'; END $rollback$; COMMIT;";
  const failed = spawnSync("psql", ["-X","-v","ON_ERROR_STOP=1","-d","plivex_migration_replay"], {
    cwd: root, env: envFor(port, "plivex_migration_replay"), input: sql, encoding: "utf8",
  });
  if (failed.status === 0) fail("Intentional rollback probe unexpectedly succeeded");
  const exists = query(port, "plivex_migration_replay", "SELECT to_regclass('public.__stage4_rollback_probe') IS NOT NULL");
  const after = query(port, "plivex_migration_replay", "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'");
  if (exists !== "f" || before !== after) fail("Failed transaction left schema changes behind");
}
function summary(port, remote) {
  const sql = remote
    ? "SELECT concat_ws('|',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),(SELECT count(*) FROM pg_policies WHERE schemaname='public'),(SELECT count(*) FROM public.invoice_share_links),(SELECT count(*) FROM public.stage4_vault_secrets))"
    : "SELECT concat_ws('|',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),(SELECT count(*) FROM pg_policies WHERE schemaname='public'),(SELECT count(*) FROM public.invoice_share_links),(SELECT count(*) FROM public.payment_refunds))";
  return query(port, "plivex_migration_replay", sql);
}

const remotePort = Number(process.env.REMOTE_PGPORT || 5433);
const candidatePort = Number(process.env.CANDIDATE_PGPORT || 5434);
console.log("Migration reconciliation: 52 remote, 39 archived, 13 normalized local matches, 4 divergent, 160 candidate replay entries including India compliance foundation.");
resetDb(remotePort);
replay(remotePort, remotePlan, true);
assertRls(remotePort, false);
assertRemoteIndia(remotePort);
console.log("PASS remote history 47/47 plus documented local-only compatibility bridge; summary=" + summary(remotePort, true));

resetDb(candidatePort);
replay(candidatePort, candidatePlan);
assertRls(candidatePort, true);
assertCandidateIndia(candidatePort);
assertGlobalFoundation(candidatePort);
assertRollback(candidatePort);
assertGlobalMigrationRollback(candidatePort);
assertGlobalBackupRestore(candidatePort);
console.log("PASS global-dev candidate replay 37 recovered + 123 current local; Global RLS isolation, India entitlement/data and rollback checks; summary=" + summary(candidatePort, false));
console.log("PASS archive hashes, version ordering, replay, Global workspace isolation, migration rollback, RLS and India data-integrity checks.");

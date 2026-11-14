import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "supabase/recovered_remote_migrations/manifest.json"), "utf8"));
const fail = (message) => { console.error("FAIL:", message); process.exit(1); };
const history = manifest.recovered_historical_sources || [];
const missing = manifest.recovered_missing_sources || [];
const pairs = manifest.basename_matches || [];
const normalized = pairs.filter((x) => x.normalized_sql_match === true);
const localOnly = manifest.local_only_files || [];

if (manifest.remote_ledger_entries !== 47 || history.length !== 39 || missing.length !== 35
  || manifest.local_migration_files !== 29 || pairs.length !== 12
  || normalized.length !== 8 || pairs.length - normalized.length !== 4 || localOnly.length !== 17) {
  fail("Migration reconciliation counts differ from the reviewed 47/39/35/25/12/8/4/13 manifest");
}
if (new Set(history.map((x) => x.version)).size !== 39) fail("Duplicate archived remote migration version");

for (const entry of history) {
  const path = resolve(root, entry.path);
  if (!existsSync(path)) fail("Missing archived SQL: " + entry.path);
  const content = readFileSync(path);
  const sha = createHash("sha1").update(Buffer.from("blob " + content.length + "\0")).update(content).digest("hex");
  if (sha !== entry.blob_sha) fail("Archived SQL Git blob hash mismatch: " + entry.path);
}
for (const entry of pairs) if (!existsSync(resolve(root, entry.local_path))) fail("Missing local migration: " + entry.local_path);
for (const name of localOnly) if (!existsSync(resolve(root, "supabase/migrations", name))) fail("Missing local-only migration: " + name);

const remotePlan = [
  ...history.map((x) => ({ version: x.version, path: x.path, kind: "remote-archive" })),
  ...normalized.map((x) => ({ version: x.remote_version, path: x.local_path, kind: "normalized-local-match" })),
].sort((a, b) => a.version.localeCompare(b.version));
if (remotePlan.length !== 47 || new Set(remotePlan.map((x) => x.version)).size !== 47) fail("Remote replay plan is not 47 unique versions");

const localPaths = [...pairs.map((x) => x.local_path), ...localOnly.map((x) => "supabase/migrations/" + x)];
const candidatePlan = [
  ...missing.map((x) => ({ version: x.version, path: x.path, kind: "recovered-history" })),
  ...localPaths.map((path) => {
    const match = basename(path).match(/^(\d{12,14})_/);
    if (!match) fail("Unsortable local migration filename: " + path);
    return { version: match[1], path, kind: "current-local" };
  }),
].sort((a, b) => a.version.localeCompare(b.version));
if (candidatePlan.length !== 64 || new Set(candidatePlan.map((x) => x.path)).size !== 64) {
  fail("Candidate replay plan must contain 35 recovered historical and all 29 current local migrations");
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
  const missing = query(port, "plivex_migration_replay", "SELECT string_agg(t.name, ',') FROM (VALUES ('workspaces'),('user_profiles'),('workspace_members'),('business_profiles')) AS t(name) WHERE to_regclass('global.' || t.name) IS NULL OR NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('global.' || t.name)), false);");
  if (missing) fail("Global foundation tables missing or RLS disabled: " + missing);
  const usage = query(port, "plivex_migration_replay", "SELECT has_schema_privilege('authenticated','global','USAGE')::text || '|' || has_schema_privilege('anon','global','USAGE')::text;");
  if (usage !== "true|false") fail("Global schema grants are not least-privilege: " + usage);
  console.log("PASS Global foundation table/RLS/grant catalog assertions");
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-isolation-foundation.integration.sql")]);
  psql(port, "plivex_migration_replay", ["-f", resolve(root, "supabase/tests/global-owner-provisioning.integration.sql")]);
}
function applyForcedMigrationRollback(port, db, migrationPath) {
  const migration = readFileSync(migrationPath, "utf8")
    .replace(/(^|\\n)begin;\\s*/i, "$1")
    .replace(/\\ncommit;\\s*$/i, "");
  const forcedRollback = "BEGIN;\\n" + migration +
    "\\nDO $global_rollback$ BEGIN RAISE EXCEPTION 'intentional Global migration rollback verification'; END $global_rollback$;\\n";
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
    if (residue !== "f|f|f|f") fail("Global owner-provisioning rollback left functions or columns behind: " + residue);
    console.log("PASS actual DDL rollback for Global isolation foundation and owner provisioning migrations");
  } finally {
    const drop = spawnSync("dropdb", ["-h","127.0.0.1","-p",String(port),"-U",process.env.PGUSER || "supabase_admin",db], {
      cwd: root, env: envFor(port, "postgres"), encoding: "utf8",
    });
    if (drop.status !== 0) console.error("WARN: disposable rollback database cleanup failed:", drop.stderr || "");
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
console.log("Migration reconciliation: 47 remote, 39 archived, 8 normalized local matches, 4 divergent, 64 candidate replay entries.");
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
console.log("PASS global-dev candidate replay 35 recovered + 29 local; Global RLS isolation, India entitlement/data and rollback checks; summary=" + summary(candidatePort, false));
console.log("PASS archive hashes, version ordering, replay, Global workspace isolation, migration rollback, RLS and India data-integrity checks.");

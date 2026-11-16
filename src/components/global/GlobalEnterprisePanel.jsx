import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";

const inputClass = "min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const buttonClass = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";

async function responseError(error, fallback) {
  try {
    const payload = await error?.context?.clone?.().json();
    if (payload?.error) return payload.error;
  } catch { /* keep SDK message */ }
  return error?.message || fallback;
}

export default function GlobalEnterprisePanel({ workspaceId }) {
  const [branches, setBranches] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [events, setEvents] = useState([]);
  const [health, setHealth] = useState(null);
  const [branchCode, setBranchCode] = useState("");
  const [branchName, setBranchName] = useState("");
  const [approvalAction, setApprovalAction] = useState("expense.approve");
  const [resourceType, setResourceType] = useState("expense");
  const [resourceId, setResourceId] = useState("");
  const [permissionRole, setPermissionRole] = useState("manager");
  const [permissionKey, setPermissionKey] = useState("export.request");
  const [permissionEffect, setPermissionEffect] = useState("deny");
  const [auditDays, setAuditDays] = useState("365");
  const [exportType, setExportType] = useState("invoices");
  const [exportFormat, setExportFormat] = useState("csv");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const enterprise = useCallback(async (action, payload = {}) => {
    const { data, error: invokeError } = await supabase.functions.invoke("global-enterprise", {
      body: { workspaceId, action, ...payload },
    });
    if (invokeError) throw new Error(await responseError(invokeError, "Enterprise request failed."));
    if (!data?.ok) throw new Error(data?.code || "Enterprise request failed.");
    return data;
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    const results = await Promise.allSettled([
      enterprise("branch.list"),
      enterprise("approval.list"),
      enterprise("audit.list", { limit: 50 }),
      enterprise("health.read"),
    ]);
    if (results[0].status === "fulfilled") setBranches(results[0].value.branches || []);
    if (results[1].status === "fulfilled") setApprovals(results[1].value.requests || []);
    if (results[2].status === "fulfilled") setEvents(results[2].value.events || []);
    if (results[3].status === "fulfilled") setHealth(results[3].value.health || null);
    const denied = results.find((result) => result.status === "rejected");
    if (denied) setError(denied.reason?.message || "Some enterprise information could not be loaded. Your role may not have access.");
  }, [enterprise, workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  const perform = async (work, successMessage) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await work();
      if (successMessage) setNotice(successMessage);
      await refresh();
    } catch (caught) {
      setError(caught?.message || "The operation could not be completed.");
    } finally { setBusy(false); }
  };

  const createBranch = (event) => {
    event.preventDefault();
    perform(async () => {
      await enterprise("branch.create", { branchCode: branchCode.trim().toUpperCase(), name: branchName.trim(), address: {} });
      setBranchCode(""); setBranchName("");
    }, "Branch created.");
  };

  const decideApproval = (requestId, decision) => perform(
    () => enterprise("approval.decide", { requestId, decision }),
    decision === "approved" ? "Approval recorded." : "Request rejected.",
  );

  const submitApproval = (event) => {
    event.preventDefault();
    perform(async () => {
      await enterprise("approval.request", {
        actionType: approvalAction.trim(), resourceType: resourceType.trim(),
        resourceId: resourceId.trim(), payload: { source: "global-enterprise-panel" },
      });
      setResourceId("");
    }, "Approval request submitted.");
  };

  const setPermission = (event) => {
    event.preventDefault();
    perform(() => enterprise("permission.set", { role: permissionRole, permissionKey, effect: permissionEffect }), "Role permission updated.");
  };

  const saveRetention = (event) => {
    event.preventDefault();
    perform(() => enterprise("retention.set", { auditRetentionDays: Number(auditDays), exportRetentionDays: 7 }), "Retention policy saved.");
  };

  const createExport = () => perform(async () => {
    setDownloadUrl("");
    const queued = await enterprise("export.request", { exportType, format: exportFormat });
    const { data, error: invokeError } = await supabase.functions.invoke("global-export", {
      body: { workspaceId, jobId: queued.jobId, action: "process" },
    });
    if (invokeError) throw new Error(await responseError(invokeError, "Export could not be generated."));
    if (!data?.signedUrl) throw new Error(data?.error || "Export is not ready yet.");
    setDownloadUrl(data.signedUrl);
  }, "Secure export generated. The download link expires in five minutes.");

  const cleanup = () => perform(async () => {
    const { data, error: invokeError } = await supabase.functions.invoke("global-export", {
      body: { workspaceId, jobId: crypto.randomUUID(), action: "cleanup" },
    });
    if (invokeError) throw new Error(await responseError(invokeError, "Retention cleanup failed."));
    if (!data?.ok) throw new Error(data?.error || "Retention cleanup failed.");
    setNotice("Retention cleanup completed. " + (data.expiredExports || 0) + " export(s) expired; " + (data.auditEventsDeleted || 0) + " old audit event(s) removed.");
  });

  return (
    <section className="mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">Enterprise controls</h1><p className="mt-1 text-sm text-slate-500">Workspace branches, approvals, access policies, audit history and secure exports.</p></div>
        <button type="button" className={secondaryClass} onClick={() => refresh()} disabled={busy}>Refresh</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Branches</h2>
          <form onSubmit={createBranch} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputClass} required maxLength={32} placeholder="Branch code" value={branchCode} onChange={(e) => setBranchCode(e.target.value)} />
            <input className={inputClass} required maxLength={160} placeholder="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            <button className={buttonClass} disabled={busy}>Add</button>
          </form>
          <div className="mt-3 divide-y divide-slate-100">
            {branches.length === 0 ? <p className="py-3 text-sm text-slate-500">No branches created.</p> : branches.map((branch) => (
              <div key={branch.id} className="flex items-center justify-between gap-3 py-3">
                <div><p className="text-sm font-medium">{branch.name}</p><p className="text-xs text-slate-500">{branch.branch_code} · {branch.status}</p></div>
                {branch.status === "active" && <button type="button" className={secondaryClass} disabled={busy} onClick={() => perform(() => enterprise("branch.archive", { branchId: branch.id }), "Branch archived.")}>Archive</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Approval requests</h2>
          <form onSubmit={submitApproval} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input className={inputClass} required maxLength={80} value={approvalAction} onChange={(e) => setApprovalAction(e.target.value)} aria-label="Action type" />
            <input className={inputClass} required maxLength={80} value={resourceType} onChange={(e) => setResourceType(e.target.value)} aria-label="Resource type" />
            <input className={inputClass + " sm:col-span-2"} required maxLength={160} placeholder="Resource ID / reference" value={resourceId} onChange={(e) => setResourceId(e.target.value)} />
            <button className={buttonClass} disabled={busy}>Request approval</button>
          </form>
          <div className="mt-3 divide-y divide-slate-100">
            {approvals.length === 0 ? <p className="py-3 text-sm text-slate-500">No pending requests.</p> : approvals.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0"><p className="text-sm font-medium">{item.action_type} · {item.resource_type}</p><p className="truncate text-xs text-slate-500">{item.resource_id} · requested {new Date(item.created_at).toLocaleString()}</p></div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryClass} disabled={busy} onClick={() => perform(() => enterprise("approval.cancel", { requestId: item.id }), "Request cancelled.")}>Cancel</button>
                  <button type="button" className={secondaryClass} disabled={busy} onClick={() => decideApproval(item.id, "approved")}>Approve</button>
                  <button type="button" className={secondaryClass} disabled={busy} onClick={() => decideApproval(item.id, "rejected")}>Reject</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-700">Approval requests can be submitted, decided or cancelled. They do not yet automatically block invoice or expense writes.</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Role permissions</h2>
          <form onSubmit={setPermission} className="mt-3 grid gap-2 sm:grid-cols-2">
            <select className={inputClass} value={permissionRole} onChange={(e) => setPermissionRole(e.target.value)} aria-label="Role">
              {["manager", "employee", "accountant", "viewer"].map((role) => <option key={role}>{role}</option>)}
            </select>
            <select className={inputClass} value={permissionEffect} onChange={(e) => setPermissionEffect(e.target.value)} aria-label="Effect">
              <option value="grant">Grant</option><option value="deny">Deny</option>
            </select>
            <input className={inputClass + " sm:col-span-2"} required maxLength={96} value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)} aria-label="Permission key" />
            <button className={buttonClass} disabled={busy}>Save role rule</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Owner/admin controls are protected server-side. A role-level rule applies to that role across this workspace.</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Data export and retention</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select className={inputClass} value={exportType} onChange={(e) => setExportType(e.target.value)} aria-label="Export type">
              <option value="invoices">Invoices</option><option value="clients">Clients</option><option value="products">Products</option><option value="expenses">Expenses</option><option value="audit_log">Audit log</option><option value="full_account">Full account (admin)</option>
            </select>
            <select className={inputClass} value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} aria-label="Export format">
              <option value="csv">CSV</option><option value="json">JSON</option>
            </select>
            <button type="button" className={buttonClass} disabled={busy} onClick={createExport}>Generate secure export</button>
            {downloadUrl && <a className="self-center text-sm font-semibold text-violet-700 underline" href={downloadUrl} target="_blank" rel="noreferrer">Download export (5-minute link)</a>}
          </div>
          <form onSubmit={saveRetention} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} type="number" min="30" max="3650" required value={auditDays} onChange={(e) => setAuditDays(e.target.value)} aria-label="Audit retention days" />
            <button className={secondaryClass} disabled={busy}>Save audit retention</button>
          </form>
          <button type="button" className={secondaryClass + " mt-3"} disabled={busy} onClick={cleanup}>Run expired-data cleanup</button>
          <p className="mt-2 text-xs text-slate-500">Exports use a private storage bucket and short-lived signed links. Retention cleanup is owner/admin-only.</p>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Workspace health</h2><span className="text-xs text-slate-500">Operational snapshot</span></div>
        {health ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(health).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{key.replace(/[A-Z]/g, (letter) => " " + letter).replace(/^./, (letter) => letter.toUpperCase())}</p><p className="mt-1 text-lg font-semibold">{typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? "—"}</p></div>)}
        </div> : <p className="mt-3 text-sm text-slate-500">Health snapshot is available to workspace owners/admins.</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Audit history</h2>
        <div className="mt-3 max-h-80 overflow-auto">
          {events.length === 0 ? <p className="py-3 text-sm text-slate-500">No audit events available for this role.</p> : <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Event</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">When</th></tr></thead><tbody className="divide-y divide-slate-100">{events.map((event) => <tr key={event.id}><td className="px-3 py-2 font-medium">{event.action}</td><td className="px-3 py-2">{event.entity_type}{event.entity_id ? " · " + event.entity_id : ""}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString()}</td></tr>)}</tbody></table>}
        </div>
      </section>
    </section>
  );
}

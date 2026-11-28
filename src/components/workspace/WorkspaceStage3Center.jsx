import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { CheckCircle2, Clock3, Copy, FileLock2, Link2, Pause, Play, RefreshCw, Trash2, UploadCloud, Webhook } from "lucide-react";

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const primary = "rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
const EVENT_TYPES = [
  ["invoice.created", "Invoice created"],
  ["invoice.status_changed", "Invoice status changed"],
  ["lead.created", "Lead created"],
  ["lead.stage_changed", "Lead stage changed"],
  ["expense.created", "Expense created"],
  ["stock.low_stock", "Stock reaches low-stock threshold"],
  ["integration.webhook_received", "Signed webhook received"],
];
const SHOPIFY_EVENTS = [["orders/create","Order created"],["orders/updated","Order updated"],["products/create","Product created"],["products/update","Product updated"],["inventory_levels/update","Inventory level updated"]];
const CUSTOM_EVENTS = EVENT_TYPES.filter(([value]) => value !== "integration.webhook_received");
const STATUS_LABELS = {
  available: "Available",
  setup_required: "Setup required",
  awaiting_provider_access: "Awaiting provider access",
  sandbox_tested: "Sandbox tested",
  live_verified: "Live verified",
};
const encodeFile = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export default function WorkspaceStage3Center({ section }) {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [rules, setRules] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [webhookData, setWebhookData] = useState({ subscriptions: [], events: [], attempts: [] });
  const [webhookProvider, setWebhookProvider] = useState("shopify");
  const [webhookLabel, setWebhookLabel] = useState("Shopify webhook");
  const [webhookEvents, setWebhookEvents] = useState(["orders/create"]);
  const [createdWebhook, setCreatedWebhook] = useState(null);
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("invoice.created");
  const [statusCondition, setStatusCondition] = useState("");
  const [taskTitle, setTaskTitle] = useState("Review business event");
  const [taskDescription, setTaskDescription] = useState("");
  const [dueHours, setDueHours] = useState("24");
  const [category, setCategory] = useState("general");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const invoke = useCallback(async (body) => {
    const { data, error: invokeError } = await supabase.functions.invoke("workspace-stage3", { body });
    if (invokeError) {
      let message = invokeError.message;
      try { message = (await invokeError.context.clone().json()).error || message; } catch { /* retain SDK error */ }
      throw new Error(message);
    }
    if (data?.ok === false) throw new Error(data.error || "Request failed.");
    return data;
  }, []);

  const refresh = useCallback(async () => {
    if (section === "integration-registry") {
      const result = await invoke({ action: "integrations.list" });
      setIntegrations(result.integrations || []);
      if (["admin", "manager"].includes(user?.role)) {
        const hooks = await invoke({ action: "webhooks.list" });
        setWebhookData({ subscriptions: hooks.subscriptions || [], events: hooks.events || [], attempts: hooks.attempts || [] });
      }
    } else if (section === "automation-rules") {
      const result = await invoke({ action: "automation.list" });
      setRules(result.rules || []);
      setTasks(result.tasks || []);
    } else if (section === "document-vault") {
      const result = await invoke({ action: "vault.list" });
      setDocuments(result.documents || []);
    }
  }, [invoke, section, user?.role]);

  useEffect(() => { refresh().catch((caught) => setError(caught.message || "Could not load this workspace tool.")); }, [refresh]);

  const run = async (work, success) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); if (success) setNotice(success); await refresh(); }
    catch (caught) { setError(caught.message || "The operation could not be completed."); }
    finally { setBusy(false); }
  };

  const createRule = (event) => {
    event.preventDefault();
    const conditions = eventType === "invoice.status_changed" && statusCondition ? { status_equals: statusCondition } : {};
    return run(() => invoke({
      action: "automation.create", name, eventType, conditions, actionType: "create_task", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      actionConfig: { title: taskTitle, description: taskDescription, due_in_hours: dueHours === "" ? null : Number(dueHours) },
    }), "Automation rule saved. It will create a review task when its event is processed.");
  };

  const createWebhook = (event) => {
    event.preventDefault();
    return run(async () => {
      const result = await invoke({ action: "webhooks.create", providerKey: webhookProvider, label: webhookLabel, eventTypes: webhookEvents });
      setCreatedWebhook(result);
    }, "Webhook subscription created. Copy the signing secret now; it is shown only once.");
  };
  const copyText = async (value) => {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Clipboard access is unavailable. Select and copy the value manually."); }
  };
  const toggleWebhookEvent = (value) => setWebhookEvents((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  const uploadDocument = async (event) => {
    event.preventDefault();
    if (!file) { setError("Choose a document first."); return; }
    if (file.size < 1 || file.size > 10 * 1024 * 1024) { setError("Documents must be between 1 byte and 10 MB."); return; }
    await run(async () => {
      await invoke({ action: "vault.upload", fileName: file.name, mimeType: file.type, category, fileBase64: await encodeFile(file) });
      setFile(null);
    }, "Document stored in the private workspace vault.");
  };

  const downloadDocument = (id) => run(async () => {
    const result = await invoke({ action: "vault.download", documentId: id });
    window.location.assign(result.signedUrl);
  });
  const removeDocument = (id) => run(() => invoke({ action: "vault.delete", documentId: id }), "Document deleted from the private vault.");

  if (!["admin", "manager", "accountant"].includes(user?.role)) {
    return <section className="rounded-xl border bg-white p-4 text-sm text-slate-600">This workspace tool is not available for your current role.</section>;
  }

  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="flex justify-end"><button className={secondary} disabled={busy} onClick={() => refresh().catch((caught) => setError(caught.message))}><RefreshCw className="mr-1 inline h-3.5 w-3.5"/>Refresh</button></div>

    {section === "integration-registry" && <div className="space-y-4">
      <section className="rounded-2xl border bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Integration registry</h2></div>
        <p className="mt-1 text-xs text-slate-500">A single status register for supported providers. Statuses are not manually promoted to live; live verification requires a real server-side provider check.</p>
        <div className="mt-4 space-y-2">{integrations.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
          <div><p className="text-sm font-semibold">{({shopify:"Shopify",whatsapp_cloud:"WhatsApp Cloud",cashfree:"Cashfree",paddle:"Paddle",public_api:"Plivex Public API",custom_webhooks:"Custom webhooks"})[item.provider_key] || item.provider_key}</p><p className="text-xs text-slate-500">{item.account_label || "No provider account connected"}</p>{item.last_error_code && <p className="mt-1 text-xs text-amber-700">Last check: {item.last_error_code}</p>}</div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">{STATUS_LABELS[item.status] || "Setup required"}</span>
        </article>)}</div>
      </section>
      {["admin","manager"].includes(user?.role) && <section className="rounded-2xl border bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><Webhook className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Signed inbound webhooks</h2></div>
        <p className="mt-1 text-xs text-slate-500">Shopify and custom events are verified server-side. Secrets are held in Supabase Vault, never placed in the endpoint URL, and shown only once when created.</p>
        <form onSubmit={createWebhook} className="mt-4 grid gap-2 sm:grid-cols-2">
          <select className={field} value={webhookProvider} onChange={(e) => { setWebhookProvider(e.target.value); setWebhookEvents(e.target.value === "shopify" ? ["orders/create"] : ["invoice.created"]); }}>
            <option value="shopify">Shopify</option><option value="custom">Custom signed webhook</option>
          </select>
          <input className={field} required minLength={2} maxLength={100} value={webhookLabel} onChange={(e) => setWebhookLabel(e.target.value)} placeholder="Webhook label"/>
          <div className="sm:col-span-2 grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            {(webhookProvider === "shopify" ? SHOPIFY_EVENTS : CUSTOM_EVENTS).map(([value,label]) => <label key={value} className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={webhookEvents.includes(value)} onChange={() => toggleWebhookEvent(value)}/>{label}
            </label>)}
          </div>
          <button className={primary+" sm:col-span-2"} disabled={busy || webhookEvents.length < 1 || webhookEvents.length > 8}>Create webhook subscription</button>
        </form>
        {createdWebhook && <div className="mt-4 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-sm font-semibold">Copy these values now — the signing secret will not be shown again.</p>
          <label className="block text-xs font-semibold text-slate-600">Webhook endpoint</label>
          <div className="flex gap-2"><input readOnly className={field} value={createdWebhook.endpointUrl}/><button className={secondary} onClick={() => copyText(createdWebhook.endpointUrl)}><Copy className="h-4 w-4"/></button></div>
          <label className="block text-xs font-semibold text-slate-600">Signing secret</label>
          <div className="flex gap-2"><input readOnly type="password" className={field} value={createdWebhook.secret}/><button className={secondary} onClick={() => copyText(createdWebhook.secret)}><Copy className="h-4 w-4"/></button></div>
        </div>}
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold">Subscriptions</h3>
          {webhookData.subscriptions.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.label} · {item.provider_key}</p><p className="text-xs text-slate-500">{item.event_types.join(", ")} · {item.is_active ? "Active" : "Paused"}</p>{item.last_received_at && <p className="text-xs text-slate-500">Last received {new Date(item.last_received_at).toLocaleString()}</p>}
              {item.endpoint_url && <div className="mt-2 flex gap-2"><input readOnly className={field+" text-xs"} value={item.endpoint_url}/><button className={secondary} onClick={() => copyText(item.endpoint_url)} aria-label="Copy webhook endpoint"><Copy className="h-4 w-4"/></button></div>}
            </div>
            <button className={secondary} disabled={busy} onClick={() => run(() => invoke({ action: "webhooks.pause", subscriptionId: item.id, isActive: !item.is_active }), item.is_active ? "Webhook paused." : "Webhook enabled.")}>{item.is_active ? <><Pause className="mr-1 inline h-3.5 w-3.5"/>Pause</> : <><Play className="mr-1 inline h-3.5 w-3.5"/>Enable</>}</button>
          </article>)}
          {!webhookData.subscriptions.length && <p className="py-2 text-xs text-slate-500">No webhook subscriptions configured.</p>}
        </div>
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold">Webhook event log and dead letters</h3>
          {webhookData.events.map((item) => <article key={item.id} className="border-t py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">{item.provider_key} · {item.event_type}</p><p className="text-xs text-slate-500">Event {item.provider_event_id} · {item.status} · {item.attempt_count} attempts</p>{item.last_error_code && <p className="text-xs text-amber-700">{item.last_error_code}</p>}</div>
              {item.status === "dead_letter" && <button className={secondary} disabled={busy} onClick={() => run(() => invoke({ action: "webhooks.replay", eventId: item.id }), "Webhook event queued for retry.")}>Replay</button>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">{webhookData.attempts.filter((attempt) => attempt.event_id === item.id).slice(0,4).map((attempt) => <span key={attempt.id} className="rounded border px-2 py-1 text-[11px] text-slate-600">Attempt {attempt.attempt_no}: {attempt.status}</span>)}</div>
          </article>)}
          {!webhookData.events.length && <p className="py-2 text-xs text-slate-500">No webhook events received yet.</p>}
        </div>
      </section>}
    </div>}

    {section === "automation-rules" && <div className="space-y-4">
      <section className="rounded-2xl border bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Deterministic automation rules</h2></div>
        <p className="mt-1 text-xs text-slate-500">Rules respond to recorded business events and create review tasks. They do not send messages, issue invoices, change payments or post accounting entries.</p>
        <form onSubmit={createRule} className="mt-4 grid gap-2 sm:grid-cols-2">
          <input className={field} required minLength={2} maxLength={100} placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)}/>
          <select className={field} value={eventType} onChange={(e) => setEventType(e.target.value)}>{EVENT_TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
          {eventType === "invoice.status_changed" && <input className={field} maxLength={40} placeholder="Optional invoice status condition (e.g. overdue)" value={statusCondition} onChange={(e) => setStatusCondition(e.target.value)}/>}
          <input className={field} required minLength={2} maxLength={160} placeholder="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)}/>
          <input className={field+" sm:col-span-2"} maxLength={2000} placeholder="Task description (optional)" value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)}/>
          <label className="text-xs text-slate-600">Due in hours (optional)<input className={field+" mt-1"} type="number" min="0" max="720" step="1" value={dueHours} onChange={(e) => setDueHours(e.target.value)}/></label>
          <button className={primary+" self-end"} disabled={busy}>Create automation rule</button>
        </form>
        <div className="mt-4 space-y-2">{rules.map((rule) => <article key={rule.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
          <div><p className="text-sm font-semibold">{rule.name}</p><p className="text-xs text-slate-500">{rule.event_type} · {rule.action_type} · {rule.is_active ? "Active" : "Paused"}</p></div>
          <button className={secondary} disabled={busy} onClick={() => run(() => invoke({ action: "automation.pause", ruleId: rule.id, isActive: !rule.is_active }), rule.is_active ? "Rule paused." : "Rule enabled.")}>{rule.is_active ? <><Pause className="mr-1 inline h-3.5 w-3.5"/>Pause</> : <><Play className="mr-1 inline h-3.5 w-3.5"/>Enable</>}</button>
        </article>)}</div>
      </section>
      <section className="rounded-2xl border bg-white p-4 sm:p-5">
        <h2 className="font-semibold">Automation review tasks</h2>
        <div className="mt-3 space-y-2">{tasks.map((task) => <article key={task.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
          <div><p className="text-sm font-semibold">{task.title}</p><p className="text-xs text-slate-500">{task.status} {task.due_at ? "· Due "+new Date(task.due_at).toLocaleString() : ""}</p>{task.description && <p className="mt-1 text-xs text-slate-600">{task.description}</p>}</div>
          {task.status === "open" && <button className={secondary} disabled={busy} onClick={() => run(() => invoke({ action: "automation.task_status", taskId: task.id, status: "completed" }), "Task marked complete.")}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5"/>Complete</button>}
        </article>) }{!tasks.length && <p className="py-3 text-xs text-slate-500">No automation tasks yet.</p>}</div>
      </section>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Rules are processed by the scheduled Postgres worker. Task creation and run history are idempotent; external messages and financial writes are intentionally excluded.</p>
    </div>}

    {section === "document-vault" && <section className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2"><FileLock2 className="h-5 w-5 text-violet-700"/><h2 className="font-semibold">Private document vault</h2></div>
      <p className="mt-1 text-xs text-slate-500">Files are stored in a private bucket. Access is issued through short-lived signed URLs after workspace and role checks.</p>
      <form onSubmit={uploadDocument} className="mt-4 grid gap-2 sm:grid-cols-3">
        <input className={field+" sm:col-span-2"} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)}/>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>{["general","invoice","quotation","purchase","expense","tax","contract","other"].map((value) => <option key={value}>{value}</option>)}</select>
        <button className={primary+" sm:col-span-3"} disabled={busy || !file}><UploadCloud className="mr-1 inline h-3.5 w-3.5"/>Upload to private vault</button>
      </form>
      <div className="mt-4 space-y-2">{documents.map((document) => <article key={document.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3">
        <div className="min-w-0"><p className="break-all text-sm font-semibold">{document.file_name}</p><p className="text-xs text-slate-500">{document.category} · {(document.size_bytes/1024).toFixed(1)} KB · {new Date(document.created_at).toLocaleDateString()}</p></div>
        <div className="flex gap-2"><button className={secondary} disabled={busy} onClick={() => downloadDocument(document.id)}>Open</button>{["admin","manager"].includes(user?.role) && <button className={secondary} disabled={busy} onClick={() => removeDocument(document.id)} aria-label={"Delete "+document.file_name}><Trash2 className="h-3.5 w-3.5"/></button>}</div>
      </article>)}{!documents.length && <p className="py-3 text-xs text-slate-500">No documents stored yet.</p>}</div>
    </section>}
  </div>;
}

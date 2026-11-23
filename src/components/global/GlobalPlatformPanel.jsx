import { useEffect, useState } from "react";
import { supabase } from "@/api/backendClient";

const field = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm";
const primary = "rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50";
const invoke = async (body) => {
  const { data, error } = await supabase.functions.invoke("global-platform", { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.clone().json()).error || message; } catch { /* SDK fallback */ }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || "Platform request failed.");
  return data;
};
const fileBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export default function GlobalPlatformPanel({ workspaceId }) {
  const [invoiceId, setInvoiceId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signatures, setSignatures] = useState([]);
  const [signUrl, setSignUrl] = useState("");
  const [files, setFiles] = useState([]);
  const [documentType, setDocumentType] = useState("invoice");
  const [ocrResults, setOcrResults] = useState([]);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [messageType, setMessageType] = useState("template");
  const [message, setMessage] = useState("");
  const [customerInitiatedAt, setCustomerInitiatedAt] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en");
  const [templateComponentsJson, setTemplateComponentsJson] = useState("[]");
  const [whatsappLogs, setWhatsappLogs] = useState([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentStatement, setConsentStatement] = useState("");
  const [apiLabel, setApiLabel] = useState("Accounting integration");
  const [apiScopes, setApiScopes] = useState(["workspace.read", "invoices.read", "clients.read", "expenses.read", "leads.read", "inventory.read", "suppliers.read", "mcp.read"]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newSecret, setNewSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [signatureResult, keyResult, whatsappResult] = await Promise.allSettled([
      invoke({ action: "signature.list", workspaceId }),
      invoke({ action: "api-key.list", workspaceId }),
      invoke({ action: "whatsapp.list", workspaceId }),
    ]);
    if (signatureResult.status === "fulfilled") setSignatures(signatureResult.value.requests || []);
    if (keyResult.status === "fulfilled") setApiKeys(keyResult.value.keys || []);
    else setError("API key management is available to workspace owners and admins. Other integration controls remain available according to your role.");
    if (whatsappResult.status === "fulfilled") setWhatsappLogs(whatsappResult.value.messages || []);
  };
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [workspaceId]);

  const run = async (work, success) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); if (success) setNotice(success); }
    catch (e) { setError(e.message || "Operation failed."); }
    finally { setBusy(false); }
  };
  const requestSignature = (event) => {
    event.preventDefault();
    run(async () => {
      const result = await invoke({ action: "signature.request", workspaceId, invoiceId: invoiceId.trim(), signerName, signerEmail });
      setSignUrl(result.signUrl); await refresh();
    }, "Signature request created. Copy and send the link to the signer.");
  };
  const runOcr = () => run(async () => {
    if (!files.length || files.length > 10) throw new Error("Choose between 1 and 10 files.");
    const results = [];
    for (const item of files) {
      if (item.size > 4 * 1024 * 1024) throw new Error(item.name + " exceeds the 4 MB per-file limit.");
      const result = await invoke({ action: "ocr.process", workspaceId, documentType, mimeType: item.type, fileBase64: await fileBase64(item) });
      results.push({ name: item.name, ...result });
      setOcrResults([...results]);
    }
  }, "OCR batch completed. Review every extracted field before using it.");
  const sendMessage = (event) => {
    event.preventDefault();
    run(async () => {
      let templateComponents = [];
      try { templateComponents = templateComponentsJson.trim() ? JSON.parse(templateComponentsJson) : []; } catch { throw new Error("Template components must be valid JSON."); }
      if (!Array.isArray(templateComponents)) throw new Error("Template components must be a JSON array.");
      await invoke({ action: "whatsapp.send", workspaceId, recipientPhone, messageType, message, consentStatement, customerInitiatedAt: customerInitiatedAt ? new Date(customerInitiatedAt).toISOString() : null, templateName, templateLanguage, templateComponents, consentConfirmed });
      const history = await invoke({ action: "whatsapp.list", workspaceId });
      setWhatsappLogs(history.messages || []);
    }, "WhatsApp message accepted by Meta for delivery.");
  };
  const createKey = (event) => {
    event.preventDefault();
    run(async () => {
      const result = await invoke({ action: "api-key.create", workspaceId, label: apiLabel, scopes: apiScopes, expiryDays: 90 });
      setNewSecret(result.secret); await refresh();
    }, "API key created. Copy it now; it is only shown once.");
  };
  const toggleScope = (scope) => setApiScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);

  return <section className="mt-6 space-y-5">
    <div><h1 className="text-2xl font-bold">Integrations & document intelligence</h1><p className="mt-1 text-sm text-slate-500">Electronic signing records, AI document extraction, WhatsApp Cloud and secure API/MCP access.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Electronic signature requests</h2>
      <p className="mt-1 text-xs text-slate-500">Creates a one-time signing link, records explicit consent, document hash, time and audit metadata. This is an electronic-signature audit trail, not a qualified/certified digital signature.</p>
      <form onSubmit={requestSignature} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input className={field} required placeholder="Global invoice UUID" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
        <input className={field} required minLength={2} maxLength={160} placeholder="Signer full name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        <input className={field} required type="email" placeholder="Signer email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
        <button className={primary} disabled={busy}>Create signing link</button>
      </form>
      {signUrl && <div className="mt-3 rounded-lg bg-violet-50 p-3 text-sm"><p className="font-semibold">One-time signing link</p><a className="break-all text-violet-800 underline" href={signUrl}>{signUrl}</a><button className={secondary + " ml-2 mt-2"} type="button" onClick={() => navigator.clipboard.writeText(signUrl)}>Copy link</button></div>}
      <div className="mt-3 space-y-2">{signatures.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t py-2 text-sm"><span>{item.signer_name} · {item.signer_email}</span><span className="text-slate-500">{item.status} · {new Date(item.created_at).toLocaleDateString()}</span></div>)}</div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Document OCR & AI extraction</h2>
      <p className="mt-1 text-xs text-slate-500">Upload up to 10 invoices, receipts or purchase orders in one batch (4 MB each). Files are sent to Google Gemini using your configured API key. Extraction is a draft and never posts accounting or inventory records automatically.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select className={field} value={documentType} onChange={(e) => setDocumentType(e.target.value)}><option value="invoice">Invoice</option><option value="receipt">Receipt</option><option value="purchase_order">Purchase order</option><option value="identity">Identity document</option><option value="other">Other</option></select>
        <input className={field} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { setFiles(Array.from(e.target.files || [])); setOcrResults([]); }} />
        <button className={primary} type="button" disabled={busy || !files.length || files.length > 10} onClick={runOcr}>Extract {files.length || ""} document(s)</button>
      </div>
      {ocrResults.map((result) => <div key={result.jobId} className="mt-3 rounded-lg border border-slate-200 p-3"><p className="text-sm font-semibold">{result.name}</p><pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(result.extracted, null, 2)}</pre></div>)}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">WhatsApp Cloud messaging</h2>
      <p className="mt-1 text-xs text-slate-500">Requires Meta WhatsApp Cloud API credentials in Supabase secrets and documented customer opt-in. Free-form text is restricted to the 24-hour customer-service window; outside it use an approved template.</p>
      <form onSubmit={sendMessage} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input className={field} required placeholder="Recipient phone (+country code)" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
        <select className={field} value={messageType} onChange={(e) => setMessageType(e.target.value)}><option value="template">Approved template</option><option value="text">Free-form (24-hour window)</option></select>
        {messageType === "template" ? <><input className={field} required placeholder="Approved Meta template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} /><input className={field} placeholder="Template language (en)" value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} /><textarea className={field + " sm:col-span-2"} rows={3} placeholder="Template components JSON (optional)" value={templateComponentsJson} onChange={(e) => setTemplateComponentsJson(e.target.value)} /></> : <><textarea className={field} required maxLength={4000} placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} /><input className={field} required type="datetime-local" value={customerInitiatedAt} onChange={(e) => setCustomerInitiatedAt(e.target.value)} aria-label="Customer initiated conversation time" /></>}
        <input className={field + " sm:col-span-2"} required minLength={10} maxLength={500} placeholder="Opt-in evidence (e.g. website checkout consent on 2026-11-23)" value={consentStatement} onChange={(e) => setConsentStatement(e.target.value)} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} required /> Customer has explicitly opted in to receive WhatsApp messages.</label>
        <button className={primary} disabled={busy || !consentConfirmed || consentStatement.trim().length < 10}>Send WhatsApp message</button>
      </form>
      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold">Recent WhatsApp delivery statuses</h3>
        {whatsappLogs.length ? whatsappLogs.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t py-2 text-xs"><span>{item.recipient_phone} · {item.message_type === "template" ? item.template_name : "Text"} · {new Date(item.created_at).toLocaleString()}</span><span className={item.status === "failed" ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{item.status}{item.error_code ? " · " + item.error_code : ""}</span></div>) : <p className="text-xs text-slate-500">No WhatsApp messages recorded yet.</p>}
      </div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Public API & MCP access</h2>
      <p className="mt-1 text-xs text-slate-500">Read-only workspace API with scoped, expiring, revocable keys. The secret is displayed once only. Keep it on a trusted server, never in browser code.</p>
      <form onSubmit={createKey} className="mt-3 space-y-2">
        <input className={field} required minLength={2} maxLength={80} value={apiLabel} onChange={(e) => setApiLabel(e.target.value)} placeholder="API key label" />
        <div className="flex flex-wrap gap-3 text-sm">{["workspace.read","invoices.read","clients.read","expenses.read","leads.read","inventory.read","suppliers.read","mcp.read"].map((scope) => <label key={scope} className="flex items-center gap-1"><input type="checkbox" checked={apiScopes.includes(scope)} onChange={() => toggleScope(scope)} />{scope}</label>)}</div>
        <button className={primary} disabled={busy || apiScopes.length === 0}>Create API key</button>
      </form>
      {newSecret && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Copy this API key now</p><code className="mt-2 block break-all text-xs">{newSecret}</code><button type="button" className={secondary + " mt-2"} onClick={() => navigator.clipboard.writeText(newSecret)}>Copy secret</button></div>}
      <div className="mt-3 space-y-2">{apiKeys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{key.label} · {key.key_prefix} · expires {new Date(key.expires_at).toLocaleDateString()}</span>{key.revoked_at ? <span className="text-slate-500">Revoked</span> : <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => { await invoke({ action: "api-key.revoke", workspaceId, keyId: key.id }); await refresh(); }, "API key revoked.")}>Revoke</button>}</div>)}</div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold">MCP endpoint</p><code>https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/global-platform</code><p className="mt-1">Headers: <code>apikey: SUPABASE_ANON_KEY</code> and <code>x-plivex-key: YOUR_KEY</code>. JSON-RPC methods: <code>tools/list</code> and <code>tools/call</code>. Read-only tools: workspace_summary, list_invoices, list_clients, list_expenses, list_leads, low_stock_items, list_suppliers, business_insights.</p></div>
    </section>
  </section>;
}

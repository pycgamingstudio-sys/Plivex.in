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
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState("invoice");
  const [ocrResult, setOcrResult] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [messageType, setMessageType] = useState("template");
  const [message, setMessage] = useState("");
  const [customerInitiatedAt, setCustomerInitiatedAt] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("en");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [apiLabel, setApiLabel] = useState("Accounting integration");
  const [apiScopes, setApiScopes] = useState(["workspace.read", "invoices.read", "clients.read", "mcp.read"]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newSecret, setNewSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [signatureData, keyData] = await Promise.all([
      invoke({ action: "signature.list", workspaceId }),
      invoke({ action: "api-key.list", workspaceId }),
    ]);
    setSignatures(signatureData.requests || []);
    setApiKeys(keyData.keys || []);
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
    if (!file || file.size > 8 * 1024 * 1024) throw new Error("Choose a file up to 8 MB.");
    const result = await invoke({ action: "ocr.process", workspaceId, documentType, mimeType: file.type, fileBase64: await fileBase64(file) });
    setOcrResult(result);
  }, "OCR extraction completed. Review every field before using it.");
  const sendMessage = (event) => {
    event.preventDefault();
    run(async () => {
      await invoke({ action: "whatsapp.send", workspaceId, recipientPhone, messageType, message, customerInitiatedAt: customerInitiatedAt ? new Date(customerInitiatedAt).toISOString() : null, templateName, templateLanguage, consentConfirmed });
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
      <p className="mt-1 text-xs text-slate-500">Upload an invoice, receipt or purchase order. Extraction is a draft and never posts accounting or inventory records automatically.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select className={field} value={documentType} onChange={(e) => setDocumentType(e.target.value)}><option value="invoice">Invoice</option><option value="receipt">Receipt</option><option value="purchase_order">Purchase order</option><option value="identity">Identity document</option><option value="other">Other</option></select>
        <input className={field} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button className={primary} type="button" disabled={busy || !file} onClick={runOcr}>Extract document data</button>
      </div>
      {ocrResult && <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(ocrResult.extracted, null, 2)}</pre>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">WhatsApp Cloud messaging</h2>
      <p className="mt-1 text-xs text-slate-500">Requires Meta WhatsApp Cloud API credentials in Supabase secrets and documented customer opt-in. Free-form text is restricted to the 24-hour customer-service window; outside it use an approved template.</p>
      <form onSubmit={sendMessage} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input className={field} required placeholder="Recipient phone (+country code)" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
        <select className={field} value={messageType} onChange={(e) => setMessageType(e.target.value)}><option value="template">Approved template</option><option value="text">Free-form (24-hour window)</option></select>
        {messageType === "template" ? <><input className={field} required placeholder="Approved Meta template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} /><input className={field} placeholder="Template language (en)" value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} /></> : <><textarea className={field} required maxLength={4000} placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} /><input className={field} required type="datetime-local" value={customerInitiatedAt} onChange={(e) => setCustomerInitiatedAt(e.target.value)} aria-label="Customer initiated conversation time" /></>}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} required /> Customer has explicitly opted in to receive WhatsApp messages.</label>
        <button className={primary} disabled={busy || !consentConfirmed}>Send WhatsApp message</button>
      </form>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Public API & MCP access</h2>
      <p className="mt-1 text-xs text-slate-500">Read-only workspace API with scoped, expiring, revocable keys. The secret is displayed once only. Keep it on a trusted server, never in browser code.</p>
      <form onSubmit={createKey} className="mt-3 space-y-2">
        <input className={field} required minLength={2} maxLength={80} value={apiLabel} onChange={(e) => setApiLabel(e.target.value)} placeholder="API key label" />
        <div className="flex flex-wrap gap-3 text-sm">{["workspace.read","invoices.read","clients.read","mcp.read"].map((scope) => <label key={scope} className="flex items-center gap-1"><input type="checkbox" checked={apiScopes.includes(scope)} onChange={() => toggleScope(scope)} />{scope}</label>)}</div>
        <button className={primary} disabled={busy || apiScopes.length === 0}>Create API key</button>
      </form>
      {newSecret && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Copy this API key now</p><code className="mt-2 block break-all text-xs">{newSecret}</code><button type="button" className={secondary + " mt-2"} onClick={() => navigator.clipboard.writeText(newSecret)}>Copy secret</button></div>}
      <div className="mt-3 space-y-2">{apiKeys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{key.label} · {key.key_prefix} · expires {new Date(key.expires_at).toLocaleDateString()}</span>{key.revoked_at ? <span className="text-slate-500">Revoked</span> : <button type="button" className={secondary} disabled={busy} onClick={() => run(async () => { await invoke({ action: "api-key.revoke", workspaceId, keyId: key.id }); await refresh(); }, "API key revoked.")}>Revoke</button>}</div>)}</div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold">MCP endpoint</p><code>https://sqzpaiibmfsvarrkwkvb.supabase.co/functions/v1/global-platform</code><p className="mt-1">Header: <code>x-plivex-key: YOUR_KEY</code>. JSON-RPC methods: <code>tools/list</code> and <code>tools/call</code>. Read-only tools: workspace_summary, list_invoices, list_clients.</p></div>
    </section>
  </section>;
}

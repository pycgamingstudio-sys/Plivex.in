import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/backendClient";

export default function PublicSignaturePage() {
  const { token = "" } = useParams();
  const [signatureName, setSignatureName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("global-platform", {
        body: { action: "signature.complete", token, signatureName, consent },
      });
      if (invokeError) {
        let message = invokeError.message;
        try { message = (await invokeError.context.clone().json()).error || message; } catch { /* fallback */ }
        throw new Error(message);
      }
      if (!data?.ok) throw new Error(data?.error || "Signing request could not be completed.");
      setResult(data);
    } catch (caught) { setError(caught.message || "Signing failed."); }
    finally { setBusy(false); }
  };
  if (result) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><section className="w-full max-w-lg rounded-2xl border bg-white p-7 shadow-sm"><h1 className="text-2xl font-bold text-slate-900">Signature recorded</h1><p className="mt-2 text-sm text-slate-600">Your electronic signature and consent have been recorded with an audit timestamp.</p><dl className="mt-5 space-y-2 break-all text-xs"><dt className="font-semibold">Signed at</dt><dd>{new Date(result.signedAt).toLocaleString()}</dd><dt className="font-semibold">Document SHA-256</dt><dd>{result.documentSha256}</dd><dt className="font-semibold">Audit SHA-256</dt><dd>{result.auditSha256}</dd></dl><p className="mt-5 text-xs text-slate-500">This is an electronic-signature audit record, not a qualified or government-certified digital signature.</p></section></main>;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><section className="w-full max-w-lg rounded-2xl border bg-white p-7 shadow-sm"><p className="text-sm font-bold text-violet-700">PLIVEX · SECURE SIGNING</p><h1 className="mt-2 text-2xl font-bold text-slate-900">Review and sign</h1><p className="mt-2 text-sm text-slate-600">Enter your full name exactly as it appears on the signing request. Confirm your consent to record an electronic signature.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm font-medium">Full name<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3" required minLength={2} maxLength={160} value={signatureName} onChange={(e) => setSignatureName(e.target.value)} /></label><label className="flex items-start gap-2 text-sm leading-6"><input className="mt-1" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I agree to sign this document electronically and confirm that the typed name above represents my signature.</span></label><button className="w-full rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || !consent}>{busy ? "Recording signature…" : "Sign document"}</button></form><p className="mt-5 text-xs text-slate-500">Your signature is stored with a timestamp, document hash and audit metadata. This workflow does not claim qualified eIDAS, Aadhaar eSign or other government-certified status.</p></section></main>;
}

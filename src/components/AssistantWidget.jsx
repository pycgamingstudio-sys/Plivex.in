import { useEffect, useRef, useState } from "react";
import { Send, X, Sparkles, CheckCircle2, Loader2, PlusCircle } from "lucide-react";
import { assistantEnabled, supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";

const STARTERS = [
  "Mere pending invoices aur total pending amount batao",
  "Low stock items kaun se hain?",
  "Mere total clients aur recent expenses batao",
];

async function readableError(error) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      const body = await response.clone().json();
      if (body?.error) return body.error;
    }
  } catch { /* fall back to the SDK message */ }
  return error?.message || "Could not connect to the assistant. Please try again.";
}

export default function AssistantWidget() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState(null);
  const bottomRef = useRef(null);
  const enabled = assistantEnabled && isAuthenticated && !isLoadingAuth;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, open]);

  if (!enabled) return null;

  async function send(raw = draft) {
    const content = String(raw || "").trim().slice(0, 1000);
    if (!content || busy) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setError("");
    setRetryAction(null);
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("assistant-chat", {
        body: { messages: next.slice(-12).map(({ role, content: text }) => ({ role, content: text })) },
      });
      if (invokeError) throw invokeError;
      if (!data?.reply) throw new Error("AI returned an empty response. Please try again.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: data.reply,
        pendingAction: data.pendingAction || null,
        actionStatus: data.pendingAction ? "pending" : null,
      }]);
    } catch (err) {
      setRetryAction(null);
      setError(await readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(action, messageIndex) {
    if (!action || busy) return;
    setError("");
    setRetryAction(null);
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("assistant-confirm", {
        body: { action },
      });
      if (invokeError) throw invokeError;
      setRetryAction(null);
      setMessages((current) => {
        const updated = current.map((message, index) => index === messageIndex
          ? { ...message, pendingAction: null, actionStatus: "done" }
          : message);
        return [...updated, { role: "assistant", content: data?.reply || "The record was saved." }];
      });
    } catch (err) {
      setRetryAction({ action, messageIndex });
      setError(await readableError(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelAction(messageIndex) {
    setRetryAction(null);
    setMessages((current) => current.map((message, index) => index === messageIndex
      ? { ...message, pendingAction: null, actionStatus: "cancelled" }
      : message));
  }

  return (
    <div className="notranslate">
      {!open ? (
        <button onClick={() => setOpen(true)} aria-label="Open Plivex AI assistant" className="fixed bottom-20 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#6D28D9] text-white shadow-xl hover:bg-[#5B21B6] md:bottom-5">
          <Sparkles className="h-6 w-6" />
        </button>
      ) : (
        <section role="dialog" aria-label="Plivex AI assistant" className="fixed bottom-20 left-3 right-3 z-[70] flex h-[70vh] max-h-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[390px] md:bottom-4">
          <header className="flex items-center justify-between bg-[#6D28D9] px-4 py-3 text-white">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5" /><div><p className="text-sm font-bold">Plivex AI Assistant</p><p className="text-[11px] opacity-80">Live workspace · Gemini</p></div></div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4">
            {messages.length === 0 && <div className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <p className="font-semibold text-slate-800">Namaste! I can check live data in your Plivex workspace.</p>
              <p className="mt-1 text-xs">I can read invoices, clients, stock, expenses, quotations, leads and services. I can prepare new clients, expenses, leads, stock items and quotations for your confirmation. I won't save anything until you tap Confirm & Add.</p>
              <div className="mt-3 flex flex-wrap gap-2">{STARTERS.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs text-purple-800">{q}</button>)}</div>
            </div>}
            {messages.map((m, i) => <div key={m.id || i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user" ? "max-w-[90%] whitespace-pre-wrap rounded-2xl bg-[#6D28D9] px-3.5 py-2.5 text-sm text-white" : "max-w-[94%] whitespace-pre-wrap rounded-2xl bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm"}>
                {m.content}
                {m.pendingAction && <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-900"><PlusCircle className="h-4 w-4" /> Ready to add</div>
                  <p className="mt-1 text-sm font-medium text-slate-800">{m.pendingAction.summary}</p>
                  <p className="mt-1 text-[11px] text-slate-600">Nothing is saved until you confirm. Plivex permissions still apply.</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => confirmAction(m.pendingAction, i)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm & Add</button>
                    <button disabled={busy} onClick={() => cancelAction(i)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Cancel</button>
                  </div>
                </div>}
                {m.actionStatus === "done" && <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved to Plivex</p>}
                {m.actionStatus === "cancelled" && <p className="mt-2 text-[11px] text-slate-500">Addition cancelled; nothing was saved.</p>}
              </div>
            </div>)}
            {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Gemini is checking your workspace…</p>}
            {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error} <button onClick={() => retryAction ? confirmAction(retryAction.action, retryAction.messageIndex) : send(messages[messages.length - 1]?.content)} className="ml-1 font-bold underline">Retry</button></div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Ask about your live Plivex data…" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-purple-500" />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#6D28D9] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form>
        </section>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X, Sparkles } from "lucide-react";
import { assistantEnabled, supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";

const STARTERS = ["Help me understand my sales dashboard", "How can I follow up on pending payments?", "How should I manage low stock?"];

export default function AssistantWidget() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("assistant-chat", {
        body: { messages: next.slice(-16).map(({ role, content: text }) => ({ role, content: text })) },
      });
      if (invokeError) throw invokeError;
      if (!data?.reply) throw new Error("AI returned an empty response. Please try again.");
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
    } catch (err) {
      const message = err?.context?.error || err?.message || "Could not connect to the assistant. Please try again.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notranslate">
      {!open ? (
        <button onClick={() => setOpen(true)} aria-label="Open Plivex AI assistant" className="fixed bottom-20 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#6D28D9] text-white shadow-xl hover:bg-[#5B21B6] md:bottom-5">
          <Sparkles className="h-6 w-6" />
        </button>
      ) : (
        <section role="dialog" aria-label="Plivex AI assistant" className="fixed bottom-20 left-3 right-3 z-[70] flex h-[70vh] max-h-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[390px] md:bottom-4">
          <header className="flex items-center justify-between bg-[#6D28D9] px-4 py-3 text-white">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5" /><div><p className="text-sm font-bold">Plivex AI Assistant</p><p className="text-[11px] opacity-80">Powered by Gemini</p></div></div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4">
            {messages.length === 0 && <div className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <p>Namaste! I can answer questions and help you use Plivex. I do not yet read your live invoices, clients, or stock records.</p>
              <div className="mt-3 flex flex-wrap gap-2">{STARTERS.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs text-purple-800">{q}</button>)}</div>
            </div>}
            {messages.map((m, i) => <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-[#6D28D9] text-white" : "bg-white text-slate-800 shadow-sm"}`}>{m.content}</div>
            </div>)}
            {busy && <p className="text-xs text-slate-500">Gemini is thinking…</p>}
            {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error} <button onClick={() => send(messages[messages.length - 1]?.content)} className="ml-1 font-bold underline">Retry</button></div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Ask Plivex AI…" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-purple-500" />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#6D28D9] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form>
        </section>
      )}
    </div>
  );
}

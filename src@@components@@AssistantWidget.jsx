import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { backend as db, assistantEnabled } from "@/api/backendClient";
import { getLang } from "@/lib/i18n";
import { hydrateWorkspaceData, hasPendingWrites } from "@/lib/stores";

const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
const SUGGESTIONS = ["Aaj ki bikri kitni hui?", "Kiska payment baaki hai?", "Kaunsa stock kam hai?"];
const INTRO_KEY = (uid) => `plivex:assistant-intro:${uid}`;

// Floating business assistant. Writes are only ever done after the user taps "Haan".
export default function AssistantWidget() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(null);
  const endRef = useRef(null);

  const onAuthPage = AUTH_PATHS.some((p) => window.location.pathname.startsWith(p));
  const ready = assistantEnabled && isAuthenticated && !isLoadingAuth && !!user?.workspace_id && !onAuthPage;

  // New-feature popup: shown only once per user on this device, and only after the language is chosen.
  useEffect(() => {
    if (!ready || !user?.id || !getLang()) return;
    try {
      if (localStorage.getItem(INTRO_KEY(user.id))) return;
      localStorage.setItem(INTRO_KEY(user.id), "1");
    } catch { return; }
    const t = window.setTimeout(() => setShowIntro(true), 2500);
    return () => window.clearTimeout(t);
  }, [ready, user?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, action, busy, open]);

  if (!ready) return null;

  const push = (role, content) => setMessages((m) => [...m, { role, content }]);

  const send = async (raw) => {
    const content = String(raw ?? text).trim().slice(0, 1000);
    if (!content || busy) return;
    setText(""); setAction(null);
    const next = [...messages, { role: "user", content }];
    setMessages(next); setBusy(true);
    try {
      const res = await db.functions.invoke("assistantChat", { messages: next.slice(-20) });
      const d = res?.data || {};
      push("assistant", d.reply || "Maaf kijiye, mujhe jawab nahi mila.");
      if (d.proposedAction?.actionId) setAction(d.proposedAction);
    } catch (e) {
      push("assistant", e?.status === 429 ? "Aapne bahut sawal pooch liye. Thodi der baad dobara try karein." : (e?.message || "Kuch gadbad ho gayi. Dobara try karein."));
    } finally { setBusy(false); }
  };

  const decide = async (decision) => {
    if (!action || busy) return;
    setBusy(true);
    try {
      const res = await db.functions.invoke("assistantConfirm", { actionId: action.actionId, decision });
      const r = res?.data || {};
      push("assistant", decision === "cancel" ? "Theek hai, kuch nahi kiya." : (r.result?.message || "Ho gaya ✅"));
      if (decision === "confirm" && !hasPendingWrites()) hydrateWorkspaceData();
    } catch (e) {
      push("assistant", e?.message || "Ye kaam nahi ho paya.");
    } finally { setAction(null); setBusy(false); }
  };

  const openChat = () => { setShowIntro(false); setOpen(true); };

  return (
    <div className="notranslate">
      {showIntro && !open && (
        <div className="fixed bottom-24 right-4 z-[60] w-[260px] rounded-2xl border border-border bg-card p-4 shadow-xl" role="status">
          <p className="flex items-center gap-1.5 text-xs font-bold text-primary"><Sparkles className="h-3.5 w-3.5" />{getLang() === "hi" ? "नया फ़ीचर" : "New feature"}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{getLang() === "hi" ? "अपना बिज़नेस असिस्टेंट आज़माएं" : "Try your own business assistant"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{getLang() === "hi" ? "पूछिए: आज की बिक्री कितनी हुई?" : "Ask: how much did I sell today?"}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={openChat} className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">{getLang() === "hi" ? "आज़माएं" : "Try it"}</button>
            <button onClick={() => setShowIntro(false)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground">{getLang() === "hi" ? "बाद में" : "Later"}</button>
          </div>
        </div>
      )}

      {!open && (
        <button onClick={openChat} aria-label="Assistant" className="fixed bottom-5 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 left-3 right-3 z-[70] flex h-[75vh] max-h-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:left-auto sm:w-[390px]" role="dialog" aria-label="Assistant">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" />{getLang() === "hi" ? "बिज़नेस असिस्टेंट" : "Business Assistant"}</p>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div>
                <p className="text-sm text-muted-foreground">{getLang() === "hi" ? "नमस्ते! मुझसे अपने बिज़नेस के बारे में पूछिए, जैसे बिक्री, बकाया पेमेंट, स्टॉक या क्लाइंट।" : "Hi! Ask me about your business: sales, pending payments, stock or clients."}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((q) => (
                    <button key={q} onClick={() => send(q)} className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{m.content}</div>
              </div>
            ))}
            {action && (
              <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">{action.summary}</p>
                <div className="mt-3 flex gap-2">
                  <button disabled={busy} onClick={() => decide("confirm")} className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{getLang() === "hi" ? "हाँ, कर दो" : "Haan, kar do"}</button>
                  <button disabled={busy} onClick={() => decide("cancel")} className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60">{getLang() === "hi" ? "नहीं" : "Nahi"}</button>
                </div>
              </div>
            )}
            {busy && <p className="text-xs text-muted-foreground">{getLang() === "hi" ? "सोच रहा हूँ…" : "Soch raha hoon…"}</p>}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-border p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              maxLength={1000}
              placeholder={getLang() === "hi" ? "यहाँ लिखें…" : "Type here…"}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] text-foreground outline-none"
            />
            <button onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

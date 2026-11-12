import { useEffect, useRef, useState } from "react";
import { Send, X, Sparkles, CheckCircle2, Loader2, PlusCircle, ImagePlus, Mic, MicOff } from "lucide-react";
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
  const { isAuthenticated, isLoadingAuth, user } = useAuth();
  const [open, setOpen] = useState(false);
  const storageKey = user?.id ? `plivex-ai-chat:${user.id}` : null;
  const [messages, setMessages] = useState(() => { try { const saved = user?.id ? localStorage.getItem(`plivex-ai-chat:${user.id}`) : null; return saved ? JSON.parse(saved).slice(-40) : []; } catch { return []; } });
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState(null);
  const imageInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const bottomRef = useRef(null);
  const dragRef = useRef(null);
  const suppressFabClickRef = useRef(false);
  const [fabPosition, setFabPosition] = useState(null);
  const enabled = assistantEnabled && isAuthenticated && !isLoadingAuth;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, open]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const safeMessages = messages.slice(-40).map(({ imageDataUrl, ...message }) => message);
      localStorage.setItem(storageKey, JSON.stringify(safeMessages));
    } catch { /* chat history is best-effort; never block assistant use */ }
  }, [messages, storageKey]);


  if (!enabled) return null;

  function startFabDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveFabDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    const size = 56;
    const left = Math.max(8, Math.min(window.innerWidth - size - 8, drag.left + dx));
    const top = Math.max(8, Math.min(window.innerHeight - size - 8, drag.top + dy));
    setFabPosition({ left, top });
    event.preventDefault();
  }

  function endFabDrag(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (dragRef.current.moved) suppressFabClickRef.current = true;
    dragRef.current = null;
  }

  async function send(raw = draft) {
    const content = String(raw || "").trim().slice(0, 1000);
    if ((!content && !attachment) || busy) return;
    const sentAttachment = attachment;
    const next = [...messages, { role: "user", content: content || (sentAttachment ? "Please add this receipt as an expense and prepare the extracted details for confirmation." : ""), imageDataUrl: sentAttachment || null }];
    setMessages(next);
    setAttachment(null);
    setDraft("");
    setError("");
    setRetryAction(null);
    setBusy(true);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await supabase.functions.invoke("assistant-chat", {
          body: {
            messages: next.slice(-16).map(({ role, content: text }) => ({ role, content: String(text || "").slice(0, 1200) })),
            image: sentAttachment ? { mimeType: sentAttachment.slice(5, sentAttachment.indexOf(";")), data: sentAttachment.split(",")[1] } : null,
          },
          signal: controller.signal,
        });
      } finally { window.clearTimeout(timeout); }
      const { data, error: invokeError } = response;
      if (invokeError) throw invokeError;
      if (!data?.reply) throw new Error("AI returned an empty response. Please try again.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: data.reply,
        pendingAction: data.pendingAction || null,
        pendingActions: data.pendingActions || null,
        idempotencyKey: data.idempotencyKey || data.pendingAction?.idempotencyKey || null,
        actionStatus: (data.pendingAction || data.pendingActions?.length) ? "pending" : null,
      }]);
    } catch (err) {
      setRetryAction(null);
      setError(await readableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction(actions, idempotencyKey, messageIndex) {
    if (!actions?.length || !idempotencyKey || busy) return;
    setError("");
    setRetryAction(null);
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("assistant-confirm", {
        body: { actions, idempotencyKey },
      });
      if (invokeError) throw invokeError;
      setRetryAction(null);
      setMessages((current) => {
        const updated = current.map((message, index) => index === messageIndex
          ? { ...message, pendingAction: null, pendingActions: null, actionStatus: "done" }
          : message);
        return [...updated, { role: "assistant", content: actions.some((action) => action?.type === "create_invoice") ? "Invoice draft saved. Open Invoice History → Drafts to find and download it." : (data?.reply || "The record was saved.") }];
      });
    } catch (err) {
      setRetryAction({ actions, idempotencyKey, messageIndex });
      setError(await readableError(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelAction(messageIndex) {
    setRetryAction(null);
    setMessages((current) => current.map((message, index) => index === messageIndex
      ? { ...message, pendingAction: null, pendingActions: null, idempotencyKey: null, actionStatus: "cancelled" }
      : message));
  }

  function toggleVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice typing is not supported in this browser. Please use your phone keyboard microphone.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = /[\u0900-\u097F]/.test(draft) ? "hi-IN" : "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript || "").join(" ");
      setDraft((current) => (current ? current + " " : "") + transcript);
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Voice could not be captured. Please try again or type your request.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }

  return (
    <div className="notranslate">
      {!open ? (
        <button onClick={() => { if (suppressFabClickRef.current) { suppressFabClickRef.current = false; return; } setOpen(true); }} onPointerDown={startFabDrag} onPointerMove={moveFabDrag} onPointerUp={endFabDrag} onPointerCancel={endFabDrag} aria-label="Drag or open Plivex AI assistant" title="Drag to move; tap to open" style={fabPosition ? { left: fabPosition.left, top: fabPosition.top, right: "auto", bottom: "auto", touchAction: "none" } : { touchAction: "none" }} className={`fixed ${fabPosition ? "" : "bottom-20 right-4 md:bottom-5"} z-[60] flex h-14 w-14 cursor-grab items-center justify-center rounded-full bg-[#6D28D9] text-white shadow-xl hover:bg-[#5B21B6] active:cursor-grabbing`}>
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
              <p className="mt-1 text-xs">I can read invoices, clients, stock, expenses, quotations, leads and services. I can prepare invoice drafts, clients, expenses, leads, stock items and quotations for your confirmation. I won't save anything until you tap Confirm & Add.</p>
              <div className="mt-3 flex flex-wrap gap-2">{STARTERS.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs text-purple-800">{q}</button>)}</div>
            </div>}
            {messages.map((m, i) => <div key={m.id || i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user" ? "max-w-[90%] whitespace-pre-wrap rounded-2xl bg-[#6D28D9] px-3.5 py-2.5 text-sm text-white" : "max-w-[94%] whitespace-pre-wrap rounded-2xl bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm"}>
                {m.content}
                {m.imageDataUrl && <img src={m.imageDataUrl} alt="Attached business document" className="mt-2 max-h-40 max-w-full rounded-lg border border-slate-200 object-contain" />}
                {(m.pendingAction || m.pendingActions?.length) && <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-900"><PlusCircle className="h-4 w-4" /> {m.pendingActions?.length > 1 ? "Ready to complete " + m.pendingActions.length + " actions" : "Ready to add"}</div>
                  <div className="mt-2 space-y-2">{(m.pendingActions || [m.pendingAction]).map((action, actionIndex) => <p key={actionIndex} className="text-sm font-medium text-slate-800">{actionIndex + 1}. {action.summary}</p>)}</div>
                  <p className="mt-2 text-[11px] text-slate-600">Nothing is saved until you confirm. All actions are validated together; if one fails, the batch is rolled back.</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => confirmAction(m.pendingActions || [m.pendingAction], m.idempotencyKey || m.pendingAction?.idempotencyKey, i)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Add</>}</button>
                    <button disabled={busy} onClick={() => cancelAction(i)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Cancel</button>
                  </div>
                </div>}
                {m.actionStatus === "done" && <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved to Plivex</p>}
                {m.actionStatus === "cancelled" && <p className="mt-2 text-[11px] text-slate-500">Addition cancelled; nothing was saved.</p>}
              </div>
            </div>)}
            {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Plivex AI is reading your request…</p>}
            {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error} <button onClick={() => retryAction ? confirmAction(retryAction.actions, retryAction.idempotencyKey, retryAction.messageIndex) : send(messages[messages.length - 1]?.content)} className="ml-1 font-bold underline">Retry</button></div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-slate-200 bg-white p-3">
            {attachment && <div className="mb-2 flex items-center gap-2 rounded-lg bg-purple-50 p-2"><img src={attachment} alt="Receipt preview" className="h-12 w-12 rounded object-cover" /><span className="min-w-0 flex-1 text-xs text-purple-900">Image attached · ready for AI review</span><button type="button" onClick={() => setAttachment(null)} className="rounded px-2 py-1 text-xs text-slate-600">Remove</button></div>}
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) { setError("Image must be smaller than 12 MB."); e.target.value = ""; return; } const reader = new FileReader(); reader.onload = () => { const source = typeof reader.result === "string" ? reader.result : ""; const img = new Image(); img.onload = () => { const max = 1800; const ratio = Math.min(1, max / Math.max(img.width, img.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.width * ratio)); canvas.height = Math.max(1, Math.round(img.height * ratio)); const ctx = canvas.getContext("2d"); if (!ctx) { setError("Image processing unavailable."); return; } ctx.drawImage(img, 0, 0, canvas.width, canvas.height); setAttachment(canvas.toDataURL("image/jpeg", 0.9)); }; img.onerror = () => setError("Could not read this image. Please choose another photo."); img.src = source; }; reader.readAsDataURL(file); e.target.value = ""; }} />
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy} aria-label="Attach receipt or image" title="Attach receipt or image" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-[#6D28D9] disabled:opacity-50"><ImagePlus className="h-5 w-5" /></button>
              <button type="button" onClick={toggleVoiceInput} disabled={busy} aria-label={listening ? "Stop voice input" : "Start voice input"} title={listening ? "Stop voice input" : "Speak to Plivex AI"} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border disabled:opacity-50 ${listening ? "border-red-300 bg-red-50 text-red-600" : "border-slate-200 text-[#6D28D9]"}`}>{listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Ask Plivex AI or add a receipt…" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-purple-500" />
              <button type="submit" disabled={busy || (!draft.trim() && !attachment)} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#6D28D9] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

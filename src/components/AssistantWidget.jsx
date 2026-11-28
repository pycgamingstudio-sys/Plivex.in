import { useEffect, useRef, useState } from "react";
import { Send, X, Sparkles, CheckCircle2, Loader2, PlusCircle, ImagePlus, Mic, MicOff, Volume2, VolumeX, FileText } from "lucide-react";
import { assistantEnabled, supabase } from "@/api/backendClient";
import { useAuth } from "@/lib/AuthContext";
import { refreshWorkspaceKey } from "@/lib/stores";
import { isAffirmativeConfirmation } from "@/lib/assistant-confirmation-intent";
import { streamAssistantChat } from "@/lib/assistant-streaming.mjs";
import { getAssistantSpeechLanguage, normalizeAssistantSpeechText } from "@/lib/assistant-speech.mjs";

const STARTERS = [
  "Mere business ki performance review karo",
  "Sales aur expenses compare karke samjhao",
  "Profit aur cash flow improve karne ke ideas do",
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

export default function AssistantWidget({ openOnMount = false }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [open, setOpen] = useState(openOnMount);
  useEffect(() => { if (openOnMount) setOpen(true); }, [openOnMount]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentMimeType, setAttachmentMimeType] = useState("");
  const imageInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState(null);
  const [listening, setListening] = useState(false);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null);
  const recognitionRef = useRef(null);
  const bottomRef = useRef(null);
  const dragRef = useRef(null);
  const suppressFabClickRef = useRef(false);
  const [fabPosition, setFabPosition] = useState(null);
  const enabled = assistantEnabled && isAuthenticated && !isLoadingAuth;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => () => {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);
  // Chat is intentionally session-only: reload starts a fresh conversation.
  // Do not persist messages in localStorage, so stale tasks cannot reappear.


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
    // A clear text-only affirmation confirms the most recent pending draft
    // through the same idempotent endpoint as the visible Confirm & Save button.
    const lastIndex = messages.length - 1;
    const lastMessage = lastIndex >= 0 ? messages[lastIndex] : null;
    const pendingActions = lastMessage?.pendingActions || (lastMessage?.pendingAction ? [lastMessage.pendingAction] : []);
    const pendingKey = lastMessage?.idempotencyKey || lastMessage?.pendingAction?.idempotencyKey;
    if (!attachment && isAffirmativeConfirmation(content) && lastMessage?.role === "assistant" &&
        lastMessage?.actionStatus === "pending" && pendingActions.length && pendingKey) {
      setDraft("");
      setError("");
      await confirmAction(pendingActions, pendingKey, lastIndex);
      return;
    }
    const sentAttachment = attachment;
    const sentAttachmentName = attachmentName;
    const sentAttachmentMimeType = attachmentMimeType;
    const next = [...messages, { role: "user", content: content || (sentAttachment ? "Please inspect this attached file or image, describe what it shows, and extract any relevant business details. Do not create a record unless I ask." : ""), imageDataUrl: sentAttachment || null, attachmentName: sentAttachmentName, attachmentMimeType: sentAttachmentMimeType }];
    setMessages([...next, { role: "assistant", content: "", isStreaming: true }]);
    setAttachment(null);
    setAttachmentName("");
    setAttachmentMimeType("");
    setDraft("");
    setError("");
    setRetryAction(null);
    setBusy(true);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 60000);
      let data;
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = sessionData?.session?.access_token;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!accessToken) throw new Error("Your session expired. Please sign in again.");
        if (!supabaseUrl || !anonKey) throw new Error("AI assistant is not configured. Please contact support.");
        data = await streamAssistantChat({
          url: supabaseUrl.replace(/\/+$/, "") + "/functions/v1/assistant-chat",
          anonKey,
          accessToken,
          body: {
            messages: next.slice(-16).map(({ role, content: text }) => ({ role, content: String(text || "").slice(0, 1200) })),
            image: sentAttachment ? { mimeType: sentAttachmentMimeType || sentAttachment.slice(5, sentAttachment.indexOf(";")), data: sentAttachment.split(",")[1] } : null,
          },
          signal: controller.signal,
          onPartial: (partial) => setMessages((current) => {
            const index = current.length - 1;
            if (index < 0 || current[index]?.role !== "assistant" || !current[index]?.isStreaming) return current;
            const updated = [...current];
            updated[index] = { ...updated[index], content: partial };
            return updated;
          }),
        });
      } finally { window.clearTimeout(timeout); }
      setMessages((current) => {
        const index = current.length - 1;
        const completed = {
          role: "assistant", content: data.reply,
          pendingAction: data.pendingAction || null,
          pendingActions: data.pendingActions || null,
          idempotencyKey: data.idempotencyKey || data.pendingAction?.idempotencyKey || null,
          actionStatus: (data.pendingAction || data.pendingActions?.length) ? "pending" : null,
          isStreaming: false,
        };
        if (index >= 0 && current[index]?.role === "assistant" && current[index]?.isStreaming) {
          const updated = [...current];
          updated[index] = { ...current[index], ...completed };
          return updated;
        }
        return [...current, completed];
      });
    } catch (err) {
      setMessages((current) => {
        const index = current.length - 1;
        if (index >= 0 && current[index]?.role === "assistant" && current[index]?.isStreaming) return current.slice(0, index);
        return current;
      });
      // Keep the user's request (and attachment) available after provider/network
      // failures so they can retry without reconstructing the business instruction.
      setDraft(content);
      if (sentAttachment) {
        setAttachment(sentAttachment);
        setAttachmentName(sentAttachmentName || "Attached file");
        setAttachmentMimeType(sentAttachmentMimeType || sentAttachment.slice(5, sentAttachment.indexOf(";")));
      }
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
      // Bound confirmation latency in the browser. If the request is aborted after
      // the server has started, retryAction retains the same idempotency key so a
      // retry cannot create a second record.
      const controller = new AbortController();
      const confirmationTimeout = window.setTimeout(() => controller.abort(), 45000);
      let confirmation;
      try {
        confirmation = await supabase.functions.invoke("assistant-confirm", {
          body: { actions, idempotencyKey },
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(confirmationTimeout);
      }
      const { data, error: invokeError } = confirmation;
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || data?.reply || "Plivex did not confirm that these records were saved. Check the module before retrying.");
      setRetryAction(null);
      const affectedKeys = [...new Set(actions.map((action) => ({
        create_invoice: "history", create_expense: "expenses", create_global_expense: "expenses", create_stock: "stock",
        create_global_product: "stock", create_client: "clients", create_global_client: "clients", create_global_supplier: "suppliers", create_global_branch: "branches", set_global_member_permission: "members", request_global_approval: "approvals", transfer_global_stock: "stock",
        record_global_invoice_payment: "history", create_lead: "leads", create_quotation: "quotations",
        create_purchase_order: "stock",
        create_warehouse: "stock",
        receive_purchase_order: "stock",
      }[action?.type])).filter(Boolean))];
      await Promise.all(affectedKeys.map((key) => refreshWorkspaceKey(key)));
      window.dispatchEvent(new CustomEvent("plivex-workspace-data-updated", { detail: { keys: affectedKeys } }));
      setMessages((current) => {
        const updated = current.map((message, index) => index === messageIndex
          ? { ...message, pendingAction: null, pendingActions: null, actionStatus: data?.verified ? "done" : "unverified" }
          : message);
        const successMessage = data?.verified && actions.some((action) => action?.type === "create_invoice")
          ? "Invoice draft saved and verified. Open Invoice History → Drafts to find and download it."
          : (data?.reply || "The save operation status is unclear. Check the relevant module before retrying.");
        return [...updated, { role: "assistant", content: successMessage }];
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

  function speakMessage(value, messageIndex) {
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      setError("Voice playback is not supported in this browser. You can still read Nova's reply.");
      return;
    }
    if (speakingMessageIndex === messageIndex) {
      window.speechSynthesis.cancel();
      setSpeakingMessageIndex(null);
      return;
    }
    const spokenText = normalizeAssistantSpeechText(value);
    if (!spokenText) return;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(spokenText);
    utterance.lang = getAssistantSpeechLanguage(spokenText, navigator.language || "en-IN");
    const languagePrefix = utterance.lang.toLowerCase().split("-")[0];
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.onend = () => setSpeakingMessageIndex((current) => current === messageIndex ? null : current);
    utterance.onerror = () => {
      setSpeakingMessageIndex(null);
      setError("Voice playback stopped. Please try again or use your device's accessibility voice options.");
    };
    setError("");
    setSpeakingMessageIndex(messageIndex);
    window.speechSynthesis.speak(utterance);
  }

  function handleAttachmentChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!supportedTypes.includes(file.type)) {
      setError("Choose a JPG, PNG, WebP image or a PDF document.");
      event.target.value = "";
      return;
    }
    if (file.type === "application/pdf" && file.size > 4 * 1024 * 1024) {
      setError("PDF documents must be smaller than 4 MB.");
      event.target.value = "";
      return;
    }
    if (file.type !== "application/pdf" && file.size > 12 * 1024 * 1024) {
      setError("Image must be smaller than 12 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const source = typeof reader.result === "string" ? reader.result : "";
      if (!source) {
        setError("Could not read this file. Please choose another one.");
        return;
      }
      if (file.type === "application/pdf") {
        setAttachment(source);
        setAttachmentName(file.name);
        setAttachmentMimeType(file.type);
        setError("");
        return;
      }
      const img = new Image();
      img.onload = () => {
        const max = 1800;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const ctx = canvas.getContext("2d");
        if (!ctx) { setError("Image processing unavailable."); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setAttachment(canvas.toDataURL("image/jpeg", 0.9));
        setAttachmentName(file.name);
        setAttachmentMimeType("image/jpeg");
        setError("");
      };
      img.onerror = () => setError("Could not read this image. Please choose another photo.");
      img.src = source;
    };
    reader.onerror = () => setError("Could not read this file. Please choose another one.");
    reader.readAsDataURL(file);
    event.target.value = "";
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
    const browserLanguage = String(navigator.language || "en-IN").toLowerCase();
    const scriptHint = /[\u0900-\u097F]/.test(draft);
    recognition.lang = scriptHint ? "hi-IN" : (browserLanguage.startsWith("hi") ? "hi-IN" : browserLanguage.startsWith("en") ? "en-IN" : browserLanguage);
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
        <button onClick={() => { if (suppressFabClickRef.current) { suppressFabClickRef.current = false; return; } setOpen(true); }} onPointerDown={startFabDrag} onPointerMove={moveFabDrag} onPointerUp={endFabDrag} onPointerCancel={endFabDrag} aria-label="Drag or open Plivex Nova assistant" title="Drag to move; tap to open" style={fabPosition ? { left: fabPosition.left, top: fabPosition.top, right: "auto", bottom: "auto", touchAction: "none" } : { touchAction: "none" }} className={`fixed ${fabPosition ? "" : "bottom-20 right-4 md:bottom-5"} z-[60] flex h-14 w-14 cursor-grab items-center justify-center rounded-full bg-[#6D28D9] text-white shadow-xl hover:bg-[#5B21B6] active:cursor-grabbing`}>
          <Sparkles className="h-6 w-6" />
        </button>
      ) : (
        <section role="dialog" aria-label="Plivex Nova assistant" className="fixed bottom-20 left-3 right-3 z-[70] flex h-[70vh] max-h-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[390px] md:bottom-4">
          <header className="flex items-center justify-between bg-[#6D28D9] px-4 py-3 text-white">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5" /><div><p className="text-sm font-bold">Plivex Nova</p><p className="text-[11px] opacity-80">Your AI Business Manager</p></div></div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4">
            {messages.length === 0 && <div className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">
              <p className="font-semibold text-slate-800">Namaste! Apne business ke baare mein freely baat karein — Nova aapki madad ke liye hai.</p>
              <p className="mt-1 text-xs">Ask questions, discuss business strategy, understand reports, explore ideas, and ask follow-up questions in Hindi, Hinglish or English. Nova can also prepare supported business actions for your review. Nothing is saved until you confirm; unsupported actions are clearly identified.</p>
              <div className="mt-3 flex flex-wrap gap-2">{STARTERS.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-2 text-left text-xs text-purple-800">{q}</button>)}</div>
            </div>}
            {messages.map((m, i) => <div key={m.id || i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={m.role === "user" ? "max-w-[90%] whitespace-pre-wrap rounded-2xl bg-[#6D28D9] px-3.5 py-2.5 text-sm text-white" : "max-w-[94%] whitespace-pre-wrap rounded-2xl bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm"}>
                {m.content}
                {m.role === "assistant" && m.content && !m.isStreaming && <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => speakMessage(m.content, i)} aria-label={speakingMessageIndex === i ? "Stop reading reply aloud" : "Read reply aloud"} title={speakingMessageIndex === i ? "Stop voice playback" : "Read reply aloud"} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
                    {speakingMessageIndex === i ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    {speakingMessageIndex === i ? "Stop" : "Listen"}
                  </button>
                </div>}
                {m.imageDataUrl && (m.attachmentMimeType === "application/pdf" ? <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"><FileText className="h-4 w-4 text-[#6D28D9]" />{m.attachmentName || "Attached PDF document"}</div> : <img src={m.imageDataUrl} alt="Attached business image" className="mt-2 max-h-40 max-w-full rounded-lg border border-slate-200 object-contain" />)}
                {(m.pendingAction || m.pendingActions?.length) && <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-900"><PlusCircle className="h-4 w-4" /> {m.pendingActions?.length > 1 ? "Ready to complete " + m.pendingActions.length + " actions" : "Ready for confirmation"}</div>
                  <div className="mt-2 space-y-2">{(m.pendingActions || [m.pendingAction]).map((action, actionIndex) => <p key={actionIndex} className="text-sm font-medium text-slate-800">{actionIndex + 1}. {action.summary}</p>)}</div>
                  <p className="mt-2 text-[11px] text-slate-600">Nothing is saved until you confirm. Purchase orders and goods receipts are confirmed separately; other supported action batches are validated and executed atomically.</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} onClick={() => confirmAction(m.pendingActions || [m.pendingAction], m.idempotencyKey || m.pendingAction?.idempotencyKey, i)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Confirm & Save</>}</button>
                    <button disabled={busy} onClick={() => cancelAction(i)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Cancel</button>
                  </div>
                </div>}
                {m.actionStatus === "done" && <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved and verified in Plivex</p>}
                {m.actionStatus === "unverified" && <p role="status" className="mt-2 text-[11px] text-amber-700">Save was accepted, but verification is incomplete. Check the relevant Plivex module before retrying.</p>}
                {m.actionStatus === "cancelled" && <p className="mt-2 text-[11px] text-slate-500">Addition cancelled; nothing was saved.</p>}
              </div>
            </div>)}
            {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Nova is reading your request…</p>}
            {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error} <button onClick={() => retryAction ? confirmAction(retryAction.actions, retryAction.idempotencyKey, retryAction.messageIndex) : send(messages[messages.length - 1]?.content)} className="ml-1 font-bold underline">Retry</button></div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-slate-200 bg-white p-3">
            {attachment && <div className="mb-2 flex items-center gap-2 rounded-lg bg-purple-50 p-2">{attachmentMimeType === "application/pdf" ? <FileText className="h-8 w-8 shrink-0 text-[#6D28D9]" /> : <img src={attachment} alt="Attachment preview" className="h-12 w-12 rounded object-cover" />}<span className="min-w-0 flex-1 truncate text-xs text-purple-900">{attachmentMimeType === "application/pdf" ? "PDF attached" : "Image attached"} · {attachmentName || "Ready for AI review"}</span><button type="button" onClick={() => { setAttachment(null); setAttachmentName(""); setAttachmentMimeType(""); }} className="rounded px-2 py-1 text-xs text-slate-600">Remove</button></div>}
            <div className="flex items-center gap-2">
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleAttachmentChange} />
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={busy} aria-label="Attach receipt or image" title="Attach receipt or image" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-[#6D28D9] disabled:opacity-50"><ImagePlus className="h-5 w-5" /></button>
              <button type="button" onClick={toggleVoiceInput} disabled={busy} aria-label={listening ? "Stop voice input" : "Start voice input"} title={listening ? "Stop voice input" : "Speak to Nova"} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border disabled:opacity-50 ${listening ? "border-red-300 bg-red-50 text-red-600" : "border-slate-200 text-[#6D28D9]"}`}>{listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Ask Nova about your business…" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-purple-500" />
              <button type="submit" disabled={busy || (!draft.trim() && !attachment)} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#6D28D9] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

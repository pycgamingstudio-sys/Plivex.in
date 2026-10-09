import LanguageSwitcher from "@/components/LanguageSwitcher";
import { backend as db } from '@/api/backendClient';

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Check, Bell, Send, Loader2, Eye, EyeOff, ShieldCheck } from "lucide-react";

import PageShell from "@/components/PageShell";
import { KEYS, useLocalState } from "@/lib/stores";
import { inputCls } from "@/lib/ui";
import DataImportExport from "@/components/DataImportExport";

const EMAIL_KEY = "invoicepulse:emailSettings";

export default function Settings() {
  const [settings, setSettings] = useLocalState(KEYS.settings, { currency: "INR", taxRate: 18 });
  const [dark, setDark] = useLocalState("invoicepulse-dark", false);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  useEffect(() => { document.documentElement.classList.toggle("dark", !!dark); }, [dark]);

  return (
    <PageShell icon={SettingsIcon} title="Settings" subtitle="Defaults applied across your workspace.">
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <label className="block text-[12px] font-semibold text-muted-foreground">Default currency<select className={inputCls} value={settings.currency} onChange={(e) => set("currency", e.target.value)}><option value="INR">INR · ₹</option><option value="USD">USD · $</option><option value="EUR">EUR · €</option></select></label>
        <label className="block text-[12px] font-semibold text-muted-foreground">Default GST rate<select className={inputCls} value={settings.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="28">28%</option></select></label>
        <div className="flex items-center justify-between rounded-lg border p-3"><div><p className="text-[13px] font-semibold">Dark theme</p><p className="text-[11px] text-muted-foreground">Toggle the workspace appearance.</p></div><button onClick={() => setDark(!dark)} className={`relative h-6 w-11 rounded-full transition-colors ${dark ? "bg-primary" : "bg-muted"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${dark ? "left-[22px]" : "left-0.5"}`} /></button></div>
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-600"><Check className="h-3.5 w-3.5" />Saved automatically</p>
      </div>
      <div className="mt-4"><DataImportExport /></div>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Language</p>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">Choose the language of the app. You can change it any time in Settings.</p>
        <LanguageSwitcher />
      </div>
      <div className="mt-4"><EmailSettingsCard /></div>
    </PageShell>
  );
}

function EmailSettingsCard() {
  const [cfg, setCfg] = useLocalState(EMAIL_KEY, { reminderSchedule: "due_date" });
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [msg, setMsg] = useState(null);
  const update = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const sendTest = async () => {
    if (!testEmail.trim()) { setMsg({ kind: "error", text: "Enter a recipient email to send a test reminder." }); return; }
    setTesting(true); setMsg(null);
    try {
      await db.functions.invoke("sendPaymentReminder", {
        to: testEmail.trim(),
        clientName: "Test Client",
        invoiceNumber: "INV-TEST",
        amount: "₹0.00",
        dueDate: "",
      });
      setMsg({ kind: "ok", text: `Test reminder sent to ${testEmail.trim()}.` });
    } catch (e) {
      const text = e?.response?.data?.error || e?.message || "Failed to send test reminder.";
      setMsg({ kind: "error", text });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><Bell className="h-4 w-4" /></span>
        <div>
          <h2 className="text-[15px] font-bold text-foreground">Auto-Reminder & Email Settings</h2>
          <p className="text-[11px] text-muted-foreground">Configure Gmail SMTP to send automated payment reminders with invoice PDFs to clients.</p>
        </div>
      </div>

      <p className="rounded-lg border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">Sending uses the workspace Gmail credentials (<span className="font-mono-ui">GMAIL_USER</span> / <span className="font-mono-ui">GMAIL_PASS</span>) stored securely as app secrets — no credentials are entered or kept in the browser.</p>

      <label className="block text-[12px] font-semibold text-muted-foreground">Reminder schedule
        <select value={cfg.reminderSchedule} onChange={(e) => update("reminderSchedule", e.target.value)} className={inputCls}>
          <option value="due_date">On due date</option>
          <option value="3_days_overdue">3 days overdue</option>
          <option value="7_days_overdue">7 days overdue</option>
          <option value="both">On due date + 3 days overdue</option>
        </select>
      </label>

      <div className="rounded-lg border border-dashed p-3">
        <p className="text-[12px] font-bold text-foreground">Send a test reminder</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Verify your SMTP connection by sending a test reminder email.</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="recipient@example.com" className={inputCls} />
          <button onClick={sendTest} disabled={testing} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#6D28D9] px-4 py-2.5 text-[12px] font-bold text-white hover:bg-[#7C3AED] disabled:opacity-70 sm:self-start">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send test
          </button>
        </div>
        {msg && <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-medium ${msg.kind === "ok" ? "text-emerald-600" : "text-destructive"}`}>{msg.kind === "ok" ? <Check className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}{msg.text}</p>}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-emerald-600"><Check className="h-3.5 w-3.5" />Saved automatically</p>
    </div>
  );
}
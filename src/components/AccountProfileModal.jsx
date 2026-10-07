import { backend as db } from '@/api/backendClient';

import { useState } from "react";
import { X, Copy, Check, LogOut, Upload } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { usePaywall } from "@/lib/paywall";
import { getRoleLabel } from "@/lib/roles";
import WorkspaceActions from "@/components/WorkspaceActions";

export default function AccountProfileModal({ onClose }) {
  const { user, logout, checkUserAuth } = useAuth();
  const { planName, planStartedAt, planExpiresAt, isPremium, trialStartAt, trialExpiresAt, openPaywall } = usePaywall();
  const fmtDate = (v) => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
  const planStartsAt = isPremium ? planStartedAt : trialStartAt;
  const planEndsAt = isPremium ? planExpiresAt : trialExpiresAt;
  const [name, setName] = useState(user?.full_name || "");
  const [avatar, setAvatar] = useState(user?.profilePicture || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");

  const notify = (m) => { setToast(m); window.setTimeout(() => setToast(""), 2000); };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setSaving(true);
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      setAvatar(file_url);
    } catch {
      notify("Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      await db.auth.updateMe({ full_name: name, profilePicture: avatar });
      if (checkUserAuth) await checkUserAuth();
      notify("Profile updated");
    } catch {
      notify("Update failed");
    } finally {
      setSaving(false);
    }
  };

  const copyId = () => {
    if (user?.id) navigator.clipboard?.writeText(user.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const initial = (user?.full_name || user?.email || "U").charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] px-5 py-4 text-white">
          <h3 className="text-[15px] font-bold">Account profile</h3>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              {avatar ? <img src={avatar} alt="avatar" className="h-16 w-16 rounded-full object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#6D28D9] text-[20px] font-bold text-white">{initial}</div>}
              <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-[#6D28D9] text-white shadow"><Upload className="h-3.5 w-3.5" /><input type="file" accept="image/*" className="hidden" onChange={onUpload} /></label>
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-slate-900">{user?.full_name || "Plivex user"}</p>
              <p className="truncate text-[12px] text-slate-500">{user?.email}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label className="block text-[12px] font-semibold text-slate-500">Display name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px] focus:border-[#6D28D9]" /></label>
            <div>
              <p className="text-[12px] font-semibold text-slate-500">Unique User ID</p>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-slate-50 px-3 py-2">
                <code className="flex-1 truncate font-mono text-[11px] text-slate-600">{user?.id || "—"}</code>
                <button onClick={copyId} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200" aria-label="Copy user ID">{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-slate-500">Workspace</p>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-slate-50 px-3 py-2">
                <code className="flex-1 truncate font-mono text-[11px] text-slate-600">{user?.workspace_id || "Not linked to a workspace"}</code>
                {user?.workspace_id && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Linked</span>}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">{user?.workspace_id ? `You are part of this workspace as ${getRoleLabel(user?.role)}.` : "You are not part of a workspace yet."}</p>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-slate-500">Current Plan</p>
              <div className="mt-1 rounded-lg border border-[#E5E7EB] bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-bold text-[#6D28D9]">{planName}</span>
                  <button onClick={openPaywall} className="shrink-0 rounded-lg bg-[#6D28D9] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#7C3AED]">{isPremium ? "Manage plan" : "Activate plan"}</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Activated on</p><p className="mt-0.5 text-[11px] font-bold text-slate-700">{fmtDate(planStartsAt)}</p></div>
                  <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{isPremium ? "Renews on" : "Expires on"}</p><p className="mt-0.5 text-[11px] font-bold text-slate-700">{fmtDate(planEndsAt)}</p></div>
                </div>
              </div>
            </div>
          </div>

          {toast && <p className="mt-3 text-center text-[11px] font-semibold text-[#6D28D9]">{toast}</p>}

          <div className="mt-5 flex flex-col gap-2">
            <button onClick={save} disabled={saving} className="w-full rounded-xl bg-[#6D28D9] py-2.5 text-[13px] font-bold text-white hover:bg-[#7C3AED] disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
            <button onClick={() => logout(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-[13px] font-bold text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" />Log out</button>
          </div>

          <WorkspaceActions />
        </div>
      </div>
    </div>
  );
}
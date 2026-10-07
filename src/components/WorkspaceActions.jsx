import { backend as db } from '@/api/backendClient';

import { useState } from "react";
import { DoorOpen, Ticket, Loader2, AlertTriangle } from "lucide-react";

import { useAuth } from "@/lib/AuthContext";
import { useRole } from "@/lib/roles";
import { clearWorkspaceData } from "@/lib/stores";

// Explicit workspace membership controls. Both actions reuse the SAME guarded
// backend functions as the normal invite/signup flow — they only opt into the
// deliberate path via an explicit flag, after an in-app confirmation.
export default function WorkspaceActions() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const [dialog, setDialog] = useState(null); // 'exit' | 'join'
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openDialog = (which) => { setDialog(which); setCode(""); setError(""); };
  const closeDialog = () => { if (!busy) setDialog(null); };

  const finish = () => { clearWorkspaceData(); window.location.reload(); };

  const confirmExit = async () => {
    setBusy(true); setError("");
    try {
      await db.functions.invoke("ensureOwnerRole", { reset: true });
      finish();
    } catch (e) { setError(e?.message || "Could not exit the workspace. Please try again."); setBusy(false); }
  };

  const confirmJoin = async () => {
    if (!code.trim()) { setError("Please enter an invite code."); return; }
    setBusy(true); setError("");
    try {
      await db.functions.invoke("verifyInviteCode", { code: code.trim(), email: user?.email, allowRebind: true });
      finish();
    } catch { setError("We couldn't join that workspace. Check the invite code and try again."); setBusy(false); }
  };

  return (
    <div className="mt-4 border-t border-[#E5E7EB] pt-4">
      <p className="text-[12px] font-semibold text-slate-500">Workspace membership</p>
      {isAdmin ? (
        <button onClick={() => openDialog("join")} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#6D28D9] py-2.5 text-[13px] font-bold text-[#6D28D9] hover:bg-[#6D28D9]/5"><Ticket className="h-4 w-4" />Join another workspace</button>
      ) : (
        <button onClick={() => openDialog("exit")} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 py-2.5 text-[13px] font-bold text-amber-700 hover:bg-amber-50"><DoorOpen className="h-4 w-4" />Exit Workspace</button>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={closeDialog}>
          <div className="w-full max-w-[400px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
              <div>
                <h3 className="text-[15px] font-bold text-slate-900">{dialog === "exit" ? "Exit this workspace?" : "Join another workspace?"}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  {dialog === "exit"
                    ? "Are you sure? You'll lose access to this workspace's invoices, clients, and data. You'll become the Owner of a new, empty workspace."
                    : `You are the Owner of ${user?.workspace_id || "your current workspace"}. Joining another workspace will remove your access to this one and all its data. This cannot be undone from your side unless someone invites you back. Continue?`}
                </p>
              </div>
            </div>

            {dialog === "join" && (
              <div className="mt-4">
                <label className="block text-[12px] font-semibold text-slate-500">Invite code</label>
                <div className="relative mt-1">
                  <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. S-WS-6B2A8F-9F2B-K9X2M4" className="w-full rounded-lg border border-[#E5E7EB] py-2.5 pl-10 pr-3 text-[13px] focus:border-[#6D28D9]" />
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-[11px] font-semibold text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeDialog} disabled={busy} className="rounded-lg border border-[#E5E7EB] px-3.5 py-2 text-[12px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
              <button onClick={dialog === "exit" ? confirmExit : confirmJoin} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-[12px] font-bold text-white hover:bg-[#7C3AED] disabled:opacity-70">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DoorOpen className="h-3.5 w-3.5" />}{dialog === "exit" ? "Exit & start fresh" : "Join workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
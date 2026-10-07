import { useState } from "react";
import { useRole, ROLES, ROLE_ORDER, getRoleLabel, normalizeRole } from "@/lib/roles";
import { UsersRound, UserPlus, Pencil, Trash2 } from "lucide-react";
import MemberModal from "@/components/team/MemberModal";
import useTeamActions from "@/components/team/useTeamActions";
import useWorkspaceTeam from "@/components/team/useWorkspaceTeam";
import WorkspaceTeamStatus from "@/components/team/WorkspaceTeamStatus";

const roleStyle = (role) => ({
  admin: "bg-[#6D28D9]/10 text-[#6D28D9]",
  manager: "bg-indigo-50 text-indigo-700",
  employee: "bg-blue-50 text-blue-700",
  storekeeper: "bg-teal-50 text-teal-700",
  accountant: "bg-amber-50 text-amber-700",
}[normalizeRole(role)] || "bg-slate-100 text-slate-600");

const statusStyle = (s) => (s === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700");

export default function TeamManagement() {
  const { role } = useRole();
  const { data: team, isPending: loading, error, refetch, retryAttempt } = useWorkspaceTeam();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const actions = useTeamActions(refetch);
  const { busy, error: actionError, invitation: inviteResult } = actions;

  const members = team?.members || [];
  const counts = team?.counts || {};
  const refresh = () => refetch();
  const addMember = async (details) => { if (await actions.addMember(details)) setAddOpen(false); };
  const updateRole = async (member, role) => { if (await actions.updateRole(member, role)) setEditTarget(null); };
  const removeMember = (member) => actions.removeMember(member);

  const stats = [
    { label: "Total members", value: members.length, color: "from-[#6D28D9] to-[#7C3AED]" },
    { label: "Owners", value: counts.admin || 0, color: "from-[#6D28D9] to-[#7C3AED]" },
    { label: "Managers", value: counts.manager || 0, color: "from-[#4F46E5] to-[#6366F1]" },
    { label: "Billing / Sales", value: counts.employee || 0, color: "from-[#2563EB] to-[#3B82F6]" },
    { label: "Store Keepers", value: counts.storekeeper || 0, color: "from-[#0D9488] to-[#14B8A6]" },
    { label: "Accountants", value: counts.accountant || 0, color: "from-[#D97706] to-[#F59E0B]" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6D28D9]/10 text-[#6D28D9]"><UsersRound className="h-5 w-5" /></span>
          <div>
            <h1 className="text-[20px] font-bold tracking-[-0.03em] text-slate-900">Team Management</h1>
            <p className="text-[12px] text-slate-500">Invite teammates and control what each role can access.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600">Your role: {getRoleLabel(role)}</span>
          <button onClick={() => { actions.clearError(); setAddOpen(true); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-3.5 py-2.5 text-[12px] font-bold text-white hover:bg-[#7C3AED]"><UserPlus className="h-4 w-4" />Add New Team Member</button>
        </div>
      </div>

      {loading || error ? <WorkspaceTeamStatus loading={loading} error={error} retryAttempt={retryAttempt} onRetry={refresh} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className={`rounded-2xl bg-gradient-to-br ${s.color} p-4 text-white shadow-sm`}>
              <p className="text-[22px] font-bold leading-none">{s.value}</p>
              <p className="mt-2 text-[11px] font-semibold text-white/80">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {actionError && !addOpen && !editTarget && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{actionError}</p>}

      {inviteResult && (
        <div className="fade-up rounded-2xl border border-[#6D28D9]/30 bg-[#6D28D9]/5 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-slate-900">Invite saved for {inviteResult.email}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Share this workspace invite token if the email doesn't arrive:</p>
              <p className="mt-1 break-all font-mono-ui text-[13px] font-bold text-[#6D28D9]">{inviteResult.code}</p>
              {inviteResult.warning && <p role="alert" className="mt-2 text-[12px] text-destructive">{inviteResult.warning}</p>}
            </div>
            {inviteResult.code && (
              <button onClick={() => { try { navigator.clipboard.writeText(`${window.location.origin}/register?invite_token=${encodeURIComponent(inviteResult.code)}`); } catch { /* best effort */ } }} className="shrink-0 rounded-xl bg-[#6D28D9] px-3.5 py-2 text-[11px] font-bold text-white hover:bg-[#7C3AED]">Copy invite link</button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <h3 className="text-[14px] font-bold text-slate-900">Staff members</h3>
          <span className="text-[11px] text-slate-400">{team ? `${team.totalMembers} total · ${counts.pending} pending · ${counts.accepted} accepted` : error ? 'Unavailable' : 'Loading…'}</span>
        </div>
        {loading ? (
          <WorkspaceTeamStatus loading retryAttempt={retryAttempt} />
        ) : error ? (
          <WorkspaceTeamStatus error={error} onRetry={refresh} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr><th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Email</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-900">{m.name}</td>
                    <td className="px-4 py-3 text-slate-500">{m.email}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${roleStyle(m.role)}`}>{getRoleLabel(m.role)}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle(m.status)}`}>{({ invited: 'Pending', accepted: 'Accepted', active: 'Active' })[m.status]}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {normalizeRole(m.role) !== "admin" ? (
                          <button onClick={() => { actions.clearError(); setEditTarget(m); }} className="rounded-lg border border-[#E5E7EB] p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Edit role"><Pencil className="h-3.5 w-3.5" /></button>
                        ) : (
                          <span className="rounded-lg bg-[#6D28D9]/10 px-2 py-1.5 text-[9px] font-bold uppercase text-[#6D28D9]">Owner · Locked</span>
                        )}
                        {normalizeRole(m.role) !== 'admin' && <button onClick={() => removeMember(m)} className="rounded-lg border border-[#E5E7EB] p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete member"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (<tr><td colSpan={5} className="px-4 py-12 text-center text-[12px] text-slate-400">No team members yet. Add your first teammate to get started.</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h3 className="text-[14px] font-bold text-slate-900">Role permissions</h3>
        <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="rounded-xl border border-[#E5E7EB] p-4">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${roleStyle(r)}`}>{ROLES[r].label}</span>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{ROLES[r].description}</p>
            </div>
          ))}
        </div>
      </div>

      {addOpen && <MemberModal mode="add" onClose={() => setAddOpen(false)} onSubmit={addMember} busy={busy} error={actionError} />}
      {editTarget && <MemberModal mode="edit" member={editTarget} onClose={() => setEditTarget(null)} onSubmit={(data) => updateRole(editTarget, data.role)} busy={busy} error={actionError} />}
    </div>
  );
}
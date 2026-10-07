import { useState } from 'react';
import { Loader2, ShieldCheck, X, Mail } from 'lucide-react';
const options = [{ value: 'manager', label: 'Manager' }, { value: 'employee', label: 'Billing Executive / Sales' }, { value: 'storekeeper', label: 'Store Keeper / Inventory' }, { value: 'accountant', label: 'Accountant / CA' }];
export default function MemberModal({ mode, member, onClose, onSubmit, busy, error }) {
  const [email, setEmail] = useState(member?.email || '');
  const [name, setName] = useState(member?.name || '');
  const [role, setRole] = useState(member?.role || 'employee');
  const isAdd = mode === 'add';
  const inputCls = 'mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <form onSubmit={e => { e.preventDefault(); onSubmit({ email: email.trim(), name: name.trim(), role }); }} className="w-full max-w-[460px] rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-[16px] font-bold">{isAdd ? 'Add new team member' : 'Edit role'}</h3><button type="button" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 space-y-3">
          {isAdd ? <>
            <label className="block text-[12px] font-semibold text-muted-foreground">Member email address (required)<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" className={inputCls} /></label>
            <label className="block text-[12px] font-semibold text-muted-foreground">Member name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rahul" className={inputCls} /></label>
          </> : <div className="rounded-lg bg-muted px-3 py-2.5 text-[12px]"><p className="font-bold">{member?.name}</p><p className="text-muted-foreground">{member?.email}</p></div>}
          <label className="block text-[12px] font-semibold text-muted-foreground">Select role<select value={role} onChange={e => setRole(e.target.value)} className={inputCls}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          {isAdd && <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />An invite email will be sent so they can join this workspace with the assigned role.</p>}
          {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-[12px] text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-[12px] font-semibold text-muted-foreground">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-70">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}{isAdd ? 'Send invite' : 'Update role'}</button></div>
      </form>
    </div>
  );
}
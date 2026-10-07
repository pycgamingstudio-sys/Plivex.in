import { useState } from "react";
import { Activity, Trash2, FileText, MessageCircle } from "lucide-react";
import PageShell from "@/components/PageShell";
import { KEYS, loadList, saveList } from "@/lib/stores";

const iconFor = (type) => (type === "share" ? MessageCircle : FileText);
const toneFor = (type) => (type === "share" ? "bg-[#25D366]/15 text-[#1da851]" : "bg-primary/15 text-primary");
const timeLabel = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function AccountActivity() {
  const [items, setItems] = useState(() => loadList(KEYS.activity));
  const clear = () => { if (window.confirm("Clear all activity?")) { saveList(KEYS.activity, []); setItems([]); } };
  return (
    <PageShell icon={Activity} title="Account activity" subtitle="A timeline of your recent actions in this workspace." action={items.length ? <button onClick={clear} className="rounded-lg border px-3 py-2 text-[12px] font-semibold text-destructive hover:bg-destructive/10">Clear</button> : null}>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center text-[13px] text-muted-foreground">No activity recorded yet. Generate or share an invoice to get started.</div>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {items.map((it) => {
            const Icon = iconFor(it.type);
            return (
              <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${toneFor(it.type)}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">{it.label}</p><p className="text-[11px] text-muted-foreground">{timeLabel(it.date)}</p></div>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
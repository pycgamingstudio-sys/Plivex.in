import { useEffect, useState } from "react";
import useWorkspacePresence from "@/components/team/useWorkspacePresence";
import useWorkspaceTeam from "@/components/team/useWorkspaceTeam";
import WorkspaceTeamStatus from "@/components/team/WorkspaceTeamStatus";
import StaffPresenceCard from "@/components/dashboard/StaffPresenceCard";
import SalesActivityCard from "@/components/dashboard/SalesActivityCard";

const ONLINE_WINDOW = 2 * 60 * 1000;  // green: active in the last 2 minutes
const IDLE_WINDOW = 10 * 60 * 1000;   // amber: idle for up to 10 minutes

// Owner-only live tracking, strictly scoped to the current workspace.
// "Today's Sales Activity" is always visible (it includes the owner's own activity).
// "Live Staff Presence" only exists once the workspace has a teammate.
export default function OwnerTrackingWidgets() {
  const { data: team, isPending, error, refetch, retryAttempt } = useWorkspaceTeam();
  const presence = useWorkspacePresence(team);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, []);

  if (isPending || (!team && !error)) return <WorkspaceTeamStatus loading retryAttempt={retryAttempt} />;
  if (error) return <WorkspaceTeamStatus error={error} onRetry={refetch} />;

  const hasTeammates = Number(team.teammateCount) > 0;
  const staff = (team.members || []).filter((member) => member.status === "active").map((member) => ({ ...presence.data?.[member.user_id], id: member.id, name: member.name, role: member.role }));
  const withStatus = staff.map((s) => {
    const last = s.last_ping_at ? new Date(s.last_ping_at).getTime() : NaN;
    const elapsed = Number.isFinite(last) ? Math.max(0, now - last) : Infinity;
    return { ...s, elapsed, status: elapsed < ONLINE_WINDOW ? "online" : elapsed < IDLE_WINDOW ? "idle" : "offline" };
  });

  const today = new Date().toISOString().slice(0, 10);
  const todays = withStatus.filter((s) => s.today_date === today);
  const totals = {
    invoices: todays.reduce((a, s) => a + (Number(s.today_invoices) || 0), 0),
    quotations: todays.reduce((a, s) => a + (Number(s.today_quotations) || 0), 0),
    revenue: todays.reduce((a, s) => a + (Number(s.today_revenue) || 0), 0),
  };
  const feed = withStatus
    .flatMap((s) => (Array.isArray(s.actions) ? s.actions.filter((a) => String(a.at).slice(0, 10) === today).map((a) => ({ ...a, who: s.name })) : []))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 12);

  return (
    <div className={hasTeammates ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
      {hasTeammates && <StaffPresenceCard staff={withStatus} loading={presence.isLoading} error={presence.error} />}
      <SalesActivityCard todays={todays} totals={totals} feed={feed} now={now} loading={presence.isLoading} error={presence.error} />
    </div>
  );
}
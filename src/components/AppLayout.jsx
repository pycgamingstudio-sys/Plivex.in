import { NavLink, Outlet } from "react-router-dom";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";
import { navItems, HIDDEN_FROM_SIDEBAR } from "@/lib/nav";
import { useRole } from "@/lib/roles";
import { usePaywall } from "@/lib/paywall";

export default function AppLayout() {
  const { role } = useRole();
  const { canAccess, openPaywall } = usePaywall();
  const items = navItems.filter((i) => i.to !== "/" && !HIDDEN_FROM_SIDEBAR.includes(i.to) && (!i.roles || i.roles.includes(role)));
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <p className="text-[15px] font-bold tracking-[-0.04em]">Pli<span className="text-primary">vex</span></p>
          </NavLink>
          <NavLink to="/" className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-secondary">← Invoice desk</NavLink>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 pb-2.5" aria-label="Workspace">
          {items.map((item) => {
            const locked = item.pro && !canAccess("team_management");
            if (locked) {
              return (
                <button key={item.to} onClick={openPaywall} className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  <item.icon className="h-3.5 w-3.5" />{item.label}
                  <span className="ml-0.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">PRO</span>
                </button>
              );
            }
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground hover:text-foreground"}`}>
                <item.icon className="h-3.5 w-3.5" />{item.label}
              </NavLink>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6"><Outlet /></main>
      <PresenceBeacon />
    </div>
  );
}
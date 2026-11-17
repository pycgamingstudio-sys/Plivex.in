import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { canAccessRoute } from "@/lib/roles";
import { APP_EDITION } from "@/api/backendClient";

export default function RoleGuard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  // Global role checks are enforced by workspace-scoped Edge Functions and RLS.
  // Do not normalize Global owner/admin roles through the India-only route matrix.
  if (APP_EDITION === "global") return <Outlet />;

  const role = user?.role || "employee";
  const allowed = canAccessRoute(role, location.pathname);
  const shown = useRef(false);

  useEffect(() => {
    if (!allowed && !shown.current) {
      shown.current = true;
      toast({ title: "Access Restricted by Admin", description: "This area is locked. You've been redirected to your workspace." });
    }
  }, [allowed, toast]);

  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}
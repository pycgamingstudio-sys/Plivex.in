import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { canAccessRoute } from "@/lib/roles";

export default function RoleGuard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const role = user?.role || "admin";
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
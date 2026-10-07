import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pingPresence, describeRoute } from "@/lib/staffTracking";

// Real-time presence beacon: pings the current page on navigation and every 60s.
export default function PresenceBeacon() {
  const location = useLocation();
  useEffect(() => {
    pingPresence(describeRoute(location.pathname));
    const beat = setInterval(() => pingPresence(describeRoute(location.pathname)), 60000);
    return () => clearInterval(beat);
  }, [location]);
  return null;
}
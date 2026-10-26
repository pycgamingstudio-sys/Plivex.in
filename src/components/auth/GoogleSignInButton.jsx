import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/api/backendClient";
import { rememberPendingInviteCode } from "@/components/auth/workspaceInvite";

export default function GoogleSignInButton({ inviteCode = "", onError, disabled = false, className = "" }) {
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    if (inviteCode) rememberPendingInviteCode(inviteCode);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/",
          queryParams: { access_type: "offline", prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      setLoading(false);
      onError?.(error?.message || "Google sign-in could not be started. Please try again.");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={`w-full h-12 bg-white text-slate-800 border-slate-300 hover:bg-slate-50 font-medium ${className}`}
      onClick={handleGoogleSignIn}
      disabled={disabled || loading}
      aria-label="Continue with Google"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
      ) : (
        <svg className="w-5 h-5 mr-2" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.01 13.22l7.98 6.19C11.92 13.72 17.47 9.5 24 9.5Z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.43 38.02 46.98 31.91 46.98 24.55Z" />
          <path fill="#FBBC05" d="M9.99 28.59A14.4 14.4 0 0 1 9.22 24c0-1.59.27-3.13.76-4.59L2.01 13.22A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.43-6.19Z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.9 2.3-8.18 2.3-6.53 0-12.08-4.22-14.01-10.09l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
        </svg>
      )}
      {loading ? "Connecting to Google..." : "Continue with Google"}
    </Button>
  );
}

import { backend as db } from '@/api/backendClient';

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Lock, Loader2, Ticket } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { toast } from "@/components/ui/use-toast";
import { safeReturnTo } from "@/lib/authReturnTo";
import { parseAndValidateInviteCode } from "@/lib/workspace";
import { clearSessionCache } from "@/lib/sessionCache";
import { getPendingInviteCode, rememberPendingInviteCode, authPageLink } from "@/components/auth/workspaceInvite";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [inviteCode, setInviteCode] = useState(getPendingInviteCode);

  // Smart role invite links: /register?invite_token=XXXXXX (or ?invite_code=) auto-maps
  // the new user into the parent workspace with their predefined staff role.
  useEffect(() => {
    // Fresh signup in a possibly stale browser session — flush any cached auth
    // tokens / workspace state from a previous account so role & trial data never leak.
    const code = getPendingInviteCode();
    clearSessionCache();
    if (code) { rememberPendingInviteCode(code); setInviteCode(code); }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    const code = getPendingInviteCode(inviteCode);
    if (code && code.includes("-")) {
      try { parseAndValidateInviteCode(code); } catch (err) {
        setError(err.message || "Invalid invite code");
        return;
      }
    }
    setLoading(true);
    try {
      // Remember the invite so it is applied automatically after the user confirms
      // their email and signs in (an invited member must never become a separate owner).
      rememberPendingInviteCode(code);
      await db.auth.register({ email, password });
      setEmailSent(true);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    try {
      await db.auth.resendConfirmation(email);
      toast({
        title: "Email sent",
        description: "Check your inbox for a new confirmation link.",
      });
    } catch (err) {
      setError(err.message || "Failed to resend email");
    }
  };

  if (emailSent) {
    return (
      <AuthLayout
        icon={Mail}
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}`}
        footer={
          <Link to={authPageLink("/login", safeReturnTo(), getPendingInviteCode(inviteCode))} className="text-primary font-medium hover:underline">
            Back to log in
          </Link>
        }
      >
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Open the email and tap the confirmation link. After that you will be signed in automatically.
          If you can't see it, check your spam folder.
        </p>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Didn't receive the email?{" "}
          <button onClick={handleResend} className="text-primary font-medium hover:underline">
            Resend
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Sign up to get started"
      footer={
        <>
          Already have an account?{" "}
          <Link
            to={authPageLink("/login", safeReturnTo(), getPendingInviteCode(inviteCode))}
            className="text-primary font-medium hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inviteCode">Have a Workspace Invite Code? <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <div className="relative">
            <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input id="inviteCode" type="text" placeholder="e.g. AB3X9K" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} className="pl-10 h-12" />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
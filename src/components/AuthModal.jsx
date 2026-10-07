import { backend as db } from '@/api/backendClient';

import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Mail, Lock, Loader2, LogIn, Sparkles } from "lucide-react";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

// Lightweight delayed-authentication modal. The pending action is stored in
// sessionStorage ("plivex:pendingAction") and auto-executed right after login.
export default function AuthModal({ open, actionLabel, onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await db.auth.loginViaEmailPassword(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err?.message || "Invalid email or password");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[400px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-bold text-slate-900">Sign in to continue Plivex</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              {actionLabel ? `We'll take you straight to "${actionLabel}" after you sign in — nothing is lost.` : "Sign in or create your free workspace to unlock everything."}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        {error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</div>}

        <GoogleSignInButton returnTo="/" onError={setError} disabled={loading} className="mt-4 h-11 font-semibold" />

        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-[12px] font-semibold text-slate-500">Email
            <div className="relative mt-1.5">
              <Mail className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" className="pl-10 h-11" />
            </div>
          </label>
          <label className="block text-[12px] font-semibold text-slate-500">Password
            <div className="relative mt-1.5">
              <Lock className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-10 h-11" />
            </div>
          </label>
          <Button type="submit" disabled={loading} className="w-full h-11 font-semibold"><LogIn className="h-4 w-4" />{loading ? "Signing in…" : "Sign in & continue"}</Button>
        </form>

        <div className="mt-4 rounded-xl bg-[#6D28D9]/5 px-3 py-2.5 text-center">
          <p className="text-[11px] text-slate-500">New to Plivex?</p>
          <Link to="/register" onClick={onClose} className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-[#6D28D9] hover:underline"><Sparkles className="h-3.5 w-3.5" />Create your free workspace — 14-day full trial</Link>
        </div>
      </div>
    </div>
  );
}
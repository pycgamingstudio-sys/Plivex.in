import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { getLang, setLang } from "@/lib/i18n";

// Shown once after login when the user has not picked a language yet.
export default function LanguagePrompt() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  if (isLoadingAuth || !isAuthenticated || getLang()) return null;
  return (
    <div className="notranslate fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl">
        <h2 className="text-lg font-bold text-foreground">आप कौन सी भाषा चाहते हैं?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Which language do you prefer?</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => setLang("hi")} className="rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground">हिंदी</button>
          <button onClick={() => setLang("en")} className="rounded-xl border border-border px-4 py-3 text-base font-semibold text-foreground hover:bg-muted">English</button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">आप इसे कभी भी Settings में बदल सकते हैं। · You can change this any time in Settings.</p>
      </div>
    </div>
  );
}

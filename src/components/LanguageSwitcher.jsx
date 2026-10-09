import React from "react";
import { getLang, setLang } from "@/lib/i18n";

// Two small buttons: हिंदी | English. Changing the language reloads the page once.
export default function LanguageSwitcher({ className = "" }) {
  const current = getLang() === "hi" ? "hi" : "en";
  const btn = (code, label) => (
    <button
      type="button"
      onClick={() => current !== code && setLang(code)}
      aria-pressed={current === code}
      className={`notranslate rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${current === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <div className={`inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 ${className}`}>
      {btn("hi", "हिंदी")}
      {btn("en", "English")}
    </div>
  );
}

import React from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Logo from "@/components/Logo";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="plivex-auth-shell flex min-h-dvh items-start justify-center px-4 py-6 sm:min-h-screen sm:items-center sm:py-10">
      <div className="w-full max-w-[27rem]">
        <div className="mb-7 text-center sm:mb-8">
          <Logo className="mx-auto mb-4 h-12 w-12" />
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-balance text-[25px] font-bold tracking-[-0.04em] text-foreground sm:text-[29px]">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="plivex-auth-card rounded-2xl border border-border/80 bg-card p-5 sm:p-8">
          {children}
        </div>
        {footer && (
          <p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">{footer}</p>
        )}
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">Available in Hindi and English <span className="notranslate">· हिंदी · English</span></p>
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}

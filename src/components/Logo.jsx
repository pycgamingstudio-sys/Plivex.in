import { Image } from "@/components/ui/image";

// Use the existing first-party Plivex favicon asset; do not invent a replacement logo.
export const LOGO_URL = "/favicon.ico";

export default function Logo({ className = "h-8 w-8", rounded = "rounded-[10px]" }) {
  return (
    <Image
      src={LOGO_URL}
      alt="Plivex"
      fittingType="fit"
      className={`${className} ${rounded} shrink-0 overflow-hidden`}
    />
  );
}

import { Image } from "@/components/ui/image";

// First-party Plivex brand mark, served from this website (no Base44 dependency).
export const LOGO_URL = "/plivex-logo.svg";

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

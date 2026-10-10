import { backend as db } from '@/api/backendClient';

import { Image } from "@/components/ui/image";

// Plivex brand mark — used in the dashboard sidebar, top bar, workspace header
// and the browser tab icon.
export const LOGO_URL = "/logo.png";

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
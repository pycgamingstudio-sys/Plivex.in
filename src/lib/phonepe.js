import { supabase } from "@/api/backendClient";

let sdkPromise;
function loadCashfreeSdk() {
  if (window.Cashfree) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Cashfree checkout. Please retry."));
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export async function startCashfreeCheckout({ planId }) {
  const { data, error } = await supabase.functions.invoke("create-cashfree-order", {
    body: { planId, origin: window.location.origin, path: window.location.pathname },
  });
  if (error) {
    let message = error.message || "Could not start Cashfree checkout.";
    try {
      const response = error.context;
      if (response && typeof response.clone === "function") {
        const body = await response.clone().json();
        if (typeof body?.error === "string") message = body.error;
      }
    } catch {}
    throw new Error(message);
  }
  if (!data?.paymentSessionId || !["sandbox", "production"].includes(data.environment)) {
    throw new Error(data?.error || "Cashfree did not return a valid payment session.");
  }
  await loadCashfreeSdk();
  const cashfree = window.Cashfree({ mode: data.environment });
  await cashfree.checkout({ paymentSessionId: data.paymentSessionId, redirectTarget: "_self" });
}

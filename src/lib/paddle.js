import { supabase } from "@/api/backendClient";

export async function startPaddleCheckout({ planId }) {
  const { data, error } = await supabase.functions.invoke("create-paddle-transaction", {
    body: { planId },
  });
  if (error) {
    let message = error.message || "Could not start Paddle checkout.";
    try {
      const body = await error.context?.clone?.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (!data?.ok || typeof data.checkoutUrl !== "string" || !data.checkoutUrl.startsWith("https://")) {
    throw new Error(data?.error || "Paddle did not return a valid checkout link.");
  }
  window.location.assign(data.checkoutUrl);
}

import { supabase } from "@/api/backendClient";

export async function startPaddleCheckout({ planId }) {
  if (!import.meta.env.VITE_PADDLE_CLIENT_TOKEN) throw new Error("Paddle client token is missing. Add VITE_PADDLE_CLIENT_TOKEN to the frontend environment.");
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
  const frontendEnvironment = import.meta.env.VITE_PADDLE_ENV || "sandbox";
  if (data?.environment && data.environment !== frontendEnvironment) throw new Error("Paddle sandbox/live environment does not match the frontend client token.");
  if (!data?.ok || typeof data.checkoutUrl !== "string" || !data.checkoutUrl.startsWith("https://")) {
    throw new Error(data?.error || "Paddle did not return a valid checkout link.");
  }
  window.location.assign(data.checkoutUrl);
}

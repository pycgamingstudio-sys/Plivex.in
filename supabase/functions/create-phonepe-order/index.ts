Deno.serve(async (_req: Request) => {
  return new Response(JSON.stringify({
    error: "PhonePe checkout is no longer available. Please use Cashfree from Plivex pricing.",
    code: "GATEWAY_REPLACED",
    gateway: "cashfree"
  }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
});

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface ReqPayload {
  name: string;
}

console.info("server started");

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    const { name }: ReqPayload = await req.json();

    // Using 'sb_secret_xyz' bypasses RLS — use for privileged operations
    if (ctx.authMode === "secret") {
      return Response.json({
        message: `Hello ${name} admin!`,
      });
    }

    return Response.json({
      message: `Hello ${name}!`,
    });
  }),
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createManageCashfreeSubscriptionHandler } from "./handler.mjs";

Deno.serve(createManageCashfreeSubscriptionHandler({
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
}));

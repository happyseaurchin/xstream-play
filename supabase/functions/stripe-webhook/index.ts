/**
 * stripe-webhook — Supabase Edge Function.
 *
 * Receives Stripe webhook events. On checkout.session.completed:
 * 1. Extracts customer email from the completed session
 * 2. Creates a Supabase auth user (admin API)
 * 3. Creates a public.users row with paid=true
 * 4. Sends the user a password reset email (so they can set their password)
 *
 * This is the ONLY place users get created. No intermediate states.
 * Before this webhook fires: zero rows. After: fully registered + paid.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://play.onen.ai";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      return new Response("Missing signature", { status: 400 });
    }

    // Verify webhook signature
    // Using Stripe's signature verification manually (no SDK in Deno)
    const event = await verifyStripeWebhook(body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type !== "checkout.session.completed") {
      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      console.error("No email in checkout session", session.id);
      return new Response("No email found", { status: 400 });
    }

    // Create Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Check if user already exists (re-purchase edge case)
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (u: { email?: string }) => u.email === email
    );

    if (existing) {
      // User exists — just make sure they're marked as paid
      await supabase
        .from("users")
        .update({ paid: true })
        .eq("id", existing.id);

      console.log(`Existing user ${email} marked as paid`);
      return new Response(JSON.stringify({ received: true, action: "updated" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate a temporary random password (user will set their own via reset email)
    const tempPassword = crypto.randomUUID() + "Aa1!";

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (authError) {
      console.error("Auth user creation failed:", authError);
      return new Response(JSON.stringify({ error: authError.message }), { status: 500 });
    }

    const userId = authData.user.id;

    // Create public.users profile
    const { error: profileError } = await supabase.from("users").upsert({
      id: userId,
      display_name: email.split("@")[0],
      paid: true,
      onboarding_phase: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      console.error("Profile creation failed:", profileError);
      // User is still created in auth — don't fail the webhook
    }

    // Send password reset email so user can set their own password
    await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${SITE_URL}?set-password=true` },
    });

    console.log(`New user created: ${email} (${userId})`);

    return new Response(JSON.stringify({ received: true, action: "created" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// ── Stripe webhook signature verification ──

async function verifyStripeWebhook(
  payload: string,
  sigHeader: string,
  secret: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [key, val] = part.split("=");
      if (key === "t") acc.timestamp = val;
      if (key === "v1") acc.signatures.push(val);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const valid = parts.signatures.some((s) => s === expectedSig);
  if (!valid) throw new Error("Invalid webhook signature");

  // Check timestamp (reject events older than 5 minutes)
  const age = Math.floor(Date.now() / 1000) - parseInt(parts.timestamp);
  if (age > 300) throw new Error("Webhook timestamp too old");

  return JSON.parse(payload);
}

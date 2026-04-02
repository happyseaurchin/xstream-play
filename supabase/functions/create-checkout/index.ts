/**
 * create-checkout — Supabase Edge Function.
 *
 * Redirects the browser to a Stripe Checkout session for $10 registration.
 * After payment, Stripe sends a webhook to stripe-webhook function,
 * which creates the Supabase auth user.
 *
 * No auth required — this is the entry point for registration.
 * GET request → redirect to Stripe Checkout.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://play.onen.ai";

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    // Create Stripe Checkout session
    const params = new URLSearchParams({
      "mode": "payment",
      "line_items[0][price]": STRIPE_PRICE_ID,
      "line_items[0][quantity]": "1",
      "success_url": `${SITE_URL}?registered=true`,
      "cancel_url": `${SITE_URL}?registered=cancelled`,
      "customer_creation": "always",
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (session.error) {
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Redirect to Stripe Checkout
    return new Response(null, {
      status: 303,
      headers: {
        "Location": session.url,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});

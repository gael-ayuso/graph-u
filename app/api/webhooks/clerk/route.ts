import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { profileFromEvent, syncProfile } from "@/lib/users/sync";

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("CLERK_WEBHOOK_SIGNING_SECRET is not configured.");
    return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  let event;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    const profile = profileFromEvent(event);
    if (profile) await syncProfile(profile);
    return Response.json({ received: true });
  } catch {
    // Do not log the event, credentials, connection URL, or personal data.
    console.error("Clerk profile synchronization failed; delivery can be retried.");
    return Response.json({ error: "Profile synchronization failed" }, { status: 500 });
  }
}

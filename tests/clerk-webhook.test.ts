import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/clerk/route";

const { syncProfile, profileFromEvent } = vi.hoisted(() => ({
  syncProfile: vi.fn(),
  profileFromEvent: vi.fn(),
}));
vi.mock("@/lib/users/sync", () => ({ syncProfile, profileFromEvent }));

const secretBytes = Buffer.from("local-test-webhook-secret");
const signingSecret = `whsec_${secretBytes.toString("base64")}`;

function signedRequest(valid = true) {
  const payload = JSON.stringify({ type: "user.created", data: { id: "user_test" } });
  const id = "msg_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${payload}`).digest("base64");
  return new NextRequest("http://localhost/api/webhooks/clerk", {
    method: "POST",
    body: valid ? payload : `${payload} `,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
      "Content-Type": "application/json",
    },
  });
}

describe("Clerk webhook", () => {
  beforeEach(() => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", signingSecret);
    profileFromEvent.mockReturnValue({ clerkId: "user_test" });
    syncProfile.mockResolvedValue({});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("accepts a genuinely signed delivery without a browser session", async () => {
    expect((await POST(signedRequest())).status).toBe(200);
    expect(syncProfile).toHaveBeenCalledWith({ clerkId: "user_test" });
  });

  it("rejects a tampered body before accessing the database", async () => {
    expect((await POST(signedRequest(false))).status).toBe(400);
    expect(syncProfile).not.toHaveBeenCalled();
  });

  it("allows Clerk to retry a database failure", async () => {
    syncProfile.mockRejectedValueOnce(new Error("unavailable"));
    expect((await POST(signedRequest())).status).toBe(500);
    expect((await POST(signedRequest())).status).toBe(200);
  });

  it("acknowledges unrelated events without writing", async () => {
    profileFromEvent.mockReturnValue(null);
    expect((await POST(signedRequest())).status).toBe(200);
    expect(syncProfile).not.toHaveBeenCalled();
  });

  it("reports missing configuration as retryable", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    expect((await POST(signedRequest())).status).toBe(503);
    expect(syncProfile).not.toHaveBeenCalled();
  });
});

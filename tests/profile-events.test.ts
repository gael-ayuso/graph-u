import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import { describe, expect, it } from "vitest";
import { profileFromEvent } from "@/lib/users/sync";

function event(type: string, data: object) {
  return { type, timestamp: 2000, data } as WebhookEvent;
}

describe("profile event mapping", () => {
  it("uses only the primary email and joins available names", () => {
    expect(profileFromEvent(event("user.updated", {
      id: "user_test", first_name: "Ana", last_name: "López", has_image: true,
      image_url: "https://example.com/avatar", updated_at: 1000,
      primary_email_address_id: "primary",
      email_addresses: [
        { id: "secondary", email_address: "secondary@example.com" },
        { id: "primary", email_address: "primary@example.com" },
      ],
    }))).toEqual({
      clerkId: "user_test", name: "Ana López", email: "primary@example.com",
      avatarUrl: "https://example.com/avatar", clerkUpdatedAt: new Date(1000),
      deletedAt: null,
    });
  });

  it("accepts users with no email, name, or uploaded avatar", () => {
    const result = profileFromEvent(event("user.created", {
      id: "user_test", email_addresses: [], updated_at: 1000,
    }));
    expect(result).toMatchObject({ email: null, name: null, avatarUrl: null });
  });

  it("removes personal data on deletion and keeps its identity marker", () => {
    expect(profileFromEvent(event("user.deleted", { id: "user_test" }))).toEqual({
      clerkId: "user_test", email: null, name: null, avatarUrl: null,
      clerkUpdatedAt: new Date(2000), deletedAt: new Date(2000),
    });
  });

  it("ignores unrelated events", () => {
    expect(profileFromEvent(event("session.created", {}))).toBeNull();
  });
});

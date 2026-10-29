import { getCurrentUserProfile } from "@/lib/users/current-user";
import { unstable_rethrow } from "next/navigation";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };

  try {
    const user = await getCurrentUserProfile();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    }

    return Response.json({
      user: {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }, { headers });
  } catch (error) {
    // Preserve Next.js request-time rendering signals from Clerk's auth().
    unstable_rethrow(error);
    console.error("Unable to load the authenticated user profile.");
    return Response.json({ error: "Profile temporarily unavailable" }, {
      status: 503,
      headers,
    });
  }
}

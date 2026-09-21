import type { AuthContext } from "../../src/auth/server";
import type { AuthenticatedUser } from "../../src/auth/identity";

/**
 * Test double for the verified-identity boundary.
 *
 * Tests inject a configured context so protected endpoints behave as they do
 * for a real caller. The identity still arrives through `getUser` rather than a
 * request field, so tests exercise the same authorization path as production.
 * `x-test-user` lets a test present a different verified identity.
 */
export function testAuth(userId = "user-1"): AuthContext {
  return {
    configured: true,
    getUser: async (request: Request): Promise<AuthenticatedUser | undefined> => {
      const presented = request.headers.get("x-test-user") ?? userId;
      return presented ? { userId: presented, provider: "cognito" } : undefined;
    },
    startLogin: () => ({
      location: "https://auth.test/oauth2/authorize",
      setCookie: ["pkce=test"],
    }),
    completeLogin: async () => ({
      ok: false,
      status: 400,
      code: "AUTH_CALLBACK_INVALID",
      message: "The sign-in response was incomplete. Please start again.",
    }),
    signOut: () => ["reposherlock_session=; Max-Age=0"],
  };
}

/** A context whose verification always fails, for unauthenticated cases. */
export function anonymousAuth(): AuthContext {
  return { ...testAuth(), getUser: async () => undefined };
}

import { z } from "zod";
import { apiBaseUrl } from "../api/base-url";

/**
 * Browser authentication abstraction.
 *
 * The real credentials are checked by the Cognito hosted UI; this module only
 * starts that flow, reads the resulting server-side session and clears it on
 * sign-out. It never fabricates a session: when the deployment has no Cognito
 * configuration, callers see that explicitly instead of a
 * fake success.
 */

export const authUserSchema = z.object({
  userId: z.string().min(1),
  email: z.string().optional(),
});

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  configured: z.boolean(),
  user: authUserSchema.nullable(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;

/** Raised when a protected view or request needs a session that does not exist. */
export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/** Raised when the deployment has not been given Cognito settings yet. */
export class AuthenticationNotConfiguredError extends Error {
  constructor(message = "Sign-in is not configured for this deployment yet.") {
    super(message);
    this.name = "AuthenticationNotConfiguredError";
  }
}

/**
 * Access token held by clients that authenticate outside the cookie flow
 * (for example a future native client). It is never synthesized: with no token
 * no Authorization header is sent.
 */
let accessToken: string | undefined;

export function setAccessToken(token?: string): void {
  accessToken = token && token.length > 0 ? token : undefined;
}

export function getAccessToken(): string | undefined {
  return accessToken;
}

/** Authorization header for API calls, empty while no real token is held. */
export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function getSession(): Promise<AuthSession> {
  // An unreachable or unhelpful API yields "no session"; it must never be
  // reported as signed in, and it must not surface a transport failure either.
  const signedOut: AuthSession = { authenticated: false, configured: false, user: null };
  try {
    const response = await fetch(`${apiBaseUrl}/auth/session`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return signedOut;
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = authSessionSchema.safeParse(body);
    return parsed.success ? parsed.data : signedOut;
  } catch {
    return signedOut;
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getSession();
  return session.authenticated ? session.user : null;
}

/** Fails unless a verified session exists; used by protected screens. */
export async function requireAuth(): Promise<AuthUser> {
  const session = await getSession();
  if (!session.configured) throw new AuthenticationNotConfiguredError();
  if (!session.authenticated || !session.user) throw new AuthenticationRequiredError();
  return session.user;
}

export type AuthFlow = "signin" | "signup" | "forgot_password";

/** Starts the hosted-UI flow. The browser leaves the application, so this is a
 * navigation rather than a fetch; `loginHint` prefills the email field.
 * `identityProvider` ("GH") deep-links directly to the GitHub IdP instead of
 * showing Cognito's provider-selection screen.
 */
export function startAuthFlow(
  flow: AuthFlow = "signin",
  loginHint?: string,
  identityProvider?: string,
): void {
  const params = new URLSearchParams();
  if (loginHint) params.set("login_hint", loginHint);
  if (identityProvider) params.set("identity_provider", identityProvider);
  const query = params.toString();
  const path =
    flow === "signin"
      ? "/auth/login"
      : flow === "signup"
        ? "/auth/signup"
        : "/auth/forgot-password";
  window.location.assign(`${apiBaseUrl}${path}${query ? `?${query}` : ""}`);
}

export async function signOut(): Promise<void> {
  await fetch(`${apiBaseUrl}/auth/logout`, {
    method: "POST",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
}

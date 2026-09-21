import { createHash, randomBytes } from "node:crypto";
import {
  cognitoIssuer,
  loadCognitoAuthConfig,
  verifyCognitoIdToken,
  type AuthenticatedUser,
  type CognitoAuthConfig,
  type EnvLike,
} from "./identity";

/**
 * Server-side authentication context.
 *
 * The hosted UI performs the credential checks; this module only starts the
 * authorization-code + PKCE flow, exchanges the code at Cognito's token
 * endpoint, and keeps the resulting ID token in an httpOnly cookie. Nothing is
 * fabricated: with no verified token there is no session, and with no Cognito
 * configuration the endpoints report `AUTH_NOT_CONFIGURED` instead of a login.
 */

export const sessionCookieName = "reposherlock_session";
export const pkceCookieName = "reposherlock_pkce";
/** Cognito access tokens are short lived, so the cookie is too. */
const sessionMaxAgeSeconds = 60 * 60;
const pkceMaxAgeSeconds = 600;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Hosted-UI screens the application can send a visitor to. */
export type AuthFlow = "signin" | "signup" | "forgot_password";

export type StartLoginOptions = {
  flow?: AuthFlow;
  /** Prefills the hosted UI email field; never used as a credential. */
  loginHint?: string;
  /** Directs Cognito to skip the provider-selection screen and go straight to this IdP.
   *  "GH" routes to the GitHub identity provider; omitted shows the generic hosted-UI page.
   */
  identityProvider?: string;
};

export type AuthContext = {
  configured: boolean;
  /** Verified identity for the request, or `undefined` when unauthenticated. */
  getUser: (request: Request) => Promise<AuthenticatedUser | undefined>;
  /** Starts the hosted-UI flow. */
  startLogin: (options?: StartLoginOptions) => LoginStart;
  /** Completes the hosted-UI callback. */
  completeLogin: (request: Request) => Promise<LoginCompletion>;
  /** Clears the session cookies. */
  signOut: () => string[];
};

export type LoginStart = { location: string; setCookie: string[] };

export type LoginCompletion =
  | { ok: true; user: AuthenticatedUser; setCookie: string[] }
  | { ok: false; status: number; code: string; message: string };

export type AuthContextOptions = {
  config?: CognitoAuthConfig;
  env?: EnvLike;
  fetchImpl?: Fetcher;
  nowMs?: number;
};

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Bearer tokens (mobile/CLI clients) take priority over the browser cookie. */
function readPresentedToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return readCookie(request, sessionCookieName);
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function createAuthContext(options: AuthContextOptions = {}): AuthContext {
  const config = options.config ?? loadCognitoAuthConfig(options.env ?? process.env);

  return {
    configured: Boolean(config),

    async getUser(request) {
      if (!config) return undefined;
      const token = readPresentedToken(request);
      if (!token) return undefined;
      return verifyCognitoIdToken(token, config, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
      });
    },

    startLogin(options = {}) {
      if (!config)
        return {
          location: "",
          setCookie: [],
        };
      const verifier = base64Url(randomBytes(32));
      const challenge = base64Url(createHash("sha256").update(verifier).digest());
      const flow = options.flow ?? "signin";
      // Cognito exposes sign-up and recovery as separate hosted-UI screens that
      // accept the same authorization parameters as the sign-in page.
      const path =
        flow === "signup"
          ? "/signup"
          : flow === "forgot_password"
            ? "/forgotPassword"
            : "/oauth2/authorize";
      const authorize = new URL(`${config.domain}${path}`);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", config.clientId);
      authorize.searchParams.set("redirect_uri", config.redirectUri);
      authorize.searchParams.set("scope", "openid email profile");
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      if (options.loginHint) authorize.searchParams.set("login_hint", options.loginHint);
      if (options.identityProvider)
        authorize.searchParams.set("identity_provider", options.identityProvider);
      return {
        location: authorize.toString(),
        setCookie: [cookie(pkceCookieName, verifier, pkceMaxAgeSeconds)],
      };
    },

    async completeLogin(request) {
      if (!config)
        return {
          ok: false,
          status: 503,
          code: "AUTH_NOT_CONFIGURED",
          message: "Sign-in is not configured for this deployment yet.",
        };
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const verifier = readCookie(request, pkceCookieName);
      if (!code || !verifier)
        return {
          ok: false,
          status: 400,
          code: "AUTH_CALLBACK_INVALID",
          message: "The sign-in response was incomplete. Please start again.",
        };

      let tokens: { id_token?: string };
      try {
        const response = await (options.fetchImpl ?? fetch)(`${config.domain}/oauth2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            code,
            redirect_uri: config.redirectUri,
            code_verifier: verifier,
          }).toString(),
        });
        if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);
        tokens = (await response.json()) as { id_token?: string };
      } catch {
        return {
          ok: false,
          status: 502,
          code: "AUTH_EXCHANGE_FAILED",
          message: "Sign-in could not be completed. Please try again.",
        };
      }

      const idToken = tokens.id_token;
      if (!idToken)
        return {
          ok: false,
          status: 502,
          code: "AUTH_EXCHANGE_FAILED",
          message: "Sign-in could not be completed. Please try again.",
        };

      const user = await verifyCognitoIdToken(idToken, config, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
      });
      if (!user)
        return {
          ok: false,
          status: 401,
          code: "AUTH_TOKEN_INVALID",
          message: "The sign-in token could not be verified.",
        };

      return {
        ok: true,
        user,
        setCookie: [
          cookie(sessionCookieName, idToken, sessionMaxAgeSeconds),
          cookie(pkceCookieName, "", 0),
        ],
      };
    },

    signOut() {
      return [cookie(sessionCookieName, "", 0), cookie(pkceCookieName, "", 0)];
    },
  };
}

/** Where Cognito should send the browser after signing out, per config. */
export function cognitoLogoutUrl(config: CognitoAuthConfig): string {
  const url = new URL(`${config.domain}/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("logout_uri", config.redirectUri.replace(/\/api\/auth\/session$/, "/"));
  return url.toString();
}

export { cognitoIssuer };

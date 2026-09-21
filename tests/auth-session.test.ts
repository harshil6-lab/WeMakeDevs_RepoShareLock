import { generateKeyPairSync, sign as signData, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeJwtSegment,
  verifyCognitoIdToken,
  type CognitoAuthConfig,
} from "../src/auth/identity";
import { createAuthContext, pkceCookieName, sessionCookieName } from "../src/auth/server";
import {
  AuthenticationNotConfiguredError,
  AuthenticationRequiredError,
  authHeaders,
  getCurrentUser,
  getSession,
  requireAuth,
  setAccessToken,
  signOut,
  startAuthFlow,
} from "../src/auth/client";

/**
 * Real Cognito token verification.
 *
 * The tokens are signed with a locally generated RSA key and verified against a
 * stub JWKS endpoint, so the suite exercises the same signature/claims checks
 * the deployed Lambda runs without contacting AWS.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};

const config: CognitoAuthConfig = {
  userPoolId: "ap-south-1_TESTPOOL",
  clientId: "client-123",
  region: "ap-south-1",
  domain: "https://reposherlock-test.auth.ap-south-1.amazoncognito.com",
  redirectUri: "https://api.example.com/api/auth/session",
};

const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);

function signToken(overrides: Record<string, unknown> = {}, issuerConfig = config): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "cognito-sub-1",
      email: "detective@example.com",
      name: "Detective",
      iss: `https://cognito-idp.${issuerConfig.region}.amazonaws.com/${issuerConfig.userPoolId}`,
      aud: config.clientId,
      token_use: "id",
      exp: Math.floor(nowMs / 1000) + 600,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = signData(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey as KeyObject,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const jwksFetch = (async () => ({
  ok: true,
  json: async () => ({ keys: [publicJwk] }),
})) as unknown as typeof fetch;

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("Cognito ID token verification", () => {
  it("returns the verified identity for a well-formed token", async () => {
    const user = await verifyCognitoIdToken(signToken(), config, {
      fetchImpl: jwksFetch,
      nowMs,
    });
    expect(user).toEqual({
      userId: "cognito-sub-1",
      email: "detective@example.com",
      displayName: "Detective",
      provider: "cognito",
    });
  });

  it("rejects tampered, mis-audienced, expired and unsigned tokens", async () => {
    const valid = signToken();
    const [header, payload, signature] = valid.split(".") as [string, string, string];
    const cases: [string, string][] = [
      ["tampered payload", `${header}.${payload.slice(0, -4)}abcd.${signature}`],
      ["wrong signature", `${header}.${payload}.${signature.slice(0, -4)}abcd`],
      ["missing signature", `${header}.${payload}.`],
      ["not a jwt", "not.a.jwt"],
      ["wrong audience", signToken({ aud: "someone-else" })],
      ["wrong issuer", signToken({ iss: "https://cognito-idp.ap-south-1.amazonaws.com/other" })],
      ["access token", signToken({ token_use: "access" })],
      ["expired", signToken({ exp: Math.floor(nowMs / 1000) - 60 })],
      ["no subject", signToken({ sub: "" })],
    ];
    for (const [label, token] of cases) {
      const user = await verifyCognitoIdToken(token, config, { fetchImpl: jwksFetch, nowMs });
      expect(user, label).toBeUndefined();
    }
    const unsigned = `${header}.${payload}`;
    expect(
      await verifyCognitoIdToken(unsigned, config, { fetchImpl: jwksFetch, nowMs }),
    ).toBeUndefined();
  });

  it("does not authenticate when the key set cannot be loaded", async () => {
    // A distinct pool id keeps this case out of the module-level JWKS cache.
    const offlineConfig: CognitoAuthConfig = { ...config, userPoolId: "ap-south-1_OFFLINE" };
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(
      await verifyCognitoIdToken(signToken({}, offlineConfig), offlineConfig, {
        fetchImpl: failing,
        nowMs,
      }),
    ).toBeUndefined();
  });

  it("decodes only valid segments", () => {
    expect(decodeJwtSegment("not-base64-json")).toBeUndefined();
  });
});

describe("server auth context", () => {
  it("is unconfigured without the Cognito contract", () => {
    const auth = createAuthContext({ env: {} });
    expect(auth.configured).toBe(false);
  });

  it("starts the hosted-UI flow with PKCE and a login hint", () => {
    const auth = createAuthContext({ config });
    const start = auth.startLogin({ flow: "signin", loginHint: "detective@example.com" });
    const url = new URL(start.location);
    expect(url.origin + url.pathname).toBe(`${config.domain}/oauth2/authorize`);
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("login_hint")).toBe("detective@example.com");
    expect(start.setCookie[0]).toContain(`${pkceCookieName}=`);

    expect(new URL(auth.startLogin({ flow: "signup" }).location).pathname).toBe("/signup");
    expect(new URL(auth.startLogin({ flow: "forgot_password" }).location).pathname).toBe(
      "/forgotPassword",
    );
  });

  it("appends identity_provider when deep-linking to the GitHub IdP", () => {
    const auth = createAuthContext({ config });
    const start = auth.startLogin({ flow: "signin", identityProvider: "GH" });
    const url = new URL(start.location);
    expect(url.searchParams.get("identity_provider")).toBe("GH");
    expect(url.searchParams.get("response_type")).toBe("code");
    // standard params are still present
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("omits identity_provider when not requested", () => {
    const auth = createAuthContext({ config });
    const start = auth.startLogin({ flow: "signin" });
    const url = new URL(start.location);
    expect(url.searchParams.has("identity_provider")).toBe(false);
  });

  it("exchanges the code and stores the verified session in an httpOnly cookie", async () => {
    const verifierCookie = `${pkceCookieName}=verifier-value`;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes("/oauth2/token")) return jsonResponse({ id_token: signToken() });
      return jsonResponse({ keys: [publicJwk] });
    }) as unknown as typeof fetch;
    const auth = createAuthContext({ config, nowMs, fetchImpl });
    const result = await auth.completeLogin(
      new Request(`${config.redirectUri}?code=abc`, { headers: { cookie: verifierCookie } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a verified session");
    expect(result.user.userId).toBe("cognito-sub-1");
    expect(result.setCookie[0]).toContain(`${sessionCookieName}=`);
  });

  it("reports a failed callback instead of inventing a session", async () => {
    const auth = createAuthContext({ config, nowMs });
    const missing = await auth.completeLogin(new Request(config.redirectUri));
    expect(missing).toMatchObject({ ok: false, status: 400, code: "AUTH_CALLBACK_INVALID" });
    const unconfigured = createAuthContext({ env: {} });
    expect(await unconfigured.completeLogin(new Request(config.redirectUri))).toMatchObject({
      ok: false,
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
    });
  });

  it("clears the session cookie on sign-out", () => {
    const auth = createAuthContext({ config });
    const cookies = auth.signOut();
    expect(cookies.join("\n")).toContain(sessionCookieName);
    expect(cookies.join("\n")).toContain("Max-Age=0");
  });
});

describe("browser auth abstraction", () => {
  beforeEach(() => setAccessToken(undefined));

  it("never attaches a token that does not exist", () => {
    expect(authHeaders()).toEqual({});
    setAccessToken("real-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer real-token" });
    setAccessToken(undefined);
    expect(authHeaders()).toEqual({});
  });

  it("sends the browser to the router's hosted-UI path for every flow", () => {
    const paths: string[] = [];
    vi.stubGlobal("window", { location: { assign: (url: string) => paths.push(url) } });
    startAuthFlow("signin");
    startAuthFlow("signup", "user@example.com");
    startAuthFlow("forgot_password");
    expect(paths).toEqual([
      "/api/auth/login",
      "/api/auth/signup?login_hint=user%40example.com",
      "/api/auth/forgot-password",
    ]);

    // Deep-link to GitHub IdP via the client.
    const githubPaths: string[] = [];
    vi.stubGlobal("window", { location: { assign: (url: string) => githubPaths.push(url) } });
    startAuthFlow("signin", undefined, "GH");
    expect(githubPaths[0]).toContain("/api/auth/login");
    expect(githubPaths[0]).toContain("identity_provider=GH");

    vi.unstubAllGlobals();
  });

  it("reports an unauthenticated session without failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ authenticated: false, configured: true, user: null })),
    );
    const session = await getSession();
    expect(session).toEqual({ authenticated: false, configured: true, user: null });
    expect(await getCurrentUser()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns the user for a verified session and requires one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          authenticated: true,
          configured: true,
          user: { userId: "cognito-sub-1", email: "detective@example.com" },
        }),
      ),
    );
    expect(await requireAuth()).toEqual({
      userId: "cognito-sub-1",
      email: "detective@example.com",
    });
    vi.unstubAllGlobals();
  });

  it("distinguishes a missing session from missing configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ authenticated: false, configured: false, user: null })),
    );
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationNotConfiguredError);
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ authenticated: false, configured: true, user: null })),
    );
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthenticationRequiredError);
    vi.unstubAllGlobals();
  });

  it("posts a real sign-out and treats a broken backend as signed out", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        calls.push(String(input));
        return jsonResponse({ authenticated: false });
      }),
    );
    await signOut();
    expect(calls[0]).toContain("/auth/logout");
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await getSession()).toEqual({ authenticated: false, configured: false, user: null });
    vi.unstubAllGlobals();
  });
});

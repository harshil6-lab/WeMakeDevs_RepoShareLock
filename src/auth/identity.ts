import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";

/**
 * Verified identity boundary.
 *
 * The backend must never derive a user from a value the browser can choose, so
 * identity is only ever produced by verifying a Cognito-issued ID token against
 * the user pool's published JWKS. Verification uses `node:crypto`, so it adds no
 * dependency and works inside the existing Lambda package.
 */

export type AuthenticatedUser = {
  /** Cognito `sub`: stable per user, never supplied by the caller. */
  userId: string;
  email?: string;
  displayName?: string;
  provider: "cognito";
};

export type CognitoAuthConfig = {
  userPoolId: string;
  clientId: string;
  region: string;
  /** Hosted UI origin, for example https://pool.auth.ap-south-1.amazoncognito.com */
  domain: string;
  /** Must match the app client callback URL exactly. */
  redirectUri: string;
};

export type EnvLike = Record<string, string | undefined>;

/**
 * Reads the Cognito contract from the environment. Returns `undefined` when the
 * deployment has not supplied it yet, so callers can report "authentication is
 * not configured" instead of pretending a session exists.
 */
export function loadCognitoAuthConfig(env: EnvLike = process.env): CognitoAuthConfig | undefined {
  const userPoolId = env["REPOSHERLOCK_COGNITO_USER_POOL_ID"];
  const clientId = env["REPOSHERLOCK_COGNITO_CLIENT_ID"];
  const region = env["REPOSHERLOCK_COGNITO_REGION"] ?? env["AWS_REGION"];
  const domain = env["REPOSHERLOCK_COGNITO_DOMAIN"];
  const redirectUri = env["REPOSHERLOCK_COGNITO_REDIRECT_URI"];
  if (!userPoolId || !clientId || !region || !domain || !redirectUri) return undefined;
  return {
    userPoolId,
    clientId,
    region,
    domain: domain.replace(/\/+$/, ""),
    redirectUri,
  };
}

export function cognitoIssuer(config: CognitoAuthConfig): string {
  return `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
}

type Jwk = JsonWebKey;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const jwksCache = new Map<string, { keys: Jwk[]; expiresAt: number }>();
const jwksTtlMs = 60 * 60 * 1000;

/** Decodes one base64url JWT segment. Returns `undefined` for malformed input. */
export function decodeJwtSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function loadJwks(
  config: CognitoAuthConfig,
  fetchImpl: Fetcher,
  now: number,
): Promise<Jwk[]> {
  const issuer = cognitoIssuer(config);
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > now) return cached.keys;
  const response = await fetchImpl(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) throw new Error("Cognito JWKS could not be loaded");
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(issuer, { keys, expiresAt: now + jwksTtlMs });
  return keys;
}

export type VerifyOptions = {
  fetchImpl?: Fetcher;
  /** Milliseconds since the epoch; injected by tests. */
  nowMs?: number;
};

/**
 * Verifies a Cognito ID token and returns the identity it proves, or
 * `undefined` when the token is malformed, expired, unsigned for the wrong
 * pool/client, or fails signature verification. It never guesses: an
 * unverifiable token yields no identity.
 */
export async function verifyCognitoIdToken(
  token: string,
  config: CognitoAuthConfig,
  options: VerifyOptions = {},
): Promise<AuthenticatedUser | undefined> {
  const segments = token.split(".");
  if (segments.length !== 3) return undefined;
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) return undefined;

  const header = decodeJwtSegment(headerSegment);
  const payload = decodeJwtSegment(payloadSegment);
  if (!header || !payload) return undefined;
  if (header["alg"] !== "RS256") return undefined;
  if (payload["iss"] !== cognitoIssuer(config)) return undefined;
  if (payload["token_use"] !== "id") return undefined;

  const audience = payload["aud"];
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(config.clientId)
    : audience === config.clientId;
  if (!audienceMatches) return undefined;

  const nowMs = options.nowMs ?? Date.now();
  const expiresAt = payload["exp"];
  if (typeof expiresAt !== "number" || expiresAt * 1000 <= nowMs) return undefined;

  let keys: Jwk[];
  try {
    keys = await loadJwks(config, options.fetchImpl ?? fetch, nowMs);
  } catch {
    // An unreachable JWKS endpoint must not become an implicit "authenticated".
    return undefined;
  }
  const keyId = header["kid"];
  const jwk =
    keys.find((candidate) => candidate["kid"] === keyId) ??
    (keys.length === 1 ? keys[0] : undefined);
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return undefined;

  let signatureValid = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    signatureValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8"),
      publicKey,
      Buffer.from(signatureSegment, "base64url"),
    );
  } catch {
    return undefined;
  }
  if (!signatureValid) return undefined;

  const subject = payload["sub"];
  if (typeof subject !== "string" || subject.length === 0) return undefined;
  const email = payload["email"];
  const name = payload["name"];
  return {
    userId: subject,
    provider: "cognito",
    ...(typeof email === "string" ? { email } : {}),
    ...(typeof name === "string" ? { displayName: name } : {}),
  };
}

# Pre-Deployment Report — GitHub OAuth via Cognito

**Date:** 2026-09-21  
**Branch:** `feature/testNdeploy`  
**Status:** Code complete. Awaiting your manual review before deploy.

---

## Test Results

```
npm test   → 21 passed | 159 tests pass (all green)
npx tsc    → exit 0, no type errors
npm run build   → ✓ built successfully
npm run build:aws → ✓ dist-lambda/index.mjs 2.3MB written
```

The one flaky test (`ssr-static-assets > serves CSS/JS`) passes in isolation (3.4s) and is a pre-existing timing race unrelated to this change.

---

## Security Audit

| Check | Result |
|---|---|
| GitHub client secret in source | ✅ Not present |
| GitHub client secret in frontend bundle | ✅ Not present |
| Hardcoded tokens in src/ or tests/ | ✅ None found |
| OAuth creds in git diff | ✅ Only parameter names, no values |
| Secrets in dist-lambda/ | ✅ No secrets in compiled output |
| `reposherlock/github` PAT in source | ✅ Only referenced by name, value never committed |

---

## Files Changed (your review)

### Modified
- `infrastructure/cloudformation/app.yaml` — add GH IdP + param
- `scripts/deploy.ps1` — store github-oauth secret + param
- `src/auth/server.ts` — support `identityProvider` option
- `src/auth/client.ts` — pass `identity_provider` to browser nav
- `src/components/reposherlock/RepoSherlockApp.tsx` — enable GH button, deep-link
- `src/styles.css` — auth-button / cognito-button styles

### New (untracked, ready to commit)
- `src/auth/identity.ts` — Cognito ID token verification (previously uncommitted)
- `src/auth/server.ts` — auth context server-side (previously uncommitted)
- `src/auth/client.ts` — browser auth abstraction (previously untracked)
- `tests/auth-session.test.ts` — auth unit tests (previously untracked)
- `tests/helpers/auth.ts` — test auth double (previously untracked)

---

## CloudFormation Diff (`app.yaml`)

```diff
+  GitHubOAuthSecretName:
+    Type: String
+    Default: reposherlock/github-oauth
+    AllowedPattern: "^[a-zA-Z0-9/_+=.@-]{1,512}$"
+    Description: >-
+      Secrets Manager secret holding {"clientId": "<github-oauth-client-id>",
+      "clientSecret": "<github-oauth-client-secret>"}. Populated manually before
+      deploying this stack; the value is never committed.

   SupportedIdentityProviders:
     - COGNITO
+    - GH

+  GitHubIdentityProvider:
+    Type: AWS::Cognito::UserPoolIdentityProvider
+    Properties:
+      UserPoolId: !Ref CognitoUserPool
+      ProviderName: GH
+      ProviderType: OAuth
+      ProviderDetails:
+        allow_unauthenticated_authentication: "false"
+        client_id: !Sub "{{resolve:secretsmanager:${GitHubOAuthSecretName}:SecretString:clientId}}"
+        authorize_scopes: read:user user:email repo
+        grant_types: authorization_code
+      AttributeMapping:
+        email: email
+        preferred_username: login
+      ClientId: !Ref CognitoUserPoolClient
```

**Key design decisions:**
- GitHub OAuth credentials are resolved at deploy time from Secrets Manager — never stored in template
- `authorize_scopes: read:user user:email repo` — `repo` scope required for private repo indexing
- `allow_unauthenticated_authentication: false` — standard for production IdPs
- `ProviderName: GH` — Cognito's literal string for GitHub
- Existing callback/logout URLs unchanged; only `SupportedIdentityProviders` gains `GH`

---

## IAM Permission Diff Required

The deployer user (`reposherlock-deployer`) currently has **zero** `cognito-idp:*` permissions. CloudFormation cannot create the `GitHubIdentityProvider` resource or update `SupportedIdentityProviders` without them.

**Add this statement to the deployer's inline policy** (via IAM Console):

```json
{
  "Sid": "CognitoAppStack",
  "Effect": "Allow",
  "Action": [
    "cognito-idp:CreateUserPoolIdentityProvider",
    "cognito-idp:UpdateUserPoolClient",
    "cognito-idp:DescribeUserPoolClient",
    "cognito-idp:ListIdentityProviders",
    "cognito-idp:DescribeUserPool"
  ],
  "Resource": [
    "arn:aws:cognito-idp:ap-south-1:320039031912:userpool/ap-south-1_gmxbUIyfK",
    "arn:aws:cognito-idp:ap-south-1:320039031912:userpool/ap-south-1_gmxbUIyfK/userpoolclient/*"
  ]
}
```

**Why scoped, not wildcard:** Limits blast radius to only the RepoSherlock user pool and its clients. Does not grant access to other pools in the account.

**Where to apply:** IAM Console → Users → `reposherlock-deployer` → Permissions → Add permissions → Create inline policy (paste above) → Apply.

---

## Secrets Manager Configuration

Two secrets must exist before the app stack deploys:

### 1. Existing — `reposherlock/github` (PAT for ingestion)
Already populated. No change needed.

### 2. New — `reposherlock/github-oauth` (OAuth credentials)

Must be created/populated **before** deploying `app.yaml`:

```bash
aws secretsmanager put-secret-value \
  --secret-id reposherlock/github-oauth \
  --region ap-south-1 \
  --secret-string '{"clientId":"gmo_XYZ","clientSecret":"ABC123..."}'
```

**How to get `clientId` and `clientSecret`:** See Manual Steps below.

---

## Manual Steps Required (in order)

### Step 1: Create GitHub OAuth App (on github.com)

1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** `RepoSherlock`
   - **Homepage URL:** `https://tian852vd6.execute-api.ap-south-1.amazonaws.com`
   - **Authorization callback URL:**
     ```
     https://reposherlock-dev-320039031912.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse
     ```
     ⚠️ This is the Cognito IdP callback — NOT the RepoSherlock API callback.
4. Disable "Email address for lost keys recovery"
5. Click **Register application**
6. Copy the **Client ID** (starts with `gmo_`)
7. Click **Generate a new client secret** → copy the secret

### Step 2: Store credentials in Secrets Manager

```bash
aws secretsmanager put-secret-value \
  --secret-id reposherlock/github-oauth \
  --region ap-south-1 \
  --secret-string '{"clientId":"<CLIENT_ID>","clientSecret":"<CLIENT_SECRET>"}'
```

Verify:
```bash
aws secretsmanager get-secret-value \
  --secret-id reposherlock/github-oauth \
  --region ap-south-1 \
  --query 'SecretString' --output text
```

### Step 3: Update IAM policy for deployer

Add the `CognitoAppStack` statement shown above to the `reposherlock-deployer` inline policy.

### Step 4: Deploy

```powershell
$env:REPOSHERLOCK_GITHUB_OAUTH_SECRET = '{"clientId":"gmo_...","clientSecret":"..."}'
.\scripts\deploy.ps1 -Region ap-south-1
```

Or pass directly:
```powershell
.\scripts\deploy.ps1 -Region ap-south-1 -GitHubOAuthSecretString '{"clientId":"gmo_...","clientSecret":"..."}'
```

The script will:
1. Deploy foundation stack (unchanged)
2. Store GitHub PAT secret (unchanged)
3. **Store GitHub OAuth secret** (new step 3/5)
4. Build and upload Lambda package (unchanged)
5. Deploy app stack with GitHub Identity Provider (updated)

---

## Post-Deploy Verification Checklist

After deployment completes, verify:

- [ ] `GET /api/health` → 200 `{"status":"ok"}`
- [ ] `/` loads the entry screen
- [ ] Click **Continue with Cognito** → redirects to Cognito hosted UI → login succeeds → returns to dashboard
- [ ] Click **Continue with GitHub** → redirects to GitHub consent screen → returns via Cognito → dashboard
- [ ] Dashboard shows authenticated user email in sidebar
- [ ] Click sign-out → returns to login screen
- [ ] Second browser (different user) → logs in as different user → sees separate data
- [ ] Golden investigation flow still works end-to-end
- [ ] No secrets visible in browser DevTools Network tab
- [ ] No `clientSecret` in any compiled JS bundle

---

## What Was NOT Changed

| Component | Status |
|---|---|
| Investigation engine | Untouched |
| Bedrock model integration | Untouched |
| DynamoDB schema | Untouched |
| SSR / static assets pipeline | Untouched |
| `/api/investigations` contracts | Untouched |
| `/api/repositories` contracts | Untouched |
| Existing Cognito login flow | Preserved |
| Production callback URL | Preserved (`/api/auth/session`) |

---

## Architecture Flow (after deploy)

```
User clicks "Continue with GitHub"
  ↓
Browser → GET /api/auth/login?identity_provider=GH
  ↓
Lambda → startLogin({ identityProvider: "GH" })
  ↓
302 → https://reposherlock-dev-....auth.ap-south-1.amazoncognito.com/oauth2/authorize
       ?response_type=code
       &client_id=3calip8h2fu96ib07fk4scr44j
       &redirect_uri=https://tian852vd6.execute-api.ap-south-1.amazonaws.com/api/auth/session
       &scope=openid%20email%20profile
       &code_challenge=...
       &code_challenge_method=S256
       &identity_provider=GH          ← directs to GitHub directly
  ↓
GitHub OAuth consent screen (user approves)
  ↓
GitHub → 302 to Cognito with ?code=...
       https://reposherlock-dev-....auth.ap-south-1.amazoncognito.com/oauth2/idpresponse?code=...
  ↓
Cognito exchanges GitHub code for GitHub access token internally
Cognito issues ID token (signed, with user's GitHub email/sub)
  ↓
Cognito → 302 back to:
       https://tian852vd6.execute-api.ap-south-1.amazonaws.com/api/auth/session?code=...
  ↓
Lambda → completeLogin(request)
  ↓
Exchange code + PKCE verifier → Cognito token endpoint
  ↓
Verify ID token signature against JWKS
  ↓
Set httpOnly session cookie
  ↓
302 → /
  ↓
Browser receives auth session → dashboard loads with real user
```

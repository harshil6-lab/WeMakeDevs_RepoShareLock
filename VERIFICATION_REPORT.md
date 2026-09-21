# Verification Report — GitHub OAuth Implementation

**Date:** 2026-09-21  
**Branch:** `feature/testNdeploy`  
**Deploy Status:** Code complete. Waiting on two manual AWS steps.

---

## Verification Checklist

### 1. GitHub OAuth credentials in Secrets Manager

```
aws secretsmanager get-secret-value --secret-id reposherlock/github-oauth --region ap-south-1
→ ResourceNotFoundException: Secret doesn't exist
```

**Status:** ❌ NOT FOUND — must be created before deploy.

### 2. Cognito GitHub Identity Provider

```
aws cognito-idp list-identity-providers --user-pool-id ap-south-1_gmxbUIyfK
→ AccessDeniedException (deployer lacks cognito-idp:ListIdentityProviders)
```

**CloudFormation state:** Stack is `UPDATE_COMPLETE` with OLD template (no GH provider resource).  
The new `GitHubIdentityProvider` resource is in `app.yaml` and will be created on the next stack update — but requires IAM permissions first.

**Status:** ❌ NOT DEPLOYED (blocked by IAM)

### 3. SupportedIdentityProviders in app.yaml

```yaml
SupportedIdentityProviders:
  - COGNITO
  - GH          # ← already updated in template
```

**Status:** ✅ Correct in template. Will take effect on next deploy.

### 4. GitHub button in frontend code

```ts
// src/components/reposherlock/RepoSherlockApp.tsx:252-255
const handleGitHub = () => {
  if (!configured) return;
  setGithubState("loading");
  startAuthFlow("signin", undefined, "GH");   // ← deep-links to GitHub
};
```

Button is enabled whenever `configured` is true. No hardcoded disable.

**Status:** ✅ Enabled

### 5. Test results

```
npm test    → 21 passed | 159 tests pass
npx tsc     → exit 0, no errors
npm run build   → ✓ built successfully
npm run build:aws → ✓ dist-lambda/index.mjs 2.3MB written
```

**Status:** ✅ All green

### 6. Final diffs below

### 7. IAM status

Current deployer inline policy (`reposherlock-deployer-policy.json`):
| Sid | Actions |
|---|---|
| CloudFormation | create/update/describe stacks + changesets |
| S3Foundation | bucket ops |
| DynamoDBFoundation | table ops |
| SecretsManagerFoundation | create/describe/tag/put-value |
| CloudWatchLogsFoundation | log group ops |
| IAMFoundation | role create/delete/attach |
| ApiGatewayFoundation | gateway CRUD |
| BedrockModelValidation | list models |

**Missing:** No `cognito-idp:*` actions. Cannot create the identity provider or update the user pool client during stack deployment.

**Status:** ❌ BLOCKED — IAM must be updated before deploy.

---

## Pre-Deploy Checklist (gate before running deploy.ps1)

- [ ] `reposherlock/github-oauth` secret exists with valid JSON:
  ```json
  {"clientId":"gmo_...","clientSecret":"..."}
  ```
- [ ] Deployer IAM policy includes `cognito-idp:*` for the RepoSherlock user pool

---

## CloudFormation Diff (app.yaml)

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

Also fixes a latent bug: Lambda env vars now receive `REPOSHERLOCK_COGNITO_*` from CFN refs instead of relying on pre-set values. Callback/logout URLs now use `CognitoCallbackBaseUrl` parameter instead of `FrontendBaseUrl`.

---

## IAM Diff Required (deployer policy)

Add this statement to the `reposherlock-deployer` inline policy:

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

---

## Deployment Command (after checklist items are marked ✅)

```powershell
$env:REPOSHERLOCK_GITHUB_OAUTH_SECRET = '{"clientId":"gmo_...","clientSecret":"..."}'
.\scripts\deploy.ps1 -Region ap-south-1
```

The script will:
1. Deploy foundation stack (unchanged)
2. Store GitHub PAT secret (unchanged)
3. **Store GitHub OAuth secret** (new step 3/5)
4. Build and upload Lambda package (unchanged)
5. Deploy app stack — creates `GitHubIdentityProvider`, updates `SupportedIdentityProviders`

---

## Files Changed (git diff HEAD)

| File | Lines | Change |
|---|---|---|
| `infrastructure/cloudformation/app.yaml` | +46 / −4 | GH IdP resource + param + SupportedIdentityProviders |
| `scripts/deploy.ps1` | +19 / −4 | OAuth secret storage step + params |
| `src/auth/server.ts` | +5 / −0 | `identityProvider` option + URL param |
| `src/auth/client.ts` | +8 / −3 | `startAuthFlow()` accepts provider arg |
| `src/components/reposherlock/RepoSherlockApp.tsx` | +78 / −105 | Real session, GH button enabled, mock auth removed |
| `src/styles.css` | +14 / −0 | `.auth-button`, `.cognito-button`, `.provider-note` |
| `tests/auth-session.test.ts` | +20 / −0 | 2 new tests for identity_provider behavior |

New untracked files (from previous session, ready to commit):
- `src/auth/identity.ts` — Cognito ID token verification
- `src/auth/server.ts` — auth context (server)
- `src/auth/client.ts` — auth context (client)
- `tests/auth-session.test.ts` — auth unit tests
- `tests/helpers/auth.ts` — test auth doubles

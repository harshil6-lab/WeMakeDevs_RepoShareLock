# GitHub OAuth via Cognito — Gap Analysis

**Date:** 2026-09-21  
**User Pool:** `ap-south-1_gmxbUIyfK`  
**App Client:** `3calip8h2fu96ib07fk4scr44j`  
**Region:** `ap-south-1`  
**Deployer IAM user:** `arn:aws:iam::320039031912:user/reposherlock-deployer`

---

## 1. Current State (confirmed from deployed Lambda env + CloudFormation)

| Item | Current Value |
|---|---|
| Cognito domain | `https://reposherlock-dev-320039031912.auth.ap-south-1.amazoncognito.com` |
| Production callback | `https://tian852vd6.execute-api.ap-south-1.amazonaws.com/api/auth/session` |
| `SupportedIdentityProviders` | `[COGNITO]` only |
| GitHub Identity Provider | **Not configured** |
| GitHub OAuth App on GitHub | **Does not exist** |
| Frontend GitHub button | Hardcoded disabled (`githubAvailable = false`) |
| `reposherlock/github` secret | Contains `{"githubToken":"github_pat_11..."}` (PAT, not OAuth creds) |
| Deployer IAM policy | No `cognito-idp:*` actions |

---

## 2. What Is Missing

### 2a. GitHub OAuth App (must be created manually on github.com)

No GitHub OAuth App exists. This is the external source of truth that Cognito federates to.

**Required fields:**
- Application name: `RepoSherlock`
- Homepage URL: `https://tian852vd6.execute-api.ap-south-1.amazonaws.com`
- Authorization callback URL (exact):
  ```
  https://reposherlock-dev-320039031912.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse
  ```
- Scopes: `read:user`, `user:email`, `repo`
  - `repo` is required because RepoSherlock indexes private repositories during investigation
  - `read:user` + `user:email` cover the Cognito profile claims

**After creation:** GitHub emits a `Client ID` and `Client Secret`. These are the credentials Cognito needs.

### 2b. Cognito Identity Provider resource (CloudFormation)

The `app.yaml` template has **no** `AWS::Cognito::UserPoolIdentityProvider` resource. This must be added.

```yaml
GitHubIdentityProvider:
  Type: AWS::Cognito::UserPoolIdentityProvider
  Properties:
    UserPoolId: !Ref CognitoUserPool
    ProviderName: GH                        # GitHub's fixed provider name in Cognito
    ProviderType: OAuth
    ProviderDetails:
      allow_unauthenticated_authentication: "false"
      client_id: "{{resolve:secretsmanager:...}}"  # GitHub OAuth Client ID
      authorize_scopes: "read:user user:email repo"
      grant_types: authorization_code
    AttributeMapping:
      email: email
      preferred_username: login
      sub: id
    ClientId: !Ref CognitoUserPoolClient
```

The GitHub OAuth credentials must come from Secrets Manager, not CloudFormation parameters.

### 2c. User Pool Client update

Current `CognitoUserPoolClient` in `app.yaml`:

```yaml
SupportedIdentityProviders:
  - COGNITO
```

Must become:

```yaml
SupportedIdentityProviders:
  - COGNITO
  - GH
```

### 2d. Secret storage for GitHub OAuth credentials

The existing `reposherlock/github` secret holds a **Personal Access Token** for programmatic API access (used by the ingestion pipeline). The GitHub OAuth App credentials are a different thing entirely.

Two options:
1. **Add a new secret** `reposherlock/github-oauth` with `{"clientId":"...","clientSecret":"..."}` — cleanest, no change to existing PAT secret.
2. **Extend the existing secret** to hold both — but this mixes concerns and requires a deploy script change.

**Recommendation:** Option 1 — create a separate secret.

### 2e. CloudFormation parameter addition

`app.yaml` needs two new parameters (or one secret-ref approach):

```yaml
GitHubOAuthSecretName:
  Type: String
  Default: reposherlock/github-oauth
  Description: Secrets Manager secret holding {"clientId":"...","clientSecret":"..."}
```

The `AWS::Cognito::UserPoolIdentityProvider` then reads from this secret using `{{resolve:secretsmanager:...}}`.

### 2f. Frontend code change

In `src/components/reposherlock/RepoSherlockApp.tsx`:
- Remove the hardcoded `const githubAvailable = false;`
- Either: (a) detect availability from the auth context, or (b) trust `configured` flag and let the hosted UI surface whatever providers are available
- The simplest correct approach: remove the `githubAvailable` constant and enable the button whenever `configured` is true. The Cognito hosted UI will show/hide the GitHub option based on its own configuration.

### 2g. Server-side — no changes needed for auth flow

The existing `startLogin()` in `src/auth/server.ts` already constructs the correct `/oauth2/authorize` URL. Cognito itself routes to GitHub when `identity_provider=GH` is in the request. The current frontend calls `startAuthFlow("signin")` without specifying a provider, which shows the generic hosted UI with all providers listed — this works fine.

If we want the GitHub button to go *directly* to GitHub (skipping the provider selection screen), we'd add `identity_provider=GH` to the authorize URL. That requires a small server-side change to `StartLoginOptions` and `startLogin()`.

---

## 3. AWS Permissions Blocking Configuration

The deployer user `reposherlock-deployer` has **zero** `cognito-idp:*` permissions. The current IAM policy covers CloudFormation, S3, DynamoDB, Secrets Manager, CloudWatch Logs, IAM, API Gateway, and Bedrock — but not Cognito.

**Required actions to add to the deployer policy:**

```json
{
  "Sid": "Cognito",
  "Effect": "Allow",
  "Action": [
    "cognito-idp:CreateUserPoolIdentityProvider",
    "cognito-idp:UpdateUserPoolClient",
    "cognito-idp:DescribeUserPoolClient",
    "cognito-idp:ListIdentityProviders",
    "cognito-idp:DescribeUserPool",
    "cognito-idp:CreateIdentityProvider",
    "cognito-idp:UpdateIdentityProvider"
  ],
  "Resource": "*"
}
```

With these permissions, CloudFormation can manage the identity provider resource and update the user pool client during stack deployment — no manual console actions required.

**Alternative:** If we want to keep the deployer policy minimal, we could do the Cognito configuration manually via Console (see section 7), and the deployer never needs Cognito permissions. But that adds a fragile manual step.

---

## 4. Callback URLs (exact values)

| URL | Purpose |
|---|---|
| `https://reposherlock-dev-320039031912.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse` | GitHub → Cognito callback (must be registered with GitHub OAuth App) |
| `https://tian852vd6.execute-api.ap-south-1.amazonaws.com/api/auth/session` | Cognito → RepoSherlock callback (already configured in Cognito client) |
| `https://tian852vd6.execute-api.ap-south-1.amazonaws.com/` | Logout redirect (already configured) |

These are already correct in the deployed CloudFormation. Only the GitHub-side registration needs updating.

---

## 5. SupportedIdentityProviders Changes

Current (in `app.yaml`):
```yaml
SupportedIdentityProviders:
  - COGNITO
```

Required:
```yaml
SupportedIdentityProviders:
  - COGNITO
  - GH
```

Note: `GH` is the literal provider type string Cognito uses for GitHub (not `GITHUB`).

---

## 6. Lambda Changes

**None required** for the auth flow itself.

The existing `startLogin()` already builds the correct authorize URL. The existing `completeLogin()` already exchanges the code and verifies the ID token. The ID token from a GitHub-authenticated user will contain the same standard claims (`sub`, `email`, `name`) that `verifyCognitoIdToken()` already validates.

**One optional improvement:** Add `identity_provider` support to `startLogin()` so the frontend can deep-link directly to GitHub instead of showing the provider selection screen. This requires adding an `identityProvider` field to `StartLoginOptions` and appending `identity_provider=GH` to the authorize URL when set.

The `REPOSHERLOCK_GITHUB_TOKEN` environment variable (the PAT from Secrets Manager) is **not related** to the OAuth flow. It is used by the ingestion pipeline for programmatic API access. That remains unchanged.

---

## 7. Exact Manual AWS Console Actions (if skip CloudFormation)

If we choose NOT to add Cognito permissions to the deployer and do this manually:

### Step 1 — Create GitHub OAuth App (on github.com)
1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - Application name: `RepoSherlock`
   - Homepage URL: `https://tian852vd6.execute-api.ap-south-1.amazonaws.com`
   - Authorization callback URL: `https://reposherlock-dev-320039031912.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse`
4. Disable "Email address for lost keys recovery" (not needed)
5. Click **Register application**
6. Copy **Client ID** and generate a new **Client Secret**

### Step 2 — Store credentials in Secrets Manager
1. Go to AWS Secrets Manager → `reposherlock/github-oauth` (create if absent)
2. Store JSON:
   ```json
   {
     "clientId": "gmo_...",
     "clientSecret": "..."
   }
   ```

### Step 3 — Configure Cognito Identity Provider
1. Go to Amazon Cognito → User pools → `reposherlock-dev`
2. **Federated identity provider** → **Add identity provider**
3. Choose **GitHub**, paste Client ID and Client Secret
4. Scopes: `read:user`, `user:email`, `repo`
5. Attribute mapping:
   - `email` ← `email`
   - `preferred_username` ← `login`
   - `sub` ← `id`
6. Click **Create identity provider**

### Step 4 — Update User Pool Client
1. Go to **App clients** → `reposherlock-dev-web`
2. **Hosted UI domains** → edit
3. Under **Identity providers**, check **GitHub**
4. Under **Allowed OAuth scopes**, ensure `openid`, `email`, `profile` are checked (already set)
5. Save changes

### Step 5 — Update CloudFormation stack (to persist config)
After manual steps, run a CloudFormation stack update so the config survives re-deployment. The updated `app.yaml` would include the `GitHubIdentityProvider` resource and updated `SupportedIdentityProviders`.

---

## 8. Security Considerations

### 8.1 GitHub OAuth Secret in Secrets Manager
- Use a **separate secret** (`reposherlock/github-oauth`) from the PAT secret (`reposherlock/github`). Mixing them creates confusion about what each credential is used for.
- The OAuth client secret has the same sensitivity as any API key — rotate if leaked.

### 8.2 `repo` Scope
- Requesting `repo` scope gives Cognito's GitHub tokens access to **private repositories**. This is necessary for RepoSherlock to index private repos.
- The scope is requested at the Cognito level, not stored client-side. The resulting GitHub access token lives only in Cognito's internal mapping and is never exposed to the frontend.

### 8.3 PKCE is Already Enabled
- The existing `startLogin()` generates a random `code_challenge` (S256) and stores the verifier in an httpOnly cookie. This protects against authorization code interception. No change needed.

### 8.4 No Client-Side Credentials
- GitHub Client ID/Secret must **never** appear in frontend code, Vite env vars, or commit history. They belong only in AWS Secrets Manager and Lambda env.

### 8.5 Logout Flow
- Existing logout sends browser to `${domain}/logout?client_id=...&logout_uri=...`. This already handles Cognito-native logout. After GitHub IdP is added, logging out from Cognito also invalidates the GitHub session. No change needed.

### 8.6 IAM Least Privilege
- Adding `cognito-idp:*` to the deployer is broad. A more scoped policy would limit to the specific user pool ARN:
  ```json
  "Resource": "arn:aws:cognito-idp:ap-south-1:320039031912:userpool/ap-south-1_gmxbUIyfK"
  ```
  However, CloudFormation operations sometimes require wildcard resources. Test after applying.

---

## 9. Estimated Implementation Sequence

| Step | Action | Owner | Effort |
|---|---|---|---|
| 1 | Create GitHub OAuth App on github.com | Manual | 5 min |
| 2 | Store `clientId` + `clientSecret` in `reposherlock/github-oauth` secret | Manual or script | 2 min |
| 3 | Add `cognito-idp:*` to deployer IAM policy (scoped to user pool ARN if possible) | IaC update | 10 min |
| 4 | Update `infrastructure/cloudformation/app.yaml`: add `GitHubIdentityProvider` resource, update `SupportedIdentityProviders`, add `GitHubOAuthSecretName` parameter | Code | 15 min |
| 5 | Update `scripts/deploy.ps1`: store GitHub OAuth secret before stack deploy (prompt or env var) | Script | 10 min |
| 6 | Update `src/components/reposherlock/RepoSherlockApp.tsx`: remove hardcoded `githubAvailable = false`, enable GitHub button when `configured` | Code | 5 min |
| 7 | (Optional) Add `identity_provider` param to `startLogin()` for deep-link to GitHub | Code | 10 min |
| 8 | Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run build:aws` | Verify | 5 min |
| 9 | Deploy CloudFormation stack update | Manual or script | 5 min |
| 10 | Test: click "Continue with GitHub" → GitHub consent → callback → authenticated session | Verify | 10 min |

**Total estimated effort:** ~70 minutes (mostly manual steps 1-2 and testing 10).

---

## Summary: What's Actually Blockers

1. **GitHub OAuth App does not exist** — must be created on github.com (manual, outside AWS).
2. **No `AWS::Cognito::UserPoolIdentityProvider` in CloudFormation** — `app.yaml` must be updated.
3. **`SupportedIdentityProviders` is `[COGNITO]` only** — must add `GH`.
4. **No secret holding GitHub OAuth credentials** — need `reposherlock/github-oauth`.
5. **Deployer lacks `cognito-idp:*` permissions** — IAM policy must be updated (or use Console).
6. **Frontend hardcodes `githubAvailable = false`** — `RepoSherlockApp.tsx` line 252.

Items 1-4 are prerequisites. Items 5-6 are code/config fixes. No Lambda runtime changes are needed for the auth flow itself.

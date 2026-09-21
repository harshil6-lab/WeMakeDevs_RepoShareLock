# RepoSherlock Demo Checklist

## Pre-demo AWS checks

- [ ] AWS profile is `reposherlock`.
- [ ] Region is `ap-south-1`.
- [ ] Lambda `reposherlock-dev` is healthy.
- [ ] The deployed API responds at `https://tian852vd6.execute-api.ap-south-1.amazonaws.com`.
- [ ] Do not change Bedrock, IAM, DynamoDB, or Lambda configuration during the demo.

## Pre-demo application checks

- [ ] Run `npm test` and confirm the suite passes.
- [ ] Run `npm run build` and `npm run build:aws`.
- [ ] Confirm frontend API configuration targets `https://tian852vd6.execute-api.ap-south-1.amazonaws.com` when the frontend is hosted separately.
- [ ] Confirm no credentials, tokens, prompts, or repository contents are bundled or displayed.

## Golden repository check

- [ ] Repository name: `certifypro`.
- [ ] Repository ID: `1154709843`.
- [ ] Repository indexing status is `completed`.

## Golden issue check

- [ ] Golden issue: `#73`.
- [ ] The issue is present in the repository issue list before starting the investigation.

## Bedrock check

- [ ] Bedrock access is available in `ap-south-1`.
- [ ] A failed model response remains a controlled investigation failure; do not fabricate claims or evidence.

## CloudWatch check

- [ ] Tail `/aws/lambda/reposherlock-dev` during the demo.
- [ ] Confirm logs identify `investigationId`, stage or tool, duration, success, and error code where applicable.
- [ ] Confirm logs do not contain credentials, tokens, raw prompts, repository contents, or evidence contents.
- [ ] Known successful investigation: `97fd408f-27a0-4925-b515-b6c1febf4e06`.

## Live URL check

- [ ] Backend API URL: `https://tian852vd6.execute-api.ap-south-1.amazonaws.com`.
- [ ] Public frontend URL: **not currently available**.
- [ ] The existing frontend build is TanStack SSR and the existing S3 bucket `reposherlock-dev-foundation-frontendbucket-teejeqq5h1s4` is private and not configured for website hosting.
- [ ] Do not report `http://localhost:5173` as a production URL.
- [ ] Use the existing local frontend only until an approved frontend hosting path is added.

## Full demo flow

- [ ] Landing.
- [ ] Login.
- [ ] Dashboard.
- [ ] Repository selection.
- [ ] Issue selection.
- [ ] Start investigation.
- [ ] Investigation progress.
- [ ] Investigation result.
- [ ] WHY and evidence.
- [ ] Code.
- [ ] History.
- [ ] Impact empty state if no verified impact data is returned.
- [ ] Fix plan empty state if no verified fix-plan data is returned.

## Fallback procedure

- [ ] Start the frontend locally with `npm run dev`.
- [ ] Set `VITE_API_BASE_URL` to `https://tian852vd6.execute-api.ap-south-1.amazonaws.com` for a separately served frontend, or use the configured local API proxy.
- [ ] Use repository `certifypro`, repository ID `1154709843`, and issue `#73`.
- [ ] If the investigation fails, preserve the failure state and inspect CloudWatch using the investigation ID; do not create demo data.

## Known limitations

- The current AWS deployment exposes the backend API but not a public frontend URL.
- The foundation frontend S3 bucket is reserved but private and unused by the current deployment scripts.
- The existing Lambda handler serves API Gateway requests only; it does not serve the TanStack frontend.
- Impact and fix-plan panels display honest empty states when the validated backend result does not contain those sections.
- A public frontend requires an approved hosting path compatible with the current SSR frontend; no new hosting architecture was introduced in this packet.

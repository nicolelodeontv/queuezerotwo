# QueueZeroTwo

A free pickleball paddle-stacking queue for open play. Add players, send the next four to a court, keep score, and share a live view. It runs in the browser and installs as a PWA, with no account needed.

Live: https://queuezerotwo.vercel.app

## Features

- **Queue and teams:** paddle-stacking queue, a check-in list for players who have not arrived yet, skill levels, player reordering, and rest controls.
- **Team modes:** Balanced or Social mix Up Next teams. Optional Winners stay with a configurable consecutive-win limit, plus Equal sit-outs fairness.
- **Scoring:** play to 11, 15, or 21, with win by 1 or 2. Supports 1 to 8 courts, Undo after Finish & Log, Match Log, Leaderboard, and live standings.
- **Sessions:** name a session, keep the last 30 in Past sessions, share a results link, and share a results image.
- **Players:** all-time player profiles with per-player backup and restore.
- **Backup:** Export and Import the whole session as JSON. Imports are validated and size-limited.
- **On court:** large score controls, haptics, sound, voice announcements, wake lock during matches, and light/dark themes.
- **Live View:** a read-only page for players to follow courts, Up Next, the stack, and the leaderboard in real time.
- **Host handoff:** transfer Live View hosting to another device with a QR code.
- **Offline/PWA:** service worker caching with an update-ready prompt and installable PWA metadata.

## How it works

- `index.html` is the app. Session state lives in browser `localStorage`, so the organizer's device is the source of truth.
- `profiles.js` stores all-time player profiles separately from the current session.
- `sw.js` is the service worker. **Bump the cache name (`queuezerotwo-vN`) whenever a cached file changes**, so installed copies can detect the new version and show the update prompt.
- Styling uses Tailwind CSS v3, built from `src/input.css` into `tailwind.css`. Run `npm run build:css` after adding Tailwind classes.
- `vercel.json` supplies the Content Security Policy. New script, style, font, image, or network hosts must be added there when required.
- `manifest.webmanifest` defines the installable PWA icons. `icon-512.png` is the normal icon and `icon-maskable-512.png` is the padded maskable icon. `make_maskable_icon.py` regenerates the maskable icon from `brand/logo-mark.svg` and verifies the artwork against the circular safe zone.

## Live View and the database

Live View uses Supabase. The organizer publishes session state through the app's RPC path, and viewers receive updates through a private Realtime Broadcast channel.

- Session codes are 10 characters and expire after 7 days. The host key is stored hashed in the database and is never included in viewer state.
- Host handoff puts the replacement host key in the QR URL fragment (`#h=...`), which browsers do not send to the server. The new device rotates the key so the old one stops working.
- Anyone with a Live View link can see the session's player names and scores. Do not put private information in player names.
- The SQL files in `supabase/` are split between a deliberately unsafe legacy setup and the checked-in secure Live View migration chain:
  - `supabase/LEGACY-DO-NOT-RUN-setup.sql` is the original base table setup. Use it only when creating a new throwaway/test database. **Never run it against the existing production database**, because it recreates public insert/update policies.
  - `supabase/migrations/20261003000000_enable_pgcrypto.sql` creates the `pgcrypto` dependency in the `extensions` schema before any security-definer RPC calls use `extensions.digest(...)`.
  - `supabase/migrations/20261004000000_baseline_secure_live_view.sql` is the schema-only secure baseline for `live_sessions`, its exact-code SELECT policy, and `publish_pickle_session`. It contains no production rows or test session codes.
  - `supabase/migrations/20261005000000_host_handoff.sql` contains the `rotate_pickle_host_key` RPC.
  - `supabase/migrations/20261006061538_private_live_view_broadcast.sql` creates the database Broadcast trigger and the private Realtime receive policy.
  - The migration order is **pgcrypto → baseline → host handoff → Broadcast → pg_cron prerequisite → results snapshots → results idempotency → results RPC v2**.
  - `supabase/migrations/20261008070000_enable_pg_cron.sql` creates the `pg_cron` extension in `pg_catalog` before `20261008071028_20261008070934_pickle_results.sql` schedules `queuezerotwo-results-expiry-cleanup`, making the checked-in fresh replay self-contained. Verify production has the extension before applying the results migrations with `select extname, extversion from pg_extension where extname = 'pg_cron';`, and verify the scheduled job with `select jobname, schedule from cron.job where jobname = 'queuezerotwo-results-expiry-cleanup';`.
  - The results migrations are `supabase/migrations/20261008071028_20261008070934_pickle_results.sql`, `20261008073802_results_idempotency_and_cron_replay.sql`, and `20261008074039_results_rpc_return_code.sql`. The first is the original applied snapshot schema; follow-up changes belong in new timestamped migrations.
  - The checked-in migration chain, including the `pg_cron` prerequisite, is replay-tested with `supabase db reset` in GitHub Actions without a generated prerequisite file. Release 2 checks RLS, exact-code read access, host-key validation, idempotent publishing, expiry visibility/cleanup, result payload size, and browser regressions.
- The production project also retains a locked-down legacy `live_matches` table and older dashboard-applied migration history. The active app no longer uses that path, so it is intentionally excluded from the secure Live View baseline.
- Do not run the checked-in baseline chain against the existing production database. Its schema is already present there. Before adopting the files as the authoritative CLI history, reconcile the existing remote migration history with `supabase migration repair` after verifying the live schema.

## Vercel Preview configuration

Production uses the Supabase configuration checked into `index.html`. Keep production credentials out of Preview variables and never embed a Supabase secret/service-role key in browser code.

`npm run build:vercel` builds Tailwind CSS and then runs `scripts/configure-preview.mjs`. The script changes the HTML only when `VERCEL_ENV=preview`; local and Production builds keep the checked-in production configuration.

Preview mode is intentionally selectable:

- **Snapshot-only (the current default when both variables are blank):** leave both `SB_URL` and `SB_KEY` blank in the Vercel Preview environment. The built preview disables the Supabase client and uses `ZZTEST`-prefixed live session codes, so it cannot publish to the Production backend.
- **Isolated test backend:** set both `SB_URL` and `SB_KEY` as Preview-only variables before building the deployment. The URL must be exactly `https://yeytqiyhosoyuassjcef.supabase.co`; the key must be that same project's browser-safe anon/publishable key. Setting only one variable, using any other project URL, or using a secret/service-role key fails the build. New Preview deployments with both variables blank are snapshot-only; changing environment variables does not rewrite already-built deployments.

The Content Security Policy is host-specific. Production aliases use a CSP that permits the Production Supabase origin but not the test project's origin. Preview deployments use the Preview CSP, which permits the isolated test origin for opt-in test-backed deployments. Keep both policies aligned with the deployment environment and avoid adding unrelated network hosts.

The real-device workflow is `.github/workflows/real-device-release1.yml`. Its no-cost `[device-preflight]` checks the protected Preview URL and verifies the HTML targets the dedicated test project. A `[run-real-device]` commit or manual `workflow_dispatch` can start BrowserStack sessions and may incur charges. Configure the repository Actions secrets `QUEUEZEROTWO_TEST_APP_URL`, `BROWSERSTACK_USERNAME`, and `BROWSERSTACK_ACCESS_KEY` before attempting the device run. The URL must be a protected Vercel Preview deployment built in isolated test-backend mode, never Production.


## Development

- **Tests:** there is no `npm test` script. The real browser regression is `.github/workflows/release2-playwright.yml`. Locally, run `npm ci`, `npm run build:css`, `npx playwright install chromium`, start a static server on port 4173, then run `APP_URL=http://127.0.0.1:4173/ node tests/release2b-sessions.mjs`. CI also checks the main inline JavaScript with `node --check`.
- **Production deploys:** only `main` deploys to production. Vercel's ignored build step skips every other branch.
- **Deployment quota:** production deploys count against Vercel's daily limit, so batch unrelated changes into one real PR when practical.
- **Branch hygiene:** use short-lived branches and delete them after they are merged or intentionally closed.

## Icons and SEO

- `icon-maskable-512.png` is padded for the Android maskable safe area and uses the `maskable` purpose in `manifest.webmanifest`. The normal `icon-512.png` remains a separate `any` icon.
- `robots.txt` and `sitemap.xml` use the same host as the canonical URL in `index.html`.
- If the canonical host changes to `queuezerotwo.app`, update the canonical URL, Open Graph URL/image, `robots.txt`, and `sitemap.xml` together.

This is the production Docker build context for the private Postiz instance.

The upstream image is pinned by digest. The build preserves the Railway cookie
domain fix, disables internal AI, and fails if the expected compiled code changes.
It does not build or upload the repository, `.secrets`, or local artifacts.

The AI variant:

- Loads MCP tools directly, without a Mastra agent or conversation memory.
- Removes Copilot controller registration and stubs the legacy AI generators.
- Replaces Agent navigation with a Brand Hub entry and hides the composer chat
  popup in SSR and browser bundles.
- Redirects `/agents` to `/launches`, and returns 404 for internal AI HTTP routes.
- Keeps developer/API-key settings, OAuth, MCP authentication, calendar, posts,
  media uploads, Temporal workers, Redis and PostgreSQL unchanged.
- Uses one Nginx worker for this instance's CPU allocation.
- Starts the same three programs directly under PM2, preloading `dotenv/config`,
  rather than retaining per-program pnpm and dotenv CLI wrapper processes. The
  database preparation step, automatic restarts and startup command stay intact.

MCP's `ask_postiz` disappears because it invoked the internal agent. MCP's direct
post/media/channel tools are retained. The Copilot context wrapper remains for
editor hooks; it cannot access the removed chat backend.

The variant is intentionally fixed at image build time. To restore internal AI,
remove its patch/test steps, rebuild this context and deploy. Do not replace the
cookie fix or the `unset PORT; nginx && pnpm run pm2` startup command.

Production verification (2026-11-17): MCP initialize/tools/list and read-only
channel/post listing passed; 20 direct tools remain, without `ask_postiz`.
Authenticated calendar and posts API return 200; internal AI routes return 404.
All three PM2 processes are online without restarts, Temporal health passes,
registrations remain closed, and the Railway cookie regression check passes.

Brand Hub v1 is mounted at `/hub/`; see [hub/README.md](hub/README.md).
Calendar and publishing now use the same light editorial identity. The bridge in
`unify-postiz-ui.cjs` adds the shared navigation, colors, font, focus styling and
named publishing destinations to both compiled SSR and browser assets. It retains
the official editor and scheduling handlers, changes immutable asset filenames,
and asserts pinned upstream markers before the image can build. Review fixes cover
the time-badge contrast, keyboard channel selection, labeled channel-panel buttons
and the connections icon. Resource limits and service processes are unchanged.

Calendar/theme release: `fe593a84-8173-4d65-bf5a-f38dab89831b` (2026-11-17).
Authenticated browser checks at 1440×1050 and 390×844 passed for layout fit,
navigation to connections, channel selection by keyboard, editing and preview.
MCP, calendar/posts reads, AI isolation, closed registration and cookie checks pass;
all three processes are online with zero restarts. No post was saved or published.
The critique distinguishes inherited localization, small secondary controls and
modal accessibility limitations from the changes shipped here.

Verified release: `05463593-b4de-47da-90a6-016fb0e6a2e3` (2026-11-17).
Live checks passed for brand persistence, version conflicts, image upload,
avatar/banner dimensions, Origin checks, private assets and workspace isolation.
Browser checks passed for create/edit, editorial variant saving, the YouTube
setup page and calendar-to-hub navigation. Synthetic test data was removed.
MCP and calendar regression checks passed with zero PM2 restarts. Actual YouTube
branding writes await a real channel and explicit approval in the application.

## Rebuild and reactivate on Railway

1. Open the existing `postiz` project and its `production` environment. Confirm
   that the PostgreSQL volume is mounted at `/var/lib/postgresql/data`, the Redis
   volume at `/data`, and the app's volume at `/uploads`. Reuse the service
   variables in Railway, including the existing `JWT_SECRET` used to decrypt
   saved Brand Hub credentials.
2. Redeploy the removed deployments for `Postgres` and `Redis`, wait for both
   services, then redeploy `Temporal` and check that it is ready.
3. Set the `postiz` service limit to 1.625 GB of RAM (decimal) and 0.5 vCPU,
   the settings of the verified deployment on 2026-11-17. The 2026-11-18
   redeploy ran with 1 GB and repeatedly ran out of memory. Upload a fresh
   build from the repository root using the existing project's ID:

   ```sh
   railway up deploy/railway --path-as-root --project <project-id> --environment production --service postiz --message "Reactivate Brand Hub"
   ```

4. Check `/auth/login` and the authenticated `/hub/` page. In the running
   container, verify that `/sys/fs/cgroup/memory.max` is approximately
   1,625,000,000 bytes and the backend and orchestrator restart counters stay
   stable.

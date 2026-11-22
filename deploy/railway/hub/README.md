# Brand Hub v1

Generic, brand-first workspace mounted at `/hub/` in the existing backend. No
GeoPieno-specific data or sample brands are shipped. Theme, logo and UI are local
assets; no third-party font or analytics calls are added.

## Scope

- Brand identity, colors, approved YouTube description and channel associations.
- Private image library (PNG/JPEG/WebP); normalized images and generated exports.
- Server-rendered PNG avatars (800×800) and banners (2560×1440), with central safe
  area composition. These are deterministic templates, not generative AI.
- Credential inventory at `/hub/#connections`, grouped by platform and provider
  identity. Channels and their brand assignments are nested under each credential.
- Add credential lives at `/hub/#connections/add`; callback refreshes only that
  identity. Refresh and additional channel authorization are separate actions.
- Credential-scoped encrypted inventories persist between visits; partial errors
  retain channels from failed grants. Distinct Google channel grants belonging to
  one provider identity are preserved without showing duplicate credential cards.
- Inline brand assignment can create a brand or move/remove a channel association
  transactionally. A new-brand name is requested only when chosen explicitly.
- Reuse existing Postiz credentials; read Meta Pages, portfolios and linked
  professional Instagram profiles, and the YouTube channels in each OAuth grant.
- Explicit proposals based on existing assignments, Page/Instagram links, names
  and website hosts. Users can exclude resources or change their destination.
- Transactional, idempotent import creates Postiz integrations and brand
  associations together. Existing brand descriptions, colors and logos survive.
- Guided YouTube Brand Account creation through the channel switcher.
- Comparison and explicit confirmation before updating the selected YouTube
  channel's description and/or banner. Ownership is checked using `mine=true`.
- Independent editable editorial variants with copy-to-Postiz handoff. Drafts
  are not automatically scheduled or synchronized with Postiz posts.
- Avatar/name/handle are completed in YouTube Studio. Campaigns, website SEO,
  Search Console and website analytics are outside this release.

## Persistence and security

Uses the existing Postiz AuthMiddleware, user and organization. JSON documents
are stored in PostgreSQL schema `brand_hub`, separate from the upstream `public`
Prisma schema. Every query is organization-scoped and parameterized. Updates
use optimistic version checks. Existing Postiz tables are not altered.

Images live on the persistent volume under `/uploads/.brand-hub`. Nginx blocks
public access to that directory; images are served only through authenticated,
workspace-scoped handlers. Uploads are raster-only, decoded and re-encoded with
pixel and file size limits. Browser mutations require the configured frontend
Origin. OAuth access/refresh tokens never leave the server.

Connections use existing registered Facebook/YouTube redirect URLs. Nginx routes
only `hub_` state callbacks to Hub; ordinary Postiz callbacks keep their original
route. OAuth state is random, short-lived, single-use and bound to user/workspace;
Google also uses PKCE. New connection credentials and discovery snapshots use
AES-256-GCM, bound to the workspace with a key derived from JWT_SECRET. Changing
that secret requires reconnecting these accounts. Imported publishing tokens
are stored using Postiz's existing integration format. Snapshots expire after
15 minutes. Cleanup removes expired temporary documents on connection starts.

Discovery is read-only on social platforms; import writes local database records
only. Seeing an asset does not imply publishing access. Partial retrieval errors
are shown, never interpreted as a reason to delete integrations. Google login to
Hub does not grant YouTube access, and one grant does not enumerate every channel
managed by a Google identity. Additional channels may need separate grants.

The YouTube update uses current settings as its base and checks both brand
version and a channel-settings digest before applying. Only requested fields
are changed. An event is recorded after success. Failed or abandoned setup
does not delete or disconnect an existing channel.

Backups must include both PostgreSQL's `brand_hub` schema and the uploads volume.
One backend replica is assumed for the in-flight update guard. Before scaling,
replace the in-memory guard with a database/Redis lock and enforce unique
channel assignments transactionally.

## Deployment and verification

Installed by `../install-hub.cjs`; upstream compiled marker drift fails the build.
Run `node --test domain.test.cjs` for validation, escaping, description limits
and preservation of existing YouTube settings. The parent Dockerfile also runs
cookie and MCP-isolation tests. Live checks should exercise brand save/reload,
stale updates, raster upload, PNG dimensions, unauthenticated/private asset
denial and calendar/MCP health. Use synthetic data and remove only test records.

YouTube writes must be tested by the user approving an actual intended channel
configuration; never use a real channel as a disposable automated-test target.

Reference APIs:
- https://developers.google.com/youtube/data/reference/rest/v3/channels/update
- https://developers.google.com/youtube/data/reference/rest/v3/channelBanners/insert
- https://developers.google.com/youtube/create-channel
- https://support.google.com/youtube/answer/10456525

This extension is distributed under the repository's AGPL-3.0 license.

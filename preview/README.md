# Single-site demo preview

Run `npm ci`, then `npm run build:preview` on Node20+. Publish `dist/preview`
as one static site. Root `netlify.toml` supplies the same build/publish settings
for Git-connected Netlify builds; `_redirects` travels with manual uploads too.

Routes: `/checkout/`, `/portal/`, `/command-center/`. Nested SPA routes return
their own app index; existing static assets take precedence. Normal app dev/build
defaults remain `/`; the preview builder sets each Vite base explicitly, and
React Router uses that compiled base. No provider credentials are needed.

The default is an in-memory demo deployment. Set `VITE_RUNTIME_MODE=supabase`
only when deploying the separately reviewed connected application entries. This
changes the landing, each app notice and provenance to Supabase catalog/draft
request mode; payments/providers remain not connected. The packaging flag alone
does not implement or certify the connected runtime. Passed VITE_* environment
values are preserved for app builds. The builder modifies only generated HTML
to add the shared notice; mock mode explicitly describes resets and no app sync.

`build.json` records source commit, dirty-tree state, build time, demo mode and
SHA-256 hashes of published files. A dirty or unknown source must not be treated
as a certified commit artifact. The builder runs Node's packaging tests after
all three Vite builds; a failed asset/provenance/routing check fails deployment.

Packaging does not deploy or mutate databases. GitHub branch/PR checks, site
connection, live browser validation and any Supabase integration are separate
governed steps. Netlify build environment needs only public build metadata.

Routing follows [Netlify static rewrites](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)
and [Vite public base paths](https://vite.dev/guide/build.html#public-base-path).

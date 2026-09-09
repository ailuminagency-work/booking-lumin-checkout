# Reviewed Netlify preview workflow

The September 9, 2026 inspection found an existing GitHub-connected site: **gregarious-longma-6158a8**, site ID `0dffb4f0-a853-48c2-a90a-a30394b87e69`. This supersedes the earlier missing-connection finding. The other sites mentioned by the user were not the current repository deployment: sage-kangaroo was an older Netlify Drop and flourishing-kashata was empty when inspected.

Observed production was `main` at `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`, deploy `6aa192e8086cda53325a9010`. This program did not publish that production deployment. Experimental candidates remain on isolated branches and stacked draft PRs.

## Preview branch and configuration

- Only `codex/reviewed-preview` is enabled for branch deployment, alongside unchanged production `main`.
- Nonsecret `VITE_RUNTIME_MODE=mock` is scoped to Builds and that exact branch, with no general deploy context value. Production configuration and provider credentials are unchanged.
- Repository `netlify.toml` controls the build: typecheck, workspace tests, and `build:preview`, publishing `dist/preview`. The build log confirmed root configuration discovery despite the site's `apps/checkout` package setting.
- [Reviewed preview](https://codex-reviewed-preview--gregarious-longma-6158a8.netlify.app/) contains a landing page and Checkout, Portal, and Command Center. The explicit sample-data banner describes in-memory behavior. It is not a hosted database or authenticated business-operations acceptance test.

## Advancement and verification

1. Complete builder tests, domain review, independent review, adversarial testing, integration, Runtime Guardian, exact candidate CI, and Release Governor review on an isolated branch. A successful Netlify build cannot substitute for database CI.
2. Verify the reviewed-preview remote head and that the accepted candidate is its descendant. Advance only by normal fast-forward Git push. Never force-push or automatically promote a branch deploy to production.
3. Observe the resulting Netlify build and compare its full source SHA to the accepted candidate. Require known, clean provenance; check source again after packaging. Generated Netlify directories may be ignored, but tracked changes and unexpected source files must remain detectable.
4. Verify `/build.json`, declared runtime mode, all three surfaces, deep links, referenced assets, and production's unchanged SHA/deploy. Preserve public manifest and test evidence outside the source checkout.
5. On failure, return the candidate to its builder. Do not relabel a dirty build clean, suppress arbitrary Git changes, or deploy a new candidate merely to make the dashboard green.

## First observed branch deployment

Normal Git push of accepted PR41 at `1d372ed5ecb59ce8312a7fc135fb31498a33d6a0` triggered deploy `6aa1d30372b5830008d3d522`. The site rendered the landing and Portal, but `/build.json` reported `sourceDirty: true`. This deployment therefore **failed acceptance**. Its build log showed generated `apps/checkout/.netlify/edge-functions`; generated-file handling and strict provenance checks are the next correction. A later passing receipt must identify its own exact SHA and deployment.

GitHub-to-Netlify build triggering is observed; the whole system is not yet synchronized. Hosted Render/API, Supabase migrations, genuine authentication, tenant isolation, worker journeys, and persistence still require their own evidence. Stripe, calendar, email, SMS, CRM, and other real provider credentials remain disconnected by user instruction.

## Accepted correction

[PR42](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/42), exact `5b8108e26cff65d319cb9a81b48d7904969d8b03`, passed all nine gates, including both required jobs in [CI34409972655](https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/34409972655). Normal branch fast-forward triggered successful Netlify deploy `6aa1d7aacc0e4800083ffe9c`.

Public verification at September 9, 2026 22:05 UTC confirmed the exact SHA, `sourceDirty: false`, explicit demo mode, all 11 public artifact hashes, and six correct app/deep-link HTML responses. Browser checks rendered the landing, Checkout, Portal dashboard and Command Center health page. Production stayed on the original main deployment. The original dirty deploy remains failed historical evidence; the corrected deployment has its own acceptance receipt.

Fresh infrastructure inventory found Supabase project `pplwyfbxrnodimhzlvdl` healthy with migrations 0001–0009 and zero Edge Functions, versus repository migrations 0001–0024. The connected Render workspace contained only two services for the separate Leadgate repository. No Booking Lumin API host was identified. These findings keep hosted operation and pilot gates open despite the successful static preview. The next API host must replace local synthetic authentication through a reviewed contract before staging deployment.

# Local questionnaire preview validation

Business owners can check answers against their current unsaved configurable questionnaire and reset the preview. The preview uses the same question renderer and canonical answer validator as the customer request flow, with native required/quantity validation and keyboard-accessible actions.

The result applies only to the displayed questions and answers. Answer, question configuration, service, flow or revision changes invalidate it. Reset clears preview answers and feedback without saving, publishing, submitting, reserving capacity or collecting payment. The component receives no network client, credential or tenant context. Invalid answers produce fixed user-facing feedback, and missing native controls receive focus.

This contributes to W3 questionnaire preview and test scenarios. It does not complete the full field library, responsive flow builder, installation modes, hosted authentication or W3 acceptance. The published Netlify demo and genuine hosted Portal remain separate environments; this change does not activate a backend or a provider.

Builder: Ohm / baseline_context, leaf93c34733283a17ccb80d0e23b0045ef880a65870. Independent/domain review: Arendt / architecture_audit. Adversarial review: Ptolemy / security_audit. Root owns integration and release coordination. Builder and independent checks cover native/canonical validation, hidden answers, stale success, reset and absence of transport effects. Root separately verified actual browser keyboard required/success/reset behavior. Exact integrated candidate Runtime/CI receipts belong in the stacked draft PR.

The preceding crypto compatibility candidate PR46 at5f2972fe7d3a782114d01bfaaa4960d30f4e7986 passed exactCI34506321657 and all review gates. It remains unmerged and unapplied to live Supabase. No historical migration, payment authority or tenant boundary changes in this preview increment.

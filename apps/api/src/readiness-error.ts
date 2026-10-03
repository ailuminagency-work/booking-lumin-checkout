/** Only fixed diagnostic categories may reach logs; never raw database errors. */
export function readinessFailure(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '28P01' || code === '28000') return 'DB_AUTH';
  if (code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'DB_TLS';
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return 'DB_NETWORK';
  return 'DB_UNAVAILABLE';
}

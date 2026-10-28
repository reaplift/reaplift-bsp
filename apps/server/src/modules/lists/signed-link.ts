import { createHmac, timingSafeEqual } from 'node:crypto';

/** What an upload link grants: one file, with this name, for one client, until `expires` (unix seconds). */
export interface UploadGrant {
  clientId: string;
  uploadId: string;
  fileName: string;
  expires: number;
}

function signature(grant: UploadGrant, secret: string) {
  return createHmac('sha256', secret)
    .update(JSON.stringify([grant.clientId, grant.uploadId, grant.fileName, grant.expires]))
    .digest('hex');
}

export function signUploadUrl(grant: UploadGrant, secret: string) {
  const query = new URLSearchParams({
    clientId: grant.clientId,
    fileName: grant.fileName,
    expires: String(grant.expires),
    sig: signature(grant, secret),
  });
  return `/api/lists/uploads/${grant.uploadId}?${query}`;
}

export type LinkCheck = 'ok' | 'invalid' | 'expired';

/** Checks the signature first, so an altered expiry reads as invalid rather than expired. */
export function checkUploadSignature(
  grant: UploadGrant,
  sig: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): LinkCheck {
  if (!sig || !Number.isInteger(grant.expires)) return 'invalid';
  const expected = Buffer.from(signature(grant, secret));
  const received = Buffer.from(sig);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return 'invalid';
  return grant.expires < nowSeconds ? 'expired' : 'ok';
}

/**
 * The public half of the release key, which signs CNW's updates as it signs Codehouse's (O41). It must stay the same
 * as RELEASE_KEYS in apps/host/src/update/manifest.ts; a test checks it.
 */
export const CNW_RELEASE_KEYS: readonly string[] = [
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4hHePojIPLyz/XfXlXpO08RV/gTjRGzPNfYjar7SHbM=\n-----END PUBLIC KEY-----\n",
]

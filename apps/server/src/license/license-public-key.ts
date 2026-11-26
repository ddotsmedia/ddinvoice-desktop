/**
 * Ed25519 public key that verifies license files. The matching private key is held by the vendor only
 * (never in the repo, installer or logs); tools/license/issue-license.ts signs with it.
 * Rotating the key means shipping a new server build, so keep the pair stable.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAppZYPAK7xzKdBZBacjfpxW0zd0wR/wqVuFGFMlKoClQ=
-----END PUBLIC KEY-----
`;

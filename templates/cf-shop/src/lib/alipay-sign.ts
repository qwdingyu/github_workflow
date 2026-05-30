/**
 * Alipay RSA2 (SHA256WithRSA) signing utilities.
 *
 * Fully compatible with Cloudflare Workers (uses Web Crypto API).
 * No external dependencies.
 */

const encoder = new TextEncoder();

/**
 * Build the canonical sign string from parameters.
 * Rules (per Alipay spec):
 * - Exclude 'sign' and 'sign_type' parameters
 * - Exclude empty values
 * - Sort keys by ASCII order
 * - Concatenate as key1=value1&key2=value2 (no URL encoding)
 */
export function buildSignString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "")
    .replace(/-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = base64ToUint8Array(pemBody);

  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    // Fallback to PKCS#1 format
    const pkcs1Header = [
      0x30, 0x82, 0x01, 0x22,
      0x30, 0x0d,
      0x06, 0x09,
      0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
      0x05, 0x00,
      0x04, 0x82, 0x01, 0x0f,
    ];
    const pkcs8Der = new Uint8Array(pkcs1Header.length + binaryDer.length);
    pkcs8Der.set(pkcs1Header);
    pkcs8Der.set(binaryDer, pkcs1Header.length);

    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN\s+(RSA\s+)?PUBLIC\s+KEY-----/g, "")
    .replace(/-----END\s+(RSA\s+)?PUBLIC\s+KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDer = base64ToUint8Array(pemBody);

  return await crypto.subtle.importKey(
    "spki",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * Sign parameters using RSA2 (SHA256WithRSA).
 */
export async function signRSA2(
  params: Record<string, string>,
  privateKeyPem: string,
): Promise<string> {
  const signString = buildSignString(params);
  const key = await importPrivateKey(privateKeyPem);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signString),
  );

  return uint8ArrayToBase64(new Uint8Array(signature));
}

/**
 * Verify an RSA2 signature from Alipay callback.
 */
export async function verifyRSA2(
  params: Record<string, string>,
  alipayPublicKeyPem: string,
): Promise<boolean> {
  const sign = params["sign"];
  if (!sign) return false;

  const signString = buildSignString(params);
  const key = await importPublicKey(alipayPublicKeyPem);
  const signatureBytes = base64ToUint8Array(sign);

  return await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    encoder.encode(signString),
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

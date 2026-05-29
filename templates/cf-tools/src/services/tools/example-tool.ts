/**
 * 示例工具：文本哈希生成器
 *
 * 支持 SHA-256 / SHA-1 / MD5 多种哈希算法。
 * 展示如何实现 ToolDriver 接口。
 *
 * 输入：
 *   { text: string, algorithm?: "SHA-256" | "SHA-1" | "MD5" }
 *
 * 输出：
 *   { hash: string, algorithm: string, inputLength: number }
 */

import { sha256 } from "@eforge/cf-core/security";
import type { ToolDriver, ToolContext } from "./types";

/**
 * 将 ArrayBuffer 转换为十六进制字符串
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 文本哈希生成器 — 实现 ToolDriver 接口
 */
export const exampleTool: ToolDriver = {
  name: "text-hash",
  description: "文本哈希生成器 — 支持 SHA-256 / SHA-1 / MD5",

  async run(input: Record<string, unknown>, _ctx: ToolContext): Promise<Record<string, unknown>> {
    // ── 参数校验 ──
    const text = input.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("参数 text 必须为非空字符串");
    }

    // 限制输入长度（防止滥用）
    if (text.length > 100_000) {
      throw new Error("输入文本过长（最大 100,000 字符）");
    }

    const algorithm = (input.algorithm as string) || "SHA-256";
    const validAlgorithms = ["SHA-256", "SHA-1", "MD5"];

    if (!validAlgorithms.includes(algorithm)) {
      throw new Error(`不支持的算法: ${algorithm}，支持: ${validAlgorithms.join(", ")}`);
    }

    // ── 执行哈希 ──
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    let hash: string;

    if (algorithm === "MD5") {
      // Web Crypto 不原生支持 MD5，使用简易实现
      hash = md5(text);
    } else {
      // SHA-256 和 SHA-1 使用 Web Crypto API
      if (algorithm === "SHA-256") {
        // 优先使用 cf-core 的 sha256（封装了 Web Crypto）
        hash = await sha256(text);
      } else {
        const buffer = await crypto.subtle.digest(algorithm, data);
        hash = bufferToHex(buffer);
      }
    }

    // ── 返回结果 ──
    return {
      hash,
      algorithm,
      inputLength: text.length,
    };
  },
};

// ═══ MD5 简易实现（仅供示例，生产环境建议用专用库） ═══════════════════════════

/**
 * 简易 MD5 实现（基于 RFC 1321）
 * 注意：仅用于示例工具演示，生产环境建议使用成熟的加密库。
 */
function md5(input: string): string {
  // 使用 Web Crypto 不支持 MD5，这里提供一个纯 JS 实现
  function rotateLeft(x: number, n: number): number {
    return (x << n) | (x >>> (32 - n));
  }

  function addUnsigned(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function f(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function g(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function h(x: number, y: number, z: number) { return x ^ y ^ z; }
  function i(x: number, y: number, z: number) { return y ^ (x | ~z); }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function gg(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function hh(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function ii(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  // 字符串转字节数组
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;

  // 填充
  const padded: number[] = [];
  for (let j = 0; j < len; j++) padded.push(bytes[j]);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);

  // 附加长度（小端序 64 位）
  const bitLen = len * 8;
  for (let j = 0; j < 8; j++) padded.push((bitLen >>> (j * 8)) & 0xff);

  // 处理每个 64 字节块
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

  const S = [
    [7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21],
  ];

  const T: number[] = [];
  for (let j = 0; j < 64; j++) T.push(Math.floor(Math.abs(Math.sin(j + 1)) * 0x100000000));

  for (let offset = 0; offset < padded.length; offset += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      M.push(
        padded[offset + j * 4] |
        (padded[offset + j * 4 + 1] << 8) |
        (padded[offset + j * 4 + 2] << 16) |
        (padded[offset + j * 4 + 3] << 24),
      );
    }

    let aa = a, bb = b, cc = c, dd = d;

    for (let j = 0; j < 64; j++) {
      let round: number, x: number, s: number;
      if (j < 16) {
        round = 0; x = M[j]; s = S[0][j % 4];
        aa = ff(aa, bb, cc, dd, x, s, T[j]);
      } else if (j < 32) {
        round = 1; x = M[(5 * j + 1) % 16]; s = S[1][j % 4];
        aa = gg(aa, bb, cc, dd, x, s, T[j]);
      } else if (j < 48) {
        round = 2; x = M[(3 * j + 5) % 16]; s = S[2][j % 4];
        aa = hh(aa, bb, cc, dd, x, s, T[j]);
      } else {
        round = 3; x = M[(7 * j) % 16]; s = S[3][j % 4];
        aa = ii(aa, bb, cc, dd, x, s, T[j]);
      }
      // 轮转
      const tmp = dd; dd = cc; cc = bb; bb = aa; aa = tmp;
      void round; // suppress unused
    }

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  // 输出（小端序 hex）
  function toHexLE(n: number): string {
    let s = "";
    for (let j = 0; j < 4; j++) {
      s += ((n >>> (j * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return s;
  }

  return toHexLE(a) + toHexLE(b) + toHexLE(c) + toHexLE(d);
}

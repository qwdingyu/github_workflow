#!/usr/bin/env node

/*
 * Cloudflare 静态资源安全头生成脚本。
 *
 * 使用边界：
 * - 适用于 Cloudflare Pages 和 Workers Static Assets。
 * - 只负责写入 _headers 文件，不替代 Worker API 里的鉴权、Turnstile、限流。
 * - 默认写到当前目录的 public/_headers；可用 CF_HEADERS_FILE 指定 src/_headers 或 dist/_headers。
 * - 默认不覆盖已有文件；只有 CF_OVERWRITE_HEADERS=true 才会覆盖。
 */

import fs from "node:fs";
import path from "node:path";

const env = process.env;

const config = {
  file: env.CF_HEADERS_FILE || "public/_headers",
  scenario: env.CF_HEADERS_SCENARIO || "app",
  overwrite: env.CF_OVERWRITE_HEADERS === "true",
  allowConnect: splitCsv(env.CF_CONNECT_SRC || "'self'"),
  allowImages: splitCsv(env.CF_IMG_SRC || "'self',data:"),
  allowFrames: splitCsv(env.CF_FRAME_SRC || ""),
  allowScripts: splitCsv(env.CF_SCRIPT_SRC || "'self'"),
  allowStyles: splitCsv(env.CF_STYLE_SRC || "'self'"),
  allowFonts: splitCsv(env.CF_FONT_SRC || "'self'")
};

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function directive(name, values) {
  if (values.length === 0) return "";
  return `${name} ${values.join(" ")}`;
}

function contentSecurityPolicy() {
  const directives = [
    "default-src 'self'",
    directive("script-src", config.allowScripts),
    directive("style-src", config.allowStyles),
    directive("img-src", config.allowImages),
    directive("font-src", config.allowFonts),
    directive("connect-src", config.allowConnect),
    directive("frame-src", config.allowFrames),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].filter(Boolean);

  if (config.scenario === "static") {
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'"
    ].join("; ");
  }

  return directives.join("; ");
}

function headersTemplate() {
  return `/*
  Content-Security-Policy: ${contentSecurityPolicy()}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
`;
}

const target = path.resolve(process.cwd(), config.file);
if (fs.existsSync(target) && !config.overwrite) {
  console.error(`Refusing to overwrite existing file: ${target}`);
  console.error("Set CF_OVERWRITE_HEADERS=true if this replacement is intentional.");
  process.exit(3);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, headersTemplate(), "utf8");
console.log(`已写入 Cloudflare 安全头文件: ${target}`);

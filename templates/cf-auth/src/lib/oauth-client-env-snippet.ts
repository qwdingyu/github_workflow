/**
 * OAuth client 创建成功后的可粘贴 env 片段（纯函数）。
 * secret 仅调用方在「仅一次」明文可用时传入；不从库回读。
 */

export type OAuthClientEnvSnippetInput = {
  /** Issuer / BETTER_AUTH_URL，无尾斜杠 */
  issuer: string;
  clientId: string;
  /** 仅创建/轮换响应中的明文；缺省则片段中不写 secret 行 */
  clientSecret?: string | null;
  redirectUris: string[];
  /** 可选：写入注释 */
  name?: string | null;
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 生成业务侧可粘贴的环境变量块（docs/014 字段名）。
 */
export function buildOAuthClientEnvSnippet(input: OAuthClientEnvSnippetInput): string {
  const issuer = stripTrailingSlash((input.issuer || "").trim());
  const clientId = (input.clientId || "").trim();
  const secret =
    input.clientSecret == null || input.clientSecret === ""
      ? null
      : String(input.clientSecret);
  const redirects = (input.redirectUris || []).map((u) => String(u).trim()).filter(Boolean);
  const primaryRedirect = redirects[0] ?? "";
  const name = (input.name || "").trim();

  const lines: string[] = [];
  if (name) lines.push(`# OAuth client: ${name}`);
  lines.push(`CF_AUTH_ISSUER=${issuer}`);
  lines.push(`CF_AUTH_CLIENT_ID=${clientId}`);
  if (secret) {
    lines.push(`CF_AUTH_CLIENT_SECRET=${secret}`);
  } else {
    lines.push(`# CF_AUTH_CLIENT_SECRET=(仅创建/轮换时显示一次，此处无明文)`);
  }
  lines.push(`CF_AUTH_REDIRECT_URI=${primaryRedirect}`);
  lines.push(`CF_AUTH_ENABLED=true`);
  if (redirects.length > 1) {
    lines.push(`# additional redirect_uris:`);
    for (const u of redirects.slice(1)) {
      lines.push(`# ${u}`);
    }
  }
  return lines.join("\n");
}

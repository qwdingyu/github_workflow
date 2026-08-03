/**
 * 最小登录 / 同意页（服务端 HTML）。
 * 第一阶段不引入前端构建链，保证 OAuth 闭环可跑；后续可换 Vue。
 */
import { Hono } from "hono";
import type { AppEnv } from "../bindings";

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · cf-auth</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 28rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin-top: 0.75rem; font-size: 0.875rem; }
    input { width: 100%; padding: 0.5rem; box-sizing: border-box; margin-top: 0.25rem; }
    button, .btn {
      display: inline-block; margin-top: 1rem; padding: 0.55rem 1rem;
      border: 0; border-radius: 0.375rem; background: #111; color: #fff; cursor: pointer;
      text-decoration: none; font-size: 0.95rem;
    }
    .btn.secondary { background: #444; }
    .muted { color: #666; font-size: 0.85rem; }
    .error { color: #b00020; margin-top: 0.75rem; }
    .card { border: 1px solid #ccc; border-radius: 0.5rem; padding: 1rem; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export const pagesRoute = new Hono<AppEnv>();

pagesRoute.get("/", (c) => {
  return c.html(
    layout(
      "统一认证",
      `<h1>cf-auth</h1>
       <p class="muted">统一身份服务 · OAuth/OIDC Provider</p>
       <p><a class="btn" href="/sign-in">登录</a>
       <a class="btn secondary" href="/api/health">Health</a></p>
       <p class="muted">业务项目请使用授权码 + PKCE 接入，勿共享 Cookie。</p>`,
    ),
  );
});

pagesRoute.get("/sign-in", (c) => {
  const next = c.req.query("redirect_uri") || c.req.query("callbackURL") || "/";
  return c.html(
    layout(
      "登录",
      `<h1>登录</h1>
       <p class="muted">登录会话仅属于 auth 域；完成后回到 OAuth 授权流程。</p>
       <div class="card">
         <form id="email-form">
           <label>邮箱 <input name="email" type="email" required autocomplete="username" /></label>
           <label>密码 <input name="password" type="password" required minlength="8" autocomplete="current-password" /></label>
           <label>显示名（仅注册） <input name="name" type="text" placeholder="可选" /></label>
           <button type="submit" name="intent" value="sign-in">登录</button>
           <button type="submit" name="intent" value="sign-up" class="btn secondary" style="background:#444">注册并登录</button>
         </form>
         <p id="msg" class="error" hidden></p>
         <hr style="margin:1.25rem 0;border:none;border-top:1px solid #ddd" />
         <button type="button" id="google-btn" class="btn secondary">使用 Google 登录</button>
         <p class="muted">Google 需配置 GOOGLE_CLIENT_*；未配置时按钮会失败属预期。</p>
       </div>
       <script>
         const nextUrl = ${JSON.stringify(next)};
         const msg = document.getElementById('msg');
         function show(err) { msg.hidden = false; msg.textContent = err; }
         document.getElementById('email-form').addEventListener('submit', async (e) => {
           e.preventDefault();
           const fd = new FormData(e.target);
           const intent = e.submitter && e.submitter.value ? e.submitter.value : 'sign-in';
           const body = {
             email: fd.get('email'),
             password: fd.get('password'),
             name: fd.get('name') || String(fd.get('email')).split('@')[0],
           };
           const path = intent === 'sign-up' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email';
           const res = await fetch(path, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify(body),
           });
           if (!res.ok) {
             const t = await res.text();
             show('失败 ' + res.status + ': ' + t);
             return;
           }
           // 登录成功：若从 OAuth 跳来可回 redirect；否则进首页
           window.location.href = nextUrl || '/';
         });
         document.getElementById('google-btn').addEventListener('click', async () => {
           const res = await fetch('/api/auth/sign-in/social', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify({ provider: 'google', callbackURL: nextUrl || '/' }),
           });
           if (res.redirected) { window.location.href = res.url; return; }
           const data = await res.json().catch(() => ({}));
           if (data.url) { window.location.href = data.url; return; }
           show('Google 登录不可用: ' + res.status + ' ' + JSON.stringify(data));
         });
       </script>`,
    ),
  );
});

pagesRoute.get("/consent", (c) => {
  // Provider 把完整授权 query（含 sig）挂在 /consent?... 上；consent API 需要 oauth_query
  const clientId = c.req.query("client_id") || "";
  const scope = c.req.query("scope") || "";
  const rawSearch = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?") + 1) : "";
  return c.html(
    layout(
      "授权同意",
      `<h1>授权应用</h1>
       <div class="card">
         <p>应用请求访问你的身份信息（openid / profile / email）。</p>
         <p class="muted">client_id: <code>${escapeHtml(clientId)}</code></p>
         <p class="muted">scope: <code>${escapeHtml(scope)}</code></p>
         <button type="button" id="accept">同意</button>
         <button type="button" id="deny" class="btn secondary">拒绝</button>
         <p id="msg" class="error" hidden></p>
       </div>
       <script>
         // 使用服务端写入的原始 query，避免二次编码破坏签名
         const oauth_query = ${JSON.stringify(rawSearch)};
         const scope = ${JSON.stringify(scope)};
         const msg = document.getElementById('msg');
         async function consent(accept) {
           const res = await fetch('/api/auth/oauth2/consent', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify({
               accept,
               scope: scope || undefined,
               oauth_query: oauth_query || undefined,
             }),
           });
           if (res.redirected) { window.location.href = res.url; return; }
           const data = await res.json().catch(() => ({}));
           if (data.url) { window.location.href = data.url; return; }
           if (data.redirect && data.url) { window.location.href = data.url; return; }
           if (!res.ok) {
             msg.hidden = false;
             msg.textContent = '失败 ' + res.status + ': ' + JSON.stringify(data);
             return;
           }
           msg.hidden = false;
           msg.textContent = '未获得 redirect：' + JSON.stringify(data);
         }
         document.getElementById('accept').onclick = () => consent(true);
         document.getElementById('deny').onclick = () => consent(false);
       </script>`,
    ),
  );
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

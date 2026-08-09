/**
 * 最小登录 / 同意页（服务端 HTML）。
 * 社交按钮按 /api/auth-meta/social 动态渲染，未配置密钥的 IdP 不出现。
 */
import { Hono } from "hono";
import { escapeHtml } from "../lib/email";
import type { AppEnv } from "../bindings";

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · cf-auth</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      --card-border: color-mix(in srgb, CanvasText 14%, transparent);
      --muted: color-mix(in srgb, CanvasText 55%, transparent);
      --accent: #1a73e8;
      --danger: #b00020;
      --surface: color-mix(in srgb, Canvas 92%, CanvasText 8%);
    }
    body { max-width: 26rem; margin: 1.25rem auto 2.5rem; padding: 0 1rem 2rem; line-height: 1.5; }
    .top-nav {
      display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem 0.75rem;
      flex-wrap: wrap; margin: 0 0 1.25rem; padding: 0 0 0.65rem;
      border-bottom: 1px solid var(--card-border);
      font-size: 0.8rem; color: var(--muted);
    }
    .top-nav a {
      color: inherit; text-decoration: none;
      padding: 0.2rem 0.15rem; border-radius: 0.25rem;
    }
    .top-nav a:hover { color: CanvasText; text-decoration: underline; }
    .top-nav .sep { opacity: 0.45; user-select: none; }
    h1 { font-size: 1.35rem; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
    .context-badge {
      display: inline-flex; align-items: center; gap: 0.35rem;
      margin: 0 0 0.75rem; padding: 0.2rem 0.55rem; border-radius: 999px;
      font-size: 0.75rem; font-weight: 600;
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--accent);
    }
    .lead { color: var(--muted); font-size: 0.9rem; margin: 0 0 1rem; }
    .lead strong { color: CanvasText; font-weight: 600; }
    label { display: block; margin-top: 0.75rem; font-size: 0.875rem; }
    input {
      width: 100%; padding: 0.55rem 0.65rem; box-sizing: border-box; margin-top: 0.25rem;
      border-radius: 0.4rem; border: 1px solid var(--card-border); background: Canvas; color: CanvasText;
    }
    input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px; }
    button, .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
      margin-top: 0.65rem; padding: 0.65rem 1rem; min-height: 2.6rem;
      border: 0; border-radius: 0.45rem; background: #111; color: #fff; cursor: pointer;
      text-decoration: none; font-size: 0.95rem; width: 100%; box-sizing: border-box;
      font-weight: 560;
    }
    button:disabled, .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn.secondary { background: #444; }
    .btn.social { background: #24292f; }
    .btn.social.google { background: #1a73e8; }
    .btn.social.github { background: #24292f; }
    .btn.social.microsoft { background: #2f2f2f; }
    .btn.social.discord { background: #5865f2; }
    .btn.social.apple { background: #000; }
    .btn.social.gitlab { background: #fc6d26; }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .error {
      color: var(--danger); margin-top: 0.75rem; font-size: 0.875rem;
      white-space: pre-wrap; word-break: break-word;
    }
    .card {
      border: 1px solid var(--card-border); border-radius: 0.65rem; padding: 1.1rem 1rem 1rem;
      background: var(--surface);
    }
    .divider {
      display: flex; align-items: center; gap: 0.75rem; margin: 1.1rem 0 0.35rem;
      color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .divider::before, .divider::after {
      content: ""; flex: 1; height: 1px; background: var(--card-border);
    }
    #social-slot { display: flex; flex-direction: column; gap: 0.35rem; }
    details.email-panel { margin-top: 0.5rem; }
    details.email-panel summary {
      cursor: pointer; user-select: none; color: var(--muted); font-size: 0.85rem; padding: 0.35rem 0;
    }
    .busy-hint { font-size: 0.8rem; color: var(--muted); margin: 0.35rem 0 0; min-height: 1.1em; }
    .auth-mode-switch {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.4rem;
      margin-top: 0.7rem;
    }
    .mode-tab {
      margin: 0;
      padding: 0.58rem 0.8rem;
      min-height: 2.4rem;
      border: 1px solid var(--card-border);
      border-radius: 0.45rem;
      background: transparent;
      color: CanvasText;
      font-size: 0.9rem;
      font-weight: 600;
      width: 100%;
    }
    .mode-tab.active {
      background: var(--accent);
      color: white;
      border-color: color-mix(in srgb, var(--accent) 70%, white);
    }
    .mode-tab:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .email-mode-hint {
      margin: 0.55rem 0 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .session-actions {
      margin-top: 1rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--card-border);
    }
    .session-actions p {
      margin: 0 0 0.55rem;
    }
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
       <p class="muted">统一身份服务 · 可用 Google/GitHub 等登录 · 对外提供 OAuth/OIDC（业务站用授权码接入）</p>
       <p><a class="btn" href="/sign-in">登录</a>
       <a class="btn secondary" href="/api/health">服务状态</a>
       <a class="btn secondary" href="/admin/">平台管理</a></p>
       <div class="session-actions" id="non-admin-session-actions" hidden>
         <p class="muted">当前浏览器已登录普通账号。</p>
         <button type="button" class="btn secondary" id="non-admin-logout-btn">退出登录</button>
         <p class="busy-hint" id="non-admin-logout-msg" aria-live="polite"></p>
       </div>
       <p class="muted">业务应用请走授权码 + PKCE，不要共用本站登录 Cookie。「平台管理」仅供已配置的平台管理员，普通用户登录后也不会自动获得管理权限。</p>
       <script>
         (async () => {
           const actions = document.getElementById('non-admin-session-actions');
           const logoutBtn = document.getElementById('non-admin-logout-btn');
           const msg = document.getElementById('non-admin-logout-msg');
           if (!actions || !logoutBtn || !msg) return;

           async function jsonOrNull(res) {
             try { return await res.json(); } catch (e) { return null; }
           }

           try {
             const [uiRes, sessionRes] = await Promise.all([
               fetch('/api/auth-meta/ui', { credentials: 'include' }),
               fetch('/api/auth/get-session', { credentials: 'include' }),
             ]);
             const ui = await jsonOrNull(uiRes);
             if (!uiRes.ok || !ui || !ui.ui || !ui.ui.showNonAdminLogout) return;

             const session = await jsonOrNull(sessionRes);
             if (!sessionRes.ok || !session || !session.user) return;

             const adminRes = await fetch('/api/admin/health', { credentials: 'include' });
             if (adminRes.ok) return;

             actions.hidden = false;
           } catch (e) {
             return;
           }

           logoutBtn.addEventListener('click', async () => {
             logoutBtn.disabled = true;
             msg.textContent = '正在退出…';
             try {
               await fetch('/api/auth/sign-out', {
                 method: 'POST',
                 credentials: 'include',
                 headers: { 'Content-Type': 'application/json' },
                 body: '{}',
               });
               msg.textContent = '已退出。';
               actions.hidden = true;
             } catch (e) {
               msg.textContent = '退出失败，请稍后再试。';
               logoutBtn.disabled = false;
             }
           });
         })();
       </script>`,
    ),
  );
});

pagesRoute.get("/sign-in", (c) => {
  // 保留完整 query，便于 OAuth 未登录回流（Provider 会带 response_type 等参数）
  const rawSearch = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?") + 1) : "";
  // 平台 Admin：/sign-in?callbackURL=/admin/... 登录后应回管理台（勿被 OAuth redirect_uri 抢）
  const nextFallback =
    c.req.query("callbackURL") || c.req.query("redirect_uri") || "/";
  return c.html(
    layout(
      "登录",
      `<nav class="top-nav" id="top-nav" aria-label="站点导航"></nav>
       <h1 id="page-title">登录</h1>
       <div id="context-slot"></div>
       <p class="lead" id="lead-text">会话仅属于本认证域。登录后将回到你原来的目的地。</p>
       <div class="card">
         <div id="social-slot"><p class="muted">加载登录方式…</p></div>
         <p class="busy-hint" id="busy" aria-live="polite"></p>
         <div id="email-block" hidden>
           <div class="divider" id="email-divider">或使用邮箱</div>
	           <details class="email-panel" id="email-panel">
	             <summary id="email-summary">邮箱登录 / 注册新账号</summary>
	             <div class="auth-mode-switch" id="auth-mode-switch" role="tablist" aria-label="邮箱方式">
	               <button type="button" class="mode-tab active" id="mode-login" aria-selected="true">邮箱登录</button>
	               <button type="button" class="mode-tab" id="mode-signup" aria-selected="false">注册新账号</button>
	             </div>
	             <p class="email-mode-hint" id="email-mode-hint">已有账号请直接登录。新用户请切换到“注册新账号”。</p>
	             <form id="email-form">
	               <label>邮箱 <input name="email" type="email" required autocomplete="username" inputmode="email" /></label>
	               <label>密码 <input name="password" type="password" required minlength="8" autocomplete="current-password" /></label>
	               <label id="name-label">显示名（仅注册） <input name="name" type="text" placeholder="可选" autocomplete="nickname" /></label>
	               <button type="submit" name="intent" value="sign-in" id="login-btn">邮箱登录</button>
	               <button type="submit" name="intent" value="sign-up" class="btn secondary" id="signup-btn">注册新账号</button>
	               <div id="signup-verification" hidden>
	                 <label>邮箱验证码 <input id="signup-otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" /></label>
	                 <button type="button" class="btn secondary" id="verify-signup-btn">验证并完成注册</button>
                 <button type="button" class="btn secondary" id="resend-signup-otp-btn">重新发送验证码</button>
                 <p class="muted" id="signup-verify-hint"></p>
               </div>
             </form>
           </details>
         </div>
         <p id="msg" class="error" hidden role="alert"></p>
       </div>
       <script>
         const rawSearch = ${JSON.stringify(rawSearch)};
         const nextFallback = ${JSON.stringify(nextFallback)};
         const q = new URLSearchParams(rawSearch);
         // 仅 RP OAuth 回流（带 response_type+client_id）才续 authorize；
         // 平台 Admin 用 ?callbackURL=/admin 时必须回到 /admin，不能拼进 authorize
         const isOauthReturn = q.has('response_type') && q.has('client_id');
         function safePath(u) {
           if (!u) return '/';
           if (u.startsWith('/') && !u.startsWith('//')) return u;
           try {
             const x = new URL(u, window.location.origin);
             if (x.origin === window.location.origin) return x.pathname + x.search + x.hash;
           } catch (e) {}
           return '/';
         }
         const postLogin = isOauthReturn
           ? ('/api/auth/oauth2/authorize?' + rawSearch)
           : safePath(q.get('callbackURL') || q.get('redirect_uri') || nextFallback || '/');
         const isAdminReturn = !isOauthReturn && (postLogin === '/admin' || postLogin.startsWith('/admin/'));

         // 场景化文案 + 顶栏导航：Admin 深链 / OAuth 授权 / 通用
         (function applyContext() {
           const title = document.getElementById('page-title');
           const lead = document.getElementById('lead-text');
           const slot = document.getElementById('context-slot');
           const topNav = document.getElementById('top-nav');
           function setTopNav(links) {
             // links: [{ href, label }, ...]
             topNav.innerHTML = links.map((l, i) => {
               const a = '<a href="' + l.href + '">' + l.label + '</a>';
               return i === 0 ? a : '<span class="sep" aria-hidden="true">·</span>' + a;
             }).join('');
           }
           if (isOauthReturn) {
             title.textContent = '登录以继续授权';
             lead.innerHTML =
               '登录成功后将回到该应用的授权确认。本站登录态只保存在认证域名；业务网站应使用授权码 + PKCE，不会自动共享你的登录 Cookie。';
             slot.innerHTML = '<span class="context-badge">应用授权</span>';
             setTopNav([{ href: '/', label: '首页' }]);
           } else if (isAdminReturn) {
             title.textContent = '管理登录';
             lead.hidden = false;
             lead.innerHTML =
               '仅限已有账号登录，注册请返回统一登录。登录后是否可进入后台，由服务端权限自动判断。';
             slot.innerHTML =
               '<span class="context-badge">后台入口</span>' +
               '<p class="muted" style="margin:0.5rem 0 0;font-size:0.85rem">登录成功后将前往后台。</p>';
             setTopNav([
               { href: '/admin/login', label: '管理入口' },
               { href: '/', label: '首页' },
             ]);
           } else {
             title.textContent = '登录';
             lead.textContent =
               '登录会话仅保存在本认证站点。成功后会回到你指定的页面或首页。新用户请切换到“注册新账号”。';
             setTopNav([
               { href: '/admin/', label: '管理入口' },
               { href: '/', label: '首页' },
             ]);
           }
         })();

         const msg = document.getElementById('msg');
         const busy = document.getElementById('busy');
         function show(err) { msg.hidden = false; msg.textContent = err; }
         function clearMsg() { msg.hidden = true; msg.textContent = ''; }
         function setBusy(text) { busy.textContent = text || ''; }
         function setSocialBusy(on) {
           document.querySelectorAll('#social-slot button').forEach((b) => { b.disabled = on; });
         }
         function friendlyError(status, raw) {
           let parsed = null;
           try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {}
           const m = (parsed && (parsed.message || parsed.error)) || '';
           const code = (parsed && parsed.code) || '';
           if (status === 429) return '尝试过于频繁，请稍后再试。';
           if (code === 'EMAIL_ALREADY_REGISTERED') return '该邮箱已注册，请直接登录。';
           if (code === 'EMAIL_SIGNUP_PENDING_VERIFICATION') {
             return '该邮箱已注册但尚未验证，请输入验证码或重新发送验证码。';
           }
           if (code === 'EMAIL_OTP_UNAVAILABLE') return '注册验证码暂不可用，请联系平台管理员。';
           if (code === 'EMAIL_NOT_VERIFIED' || /EMAIL_NOT_VERIFIED|验证邮箱/i.test(String(m))) {
             return '请先输入邮箱验证码完成注册。';
           }
           if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') return '验证码无效或已过期，请重新获取。';
           if (status === 403 || /BLOCKED|不可用|banned/i.test(String(m))) return '账号不可用，请联系平台管理员。';
           if (status === 401 || /invalid|password|credential/i.test(String(m))) {
             return isAdminReturn
               ? '邮箱或密码不正确。请使用已有账号登录，或改用上方按钮。'
               : '邮箱或密码不正确。';
           }
           if (m) return String(m);
           return '操作失败（' + status + '）';
         }

         let emailMode = 'login';
         let signupVerificationRequired = false;
         let signupVerificationAvailable = true;
         let signupVerificationVisible = false;
         let pendingSignupEmail = '';
         let pendingSignupPassword = '';

         function setEmailMode(mode) {
           emailMode = mode;
           const loginTab = document.getElementById('mode-login');
           const signupTab = document.getElementById('mode-signup');
           const modeHint = document.getElementById('email-mode-hint');
           const modeSwitch = document.getElementById('auth-mode-switch');
           const loginBtn = document.getElementById('login-btn');
           const signupBtn = document.getElementById('signup-btn');
           const nameLabel = document.getElementById('name-label');
           const panel = document.getElementById('signup-verification');
           const isSignup = mode === 'signup';
           loginTab.classList.toggle('active', !isSignup);
           signupTab.classList.toggle('active', isSignup);
           loginTab.setAttribute('aria-selected', String(!isSignup));
           signupTab.setAttribute('aria-selected', String(isSignup));
           loginBtn.hidden = isSignup;
           signupBtn.hidden = !isSignup || isAdminReturn;
           nameLabel.hidden = !isSignup || isAdminReturn;
           modeSwitch.hidden = isAdminReturn;
           if (modeHint) {
             if (isAdminReturn) {
               modeHint.textContent = '这里只提供已有账号登录。';
             } else if (isSignup) {
               modeHint.textContent = signupVerificationRequired
                 ? '注册后会先发送邮箱验证码，完成验证后才能继续。'
                 : '注册成功后会自动登录。';
             } else if (!signupVerificationAvailable) {
               modeHint.textContent = '注册暂不可用，请联系平台管理员启用邮件通道。';
             } else {
               modeHint.textContent = '已有账号请直接登录。新用户请切换到“注册新账号”。';
             }
           }
           panel.hidden = !(isSignup && signupVerificationVisible && !isAdminReturn);
         }

         function setSignupVerificationVisible(on, email) {
           signupVerificationVisible = on;
           const hint = document.getElementById('signup-verify-hint');
           if (on) {
             pendingSignupEmail = email || pendingSignupEmail;
             hint.textContent = '请检查 ' + pendingSignupEmail + ' 的验证码邮件；如未收到，请点击重新发送验证码。';
           }
           setEmailMode('signup');
           if (on && !isAdminReturn) document.getElementById('signup-otp').focus();
         }

         async function loadMeta() {
           const res = await fetch('/api/auth-meta/social');
           const data = await res.json();
           signupVerificationRequired = Boolean(data.emailPolicy && data.emailPolicy.signupVerificationRequired);
           signupVerificationAvailable = !signupVerificationRequired ||
             Boolean(data.emailPolicy && data.emailPolicy.signupVerificationAvailable);
           const slot = document.getElementById('social-slot');
           slot.innerHTML = '';
           if (!data.providers || data.providers.length === 0) {
             slot.innerHTML = '<p class="muted">暂无可用的社交登录。请稍后再试，或使用邮箱登录。</p>';
           } else {
             for (const p of data.providers) {
               const b = document.createElement('button');
               b.type = 'button';
               b.className = 'btn social ' + p.id;
               b.dataset.label = p.label;
               b.textContent = '使用 ' + p.label + ' 继续';
               b.setAttribute('aria-label', '使用 ' + p.label + ' 登录');
               b.onclick = () => socialLogin(p.id, b);
               slot.appendChild(b);
             }
           }
           if (data.emailPassword) {
             document.getElementById('email-block').hidden = false;
             document.getElementById('email-summary').textContent = isAdminReturn
               ? '邮箱登录'
               : '邮箱登录 / 注册新账号';
             const signupBtn = document.getElementById('signup-btn');
             const signupTab = document.getElementById('mode-signup');
             signupBtn.textContent = signupVerificationRequired ? '注册并发送验证码' : '注册新账号';
             signupBtn.disabled = !signupVerificationAvailable || isAdminReturn;
             signupTab.disabled = !signupVerificationAvailable || isAdminReturn;
             if (!signupVerificationAvailable) {
               const hint = document.getElementById('signup-verify-hint');
               hint.textContent = '注册暂不可用，请联系平台管理员启用邮件通道。';
             }
             // Admin 场景：邮箱折叠为次路径，避免与主路径（社交）抢注意；非 Admin 默认展开便于开发自测
             const panel = document.getElementById('email-panel');
             if (!isAdminReturn) panel.open = true;
             if (isAdminReturn) {
               setEmailMode('login');
             } else {
               setEmailMode(emailMode);
             }
           }
         }

         async function socialLogin(provider, btn) {
           clearMsg();
           setSocialBusy(true);
           const label = (btn && btn.dataset.label) || provider;
           setBusy('正在跳转 ' + label + '…');
           if (btn) btn.textContent = '跳转中…';
           try {
             const callbackURL = postLogin.startsWith('http')
               ? postLogin
               : (window.location.origin + (postLogin.startsWith('/') ? postLogin : '/' + postLogin));
             const res = await fetch('/api/auth/sign-in/social', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               credentials: 'include',
               body: JSON.stringify({ provider, callbackURL }),
             });
             if (res.redirected) { window.location.href = res.url; return; }
             const data = await res.json().catch(() => ({}));
             if (data.url) { window.location.href = data.url; return; }
             show(friendlyError(res.status, data) || (label + ' 暂不可用'));
           } catch (e) {
             show(String(e));
           } finally {
             setBusy('');
             setSocialBusy(false);
             if (btn) btn.textContent = '使用 ' + label + ' 继续';
           }
         }

         document.getElementById('email-form').addEventListener('submit', async (e) => {
           e.preventDefault();
           clearMsg();
           const fd = new FormData(e.target);
           const intent = e.submitter && e.submitter.value ? e.submitter.value : 'sign-in';
           // Admin 深链（callbackURL→/admin）：本页只保留已有账号登录
           if (isAdminReturn && intent === 'sign-up') {
             show('管理场景不开放注册。请使用已有账号登录。');
             return;
           }
           const body = {
             email: fd.get('email'),
             password: fd.get('password'),
             name: fd.get('name') || String(fd.get('email')).split('@')[0],
           };
           const path = intent === 'sign-up' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email';
           setBusy(intent === 'sign-up' ? '注册中…' : '登录中…');
           const res = await fetch(path, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify(body),
           });
           setBusy('');
           if (!res.ok) {
             const text = await res.text();
             let errorCode = '';
             try {
               const data = JSON.parse(text);
               errorCode = data && data.code ? String(data.code) : '';
             } catch (e) {}
             show(friendlyError(res.status, text));
             if (intent === 'sign-up' && errorCode === 'EMAIL_ALREADY_REGISTERED') {
               setEmailMode('login');
             }
             if (intent === 'sign-up' && errorCode === 'EMAIL_SIGNUP_PENDING_VERIFICATION') {
               pendingSignupEmail = String(body.email || '');
               pendingSignupPassword = String(body.password || '');
               setSignupVerificationVisible(true, pendingSignupEmail);
             }
             if (intent === 'sign-in' && signupVerificationRequired && /EMAIL_NOT_VERIFIED|验证邮箱/.test(text)) {
               pendingSignupEmail = String(body.email || '');
               pendingSignupPassword = String(body.password || '');
               setSignupVerificationVisible(true, pendingSignupEmail);
             }
             return;
           }
           if (intent === 'sign-up') {
             pendingSignupEmail = String(body.email || '');
             pendingSignupPassword = String(body.password || '');
             if (signupVerificationRequired) {
               setSignupVerificationVisible(true, pendingSignupEmail);
               setBusy('');
               return;
             }
             setBusy('注册成功，正在登录…');
             const loginRes = await fetch('/api/auth/sign-in/email', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               credentials: 'include',
               body: JSON.stringify({ email: pendingSignupEmail, password: pendingSignupPassword }),
             });
             setBusy('');
             if (!loginRes.ok) {
               show(friendlyError(loginRes.status, await loginRes.text()));
               return;
             }
           }
           window.location.href = postLogin.startsWith('http')
             ? postLogin
             : (postLogin.startsWith('/') ? postLogin : '/');
         });

         document.getElementById('mode-login').addEventListener('click', () => {
           if (!isAdminReturn) setEmailMode('login');
         });

         document.getElementById('mode-signup').addEventListener('click', () => {
           if (!signupVerificationAvailable || isAdminReturn) return;
           setEmailMode('signup');
         });

         document.getElementById('verify-signup-btn').addEventListener('click', async () => {
           clearMsg();
           const otp = document.getElementById('signup-otp').value.trim();
           const email = pendingSignupEmail || document.querySelector('#email-form input[name="email"]').value.trim();
           if (!email || !otp) { show('请填写邮箱和验证码。'); return; }
           setBusy('验证中…');
           const res = await fetch('/api/auth/email-otp/verify-email', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify({ email, otp }),
           });
           setBusy('');
           if (!res.ok) {
             show(friendlyError(res.status, await res.text()));
             return;
           }
           window.location.href = postLogin.startsWith('http')
             ? postLogin
             : (postLogin.startsWith('/') ? postLogin : '/');
         });

         document.getElementById('resend-signup-otp-btn').addEventListener('click', async () => {
            clearMsg();
            const email = pendingSignupEmail || document.querySelector('#email-form input[name="email"]').value.trim();
            if (!email) { show('请先填写邮箱。'); return; }
           setBusy('正在重新发送验证码…');
           const res = await fetch('/api/auth/email-otp/send-verification-otp', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             credentials: 'include',
             body: JSON.stringify({ email, type: 'email-verification' }),
           });
           setBusy('');
           if (!res.ok) {
             show(friendlyError(res.status, await res.text()));
             return;
           }
           setSignupVerificationVisible(true, email);
         });

         setEmailMode('login');
         loadMeta().catch((e) => show(String(e)));
       </script>`,
    ),
  );
});

pagesRoute.get("/consent", (c) => {
  const clientId = c.req.query("client_id") || "";
  const scope = c.req.query("scope") || "";
  const rawSearch = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?") + 1) : "";
  return c.html(
    layout(
      "授权同意",
      `<h1>授权应用访问</h1>
       <div class="card">
         <p>以下应用请求读取你的基本身份信息（如用户标识、昵称、邮箱，具体以权限范围为准）。</p>
         <p class="muted">应用标识：<code>${escapeHtml(clientId)}</code></p>
         <p class="muted">权限范围：<code>${escapeHtml(scope || "（默认）")}</code></p>
         <button type="button" id="accept" class="btn">同意并继续</button>
         <button type="button" id="deny" class="btn secondary">拒绝</button>
         <p id="msg" class="error" hidden></p>
       </div>
       <script>
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
             const detail = (data && (data.message || data.error)) ? String(data.message || data.error) : '';
             msg.textContent = detail
               ? ('授权处理失败：' + detail + '（' + res.status + '）')
               : ('授权处理失败（' + res.status + '）。请返回应用重新发起登录，或稍后再试。');
             return;
           }
           msg.hidden = false;
           msg.textContent = '未收到返回地址。请关闭本页，从业务应用重新发起登录。';
         }
         document.getElementById('accept').onclick = () => consent(true);
         document.getElementById('deny').onclick = () => consent(false);
       </script>`,
    ),
  );
});

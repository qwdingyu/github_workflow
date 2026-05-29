/**
 * cf-tools — 只读冒烟测试
 *
 * 验证部署后的基本功能：
 * 1. /api/health 返回 ok
 * 2. /api/tools 返回工具列表
 * 3. 404 处理正常
 * 4. 静态资源（index.html）可访问
 *
 * 用法：
 *   BASE_URL=https://your-domain.com node scripts/smoke-readonly.mjs
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:8787";

let failed = 0;

async function smoke(name, url, check) {
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    const passed = check(res, body);
    console.log(`${passed ? "  [PASS]" : "  [FAIL]"} ${name} — ${res.status}`);
    if (!passed) {
      console.error(`         Body: ${JSON.stringify(body).slice(0, 200)}`);
      failed++;
    }
  } catch (err) {
    console.error(`  [FAIL] ${name} — ${err.message}`);
    failed++;
  }
}

console.log(`\n  cf-tools 冒烟测试: ${BASE_URL}\n`);

// 1. 健康检查
await smoke("GET /api/health", `${BASE_URL}/api/health`, (res, body) => {
  return res.ok && body.ok === true;
});

// 2. 工具列表（公开接口）
await smoke("GET /api/tools", `${BASE_URL}/api/tools`, (res, body) => {
  return res.ok && body.ok === true && Array.isArray(body.tools);
});

// 3. 404 处理
await smoke("GET /api/nonexistent → 404", `${BASE_URL}/api/nonexistent`, (res) => {
  return res.status === 404;
});

// 4. 静态资源（首页）
await smoke("GET / (index.html)", `${BASE_URL}/`, (res) => {
  return res.ok && res.headers.get("content-type")?.includes("text/html");
});

// 5. 认证接口可达（不登录，应返回 401）
await smoke("GET /api/auth/me → 401", `${BASE_URL}/api/auth/me`, (res) => {
  return res.status === 401;
});

console.log(`\n  ${failed > 0 ? `[${failed} FAILED]` : "[ALL PASSED]"} 冒烟测试\n`);

if (failed > 0) process.exitCode = 1;

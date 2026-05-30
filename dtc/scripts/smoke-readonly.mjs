/**
 * 只读冒烟测试 — DTC 查询服务
 *
 * 验证部署后的基本功能：
 * 1. /api/health 返回 ok + 数据库连通性
 * 2. 单码查询端点的响应结构正确
 * 3. 搜索端点工作正常
 * 4. 统计端点返回合理数据
 * 5. 404/错误处理行为正确
 *
 * 用法：
 *   BASE_URL=https://dtc.eforge.xyz node scripts/smoke-readonly.mjs
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:8787";

let passed = 0;
let failed = 0;

async function smoke(name, url, check) {
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    const ok = check(res, body);
    if (ok) {
      console.log(`  ✅ ${name} — ${res.status}`);
      passed++;
    } else {
      console.log(`  ❌ ${name} — ${res.status}`);
      console.error(`     Expected check failed. Body:`, JSON.stringify(body).slice(0, 300));
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ ${name} — Network Error`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log(`\n🔍 DTC Smoke Test — ${BASE_URL}\n`);

// ── 1. 健康检查 ──
console.log("📡 Health Check");
await smoke("GET /api/health", `${BASE_URL}/api/health`, (res, body) => {
  return res.ok && body.ok === true && typeof body.dtcCount === "number";
});

// ── 2. DTC 单码查询 ──
console.log("\n🔧 DTC Lookup");

await smoke("GET /api/v1/dtc/P0420 (known code)", `${BASE_URL}/api/v1/dtc/P0420`, (res, body) => {
  return res.ok && body.ok === true && body.dtc?.code === "P0420" && body.dtc?.systemShort === "P";
});

await smoke("GET /api/v1/dtc/P0420?manufacturer=FORD", `${BASE_URL}/api/v1/dtc/P0420?manufacturer=FORD`, (res, body) => {
  return res.ok && body.ok === true;
});

await smoke("GET /api/v1/dtc/ZZZZZ (not found → 404)", `${BASE_URL}/api/v1/dtc/ZZZZZ`, (res, body) => {
  return res.status === 404 && body.ok === false;
});

// ── 3. 搜索 ──
console.log("\n🔍 Search");

await smoke("GET /api/v1/dtc/search?q=oxygen", `${BASE_URL}/api/v1/dtc/search?q=oxygen`, (res, body) => {
  return res.ok && body.ok === true && Array.isArray(body.results) && body.total >= 0;
});

await smoke("GET /api/v1/dtc/search?q=P0420", `${BASE_URL}/api/v1/dtc/search?q=P0420`, (res, body) => {
  return res.ok && body.ok === true && body.results.length > 0;
});

await smoke("GET /api/v1/dtc/search?q=x (too short → 400)", `${BASE_URL}/api/v1/dtc/search?q=x`, (res, body) => {
  return res.status === 400 && body.ok === false;
});

// ── 4. 统计 ──
console.log("\n📊 Stats");

await smoke("GET /api/v1/dtc/stats", `${BASE_URL}/api/v1/dtc/stats`, (res, body) => {
  return res.ok && body.ok === true
    && typeof body.stats?.totalCodes === "number" && body.stats.totalCodes > 0
    && typeof body.stats?.manufacturers === "number" && body.stats.manufacturers > 0
    && typeof body.stats?.bySystem === "object";
});

// ── 5. 制造商列表 ──
console.log("\n🏭 Manufacturers");

await smoke("GET /api/v1/manufacturers", `${BASE_URL}/api/v1/manufacturers`, (res, body) => {
  return res.ok && body.ok === true && Array.isArray(body.manufacturers) && body.total > 0;
});

// ── 6. 归一化 ──
console.log("\n🔤 Normalize");

await smoke("GET /api/v1/dtc/normalize/P0420", `${BASE_URL}/api/v1/dtc/normalize/P0420`, (res, body) => {
  return res.ok && body.ok === true && body.normalized?.isValid === true && body.normalized?.systemShort === "P";
});

await smoke("GET /api/v1/dtc/normalize/ZZZZZ (invalid)", `${BASE_URL}/api/v1/dtc/normalize/ZZZZZ`, (res, body) => {
  return res.ok && body.ok === true && body.normalized?.isValid === false;
});

// ── 结果 ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log(`✅ 全部通过\n`);
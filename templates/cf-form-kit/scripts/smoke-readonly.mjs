import http from "node:http";
import https from "node:https";

/*
 * CF Form Kit 只读 smoke。
 *
 * 用途：
 * - 验证 /api/health。
 * - 验证默认表单配置可读取。
 * - 不写数据库，不产生 submission。
 *
 * 可选环境变量：
 * - BASE_URL：目标地址，默认 http://127.0.0.1:8787。
 * - FORM_SLUG：表单 slug，默认 lead。
 *
 * 常用命令：
 * - BASE_URL="https://example.eforge.xyz" rtk npm run smoke:readonly
 */

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
const formSlug = process.env.FORM_SLUG || "lead";

async function request(path) {
  const url = new URL(path, baseUrl);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        const data = JSON.parse(raw);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${path} failed: HTTP ${res.statusCode} ${raw}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const health = await request("/api/health");
if (!health.ok || health.storage !== "d1") {
  throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
}

const form = await request(`/api/forms/${formSlug}`);
if (!form.ok || !form.form?.fields?.length) {
  throw new Error(`Unexpected form response: ${JSON.stringify(form)}`);
}

console.log(`CF Form Kit readonly smoke passed: ${baseUrl} form=${formSlug}`);

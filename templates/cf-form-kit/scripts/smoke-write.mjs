import http from "node:http";
import https from "node:https";

/*
 * CF Form Kit 写入 smoke。
 *
 * 用途：
 * - POST 一条演示 submission，验证 D1 写链路。
 *
 * 可选环境变量：
 * - BASE_URL：目标地址，默认 http://127.0.0.1:8787。
 * - FORM_SLUG：表单 slug，默认 lead。
 *
 * 风险提示：
 * - 本脚本会真实写入一条 submission。
 * - 生产巡检优先 smoke:readonly。
 */

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8787";
const formSlug = process.env.FORM_SLUG || "lead";

async function post(path, body) {
  const url = new URL(path, baseUrl);
  const payload = JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          "idempotency-key": `smoke:${Date.now()}`
        }
      },
      (res) => {
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
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const result = await post(`/api/forms/${formSlug}/submissions`, {
  contact: `smoke-${Date.now()}@example.test`,
  source: "smoke",
  fields: {
    name: "Smoke Test",
    contact: `smoke-${Date.now()}@example.test`,
    interest: "工具咨询",
    note: "自动化写入 smoke"
  }
});

if (!result.ok || !result.submission?.id) {
  throw new Error(`Unexpected submission response: ${JSON.stringify(result)}`);
}

console.log(`CF Form Kit write smoke passed: ${result.submission.id}`);

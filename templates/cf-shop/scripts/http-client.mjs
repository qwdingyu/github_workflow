import https from "node:https";
import http from "node:http";

export const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8790";
export const resolveIp = process.env.RESOLVE_IP;

export async function request(path, options = {}) {
  const response = await textRequest(path, options);
  let data;
  try {
    data = response.raw ? JSON.parse(response.raw) : {};
  } catch {
    throw new Error(`${path} returned non-json: ${response.raw.slice(0, 200)}`);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${path} failed: HTTP ${response.statusCode} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function textRequest(path, options = {}) {
  const url = new URL(path, baseUrl);
  const payload = options.body;
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: resolveIp || url.hostname,
        servername: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method || "GET",
        headers: {
          host: url.host,
          "content-type": "application/json",
          ...(options.headers || {}),
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({
            raw,
            statusCode: res.statusCode || 0,
            headers: res.headers,
            url: url.toString()
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

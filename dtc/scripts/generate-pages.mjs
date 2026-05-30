/**
 * DTC SEO 静态页面生成器
 *
 * 从 Turso 数据库读取 DTC 数据，为每个 DTC 码生成一个 SEO 优化 HTML 页面。
 * 生成内容：
 *   - dtc/{code}.html     — 每个 DTC 码的详情页面
 *   - index.html           — 首页（搜索入口 + 系统分类 + 热门码）
 *   - manufacturers/       — 按制造商浏览页面
 *   - sitemap.xml          — 站点地图（18,000+ URL）
 *   - robots.txt           — 爬虫规则
 *
 * 用法：
 *   TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx node scripts/generate-pages.mjs
 */

import { createClient } from "@libsql/client";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

// ── 配置 ──

const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;
const SITE_URL = process.env.SITE_URL || "https://dtc.eforge.xyz";
const OUTPUT_DIR = join(process.cwd(), "public");

// 系统类型映射
const SYSTEM_INFO: Record<string, { name: string; description: string; color: string }> = {
  P: { name: "Powertrain", description: "发动机、变速箱、传动系统相关故障码", color: "#e74c3c" },
  B: { name: "Body", description: "车身电子、安全气囊、空调系统相关故障码", color: "#3498db" },
  C: { name: "Chassis", description: "底盘、制动、悬挂系统相关故障码", color: "#2ecc71" },
  U: { name: "Network", description: "通信网络、控制器局域网相关故障码", color: "#f39c12" },
};

// HTML 模板 — 首页
function generateIndexHtml(stats: { total: number; bySystem: Record<string, number>; manufacturers: number; topCodes: any[] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DTC Lookup — Free OBD-II Diagnostic Trouble Code Search</title>
  <meta name="description" content="Free OBD-II Diagnostic Trouble Code (DTC) lookup service. Search ${stats.total.toLocaleString()}+ DTC codes by code, manufacturer, or keyword. Get detailed fault descriptions, causes, and repair solutions.">
  <meta name="keywords" content="DTC, OBD-II, diagnostic trouble code, fault code, check engine light, car diagnostic">
  <link rel="canonical" href="${SITE_URL}/">
  <meta property="og:title" content="DTC Lookup — Free OBD-II Diagnostic Trouble Code Search">
  <meta property="og:description" content="Search ${stats.total.toLocaleString()}+ DTC codes. Free OBD-II diagnostic trouble code lookup service.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}/">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "DTC Lookup",
    "applicationCategory": "DiagnosticTool",
    "operatingSystem": "All",
    "browserRequirements": "Requires JavaScript",
    "description": "Free OBD-II Diagnostic Trouble Code (DTC) lookup service",
    "url": "${SITE_URL}"
  }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 2rem; text-align: center; margin-bottom: 0.5rem; background: linear-gradient(135deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { text-align: center; color: #94a3b8; margin-bottom: 2rem; font-size: 0.95rem; }
    .search-box { display: flex; gap: 0.5rem; max-width: 500px; margin: 0 auto 2rem; }
    .search-box input { flex: 1; padding: 0.75rem 1rem; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #e2e8f0; font-size: 1rem; outline: none; }
    .search-box input:focus { border-color: #60a5fa; }
    .search-box button { padding: 0.75rem 1.5rem; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; }
    .stats { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2rem; }
    .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.5rem; text-align: center; min-width: 120px; }
    .stat-card .num { font-size: 1.8rem; font-weight: bold; color: #60a5fa; }
    .stat-card .label { font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem; }
    .system-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .system-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem; text-decoration: none; color: #e2e8f0; }
    .system-card .icon { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .system-card .name { font-weight: 600; font-size: 1rem; }
    .system-card .desc { font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem; }
    .system-card .count { font-size: 0.8rem; color: #60a5fa; margin-top: 0.5rem; }
    h2 { font-size: 1.3rem; margin-bottom: 1rem; color: #f1f5f9; }
    .code-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
    .code-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.75rem 1rem; text-decoration: none; color: #e2e8f0; }
    .code-card .code { font-weight: 600; color: #60a5fa; }
    .code-card .desc { font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1e293b; }
    .footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔧 DTC Lookup</h1>
    <p class="subtitle">Free OBD-II Diagnostic Trouble Code Search — ${stats.total.toLocaleString()} codes from ${stats.manufacturers} manufacturers</p>

    <form class="search-box" action="/search" method="get" onsubmit="event.preventDefault(); window.location.href='/dtc/' + this.q.value.toUpperCase() + '.html';">
      <input type="text" name="q" placeholder="Enter DTC code (e.g. P0420)" autocomplete="off">
      <button type="submit">Search</button>
    </form>

    <div class="stats">
      <div class="stat-card"><div class="num">${stats.total.toLocaleString()}</div><div class="label">Total DTC Codes</div></div>
      <div class="stat-card"><div class="num">${stats.manufacturers}</div><div class="label">Manufacturers</div></div>
      <div class="stat-card"><div class="num">${Object.keys(stats.bySystem).length}</div><div class="label">Systems</div></div>
    </div>

    <h2>Browse by System</h2>
    <div class="system-grid">
${Object.entries(SYSTEM_INFO).map(([short, info]) => `
      <a href="/${short.toLowerCase()}.html" class="system-card" style="border-left: 3px solid ${info.color}">
        <div class="icon">${short === 'P' ? '⚙️' : short === 'B' ? '🚗' : short === 'C' ? '🛞' : '📡'}</div>
        <div class="name">${info.name} (${short})</div>
        <div class="desc">${info.description}</div>
        <div class="count">${stats.bySystem[short]?.toLocaleString() || 0} codes</div>
      </a>`).join('\n')}
    </div>

    <h2>Popular DTC Codes</h2>
    <div class="code-grid">
${stats.topCodes.map((c: any) => `
      <a href="/dtc/${c.code}.html" class="code-card">
        <div class="code">${c.code}</div>
        <div class="desc">${escapeHtml(c.description)}</div>
      </a>`).join('\n')}
    </div>

    <div class="footer">
      <p>DTC Lookup — Free OBD-II Diagnostic Trouble Code Service</p>
      <p>Data sources: <a href="https://github.com/Wal33D/dtc-database">wal33d/dtc-database</a>, <a href="https://github.com/wzr1337/dtcmapping">wzr1337/dtcmapping</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── HTML 模板 — 单码详情页（SEO 核心页面） ──

function generateDtcPageHtml(code: string, record: any, related: any[]) {
  const systemInfo = SYSTEM_INFO[record.system_short] || { name: "Unknown", color: "#666" };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${code} — ${escapeHtml(record.description)}</title>
  <meta name="description" content="${code} diagnostic trouble code: ${escapeHtml(record.description)}. Manufacturer: ${record.manufacturer}. System: ${record.system}. Find causes, symptoms, and repair solutions.">
  <meta name="keywords" content="${code}, DTC ${code}, ${escapeHtml(record.description)}, OBD-II fault code, ${record.manufacturer} diagnostic">
  <link rel="canonical" href="${SITE_URL}/dtc/${code}.html">
  <meta property="og:title" content="${code} — ${escapeHtml(record.description)}">
  <meta property="og:description" content="DTC ${code}: ${escapeHtml(record.description)}. System: ${record.system}. Manufacturer: ${record.manufacturer}.">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${SITE_URL}/dtc/${code}.html">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": "${code} — ${escapeJson(record.description)}",
    "description": "${escapeJson(record.description)} — OBD-II Diagnostic Trouble Code",
    "about": {
      "@type": "Thing",
      "name": "${code}",
      "description": "${escapeJson(record.description)}"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": "${SITE_URL}/dtc/${code}.html"
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What is DTC code ${code}?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "${escapeJson(record.description)}. This is an OBD-II diagnostic trouble code in the ${record.system} (${record.system_short}) category${record.manufacturer !== 'GENERIC' ? ', specific to ' + record.manufacturer + ' vehicles' : ', applicable to all OBD-II vehicles'}."
        }
      },
      {
        "@type": "Question",
        "name": "What does ${code} mean?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "${escapeJson(record.description)}. This code${record.manufacturer !== 'GENERIC' ? ' is a manufacturer-specific code for ' + record.manufacturer : ' is a generic OBD-II code'}."
        }
      }
    ]
  }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
    .back { margin-bottom: 1rem; }
    .back a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .header { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid ${systemInfo.color}; }
    .code-badge { display: inline-block; font-size: 2.5rem; font-weight: 800; color: #60a5fa; font-family: 'Courier New', monospace; }
    .code-description { font-size: 1.1rem; margin-top: 0.5rem; color: #f1f5f9; }
    .meta { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
    .tag { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; background: #334155; color: #94a3b8; }
    .tag.manufacturer { background: ${record.is_generic ? '#1e3a5f' : '#3b1f4e'}; color: ${record.is_generic ? '#60a5fa' : '#c084fc'}; }
    .tag.system { background: #1e3a5f; color: #60a5fa; }
    h2 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; color: #f1f5f9; }
    .info-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .info-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #1e293b; }
    .info-row:last-child { border-bottom: none; }
    .info-row .label { color: #94a3b8; font-size: 0.9rem; }
    .info-row .value { color: #e2e8f0; font-size: 0.9rem; text-align: right; }
    .related-list { list-style: none; }
    .related-list li { margin-bottom: 0.5rem; }
    .related-list a { color: #60a5fa; text-decoration: none; }
    .related-list a:hover { text-decoration: underline; }
    .footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="back"><a href="/">← Back to DTC Lookup</a></div>

    <div class="header">
      <div class="code-badge">${code}</div>
      <div class="code-description">${escapeHtml(record.description)}</div>
      <div class="meta">
        <span class="tag manufacturer">${record.manufacturer}</span>
        <span class="tag system">${record.system} (${record.system_short})</span>
        <span class="tag">${record.is_generic ? 'Generic OBD-II' : 'Manufacturer Specific'}</span>
        <span class="tag">Severity: ${record.severity}</span>
      </div>
    </div>

    <h2>${code} Details</h2>
    <div class="info-card">
      <div class="info-row"><span class="label">DTC Code</span><span class="value">${code}</span></div>
      <div class="info-row"><span class="label">System</span><span class="value">${record.system} (${record.system_short})</span></div>
      <div class="info-row"><span class="label">Description</span><span class="value">${escapeHtml(record.description)}</span></div>
      <div class="info-row"><span class="label">Manufacturer</span><span class="value">${record.manufacturer}</span></div>
      <div class="info-row"><span class="label">Type</span><span class="value">${record.is_generic ? 'Generic (SAE)' : 'Manufacturer Specific'}</span></div>
      <div class="info-row"><span class="label">Severity</span><span class="value">${record.severity}</span></div>
${record.cause ? `<div class="info-row"><span class="label">Common Causes</span><span class="value">${escapeHtml(record.cause)}</span></div>` : ''}
${record.remedy ? `<div class="info-row"><span class="label">Repair Solutions</span><span class="value">${escapeHtml(record.remedy)}</span></div>` : ''}
    </div>

${related.length > 0 ? `
    <h2>Related DTC Codes</h2>
    <div class="info-card">
      <ul class="related-list">
${related.map((r: any) => `
        <li><a href="/dtc/${r.code}.html">${r.code}</a> — ${escapeHtml(r.description)}</li>`).join('\n')}
      </ul>
    </div>` : ''}

    <h2>About DTC Code ${code}</h2>
    <div class="info-card">
      <p>${code} is an OBD-II Diagnostic Trouble Code (DTC) in the ${record.system} category${record.is_generic ? '.' : ', specific to ' + record.manufacturer + ' vehicles.'}</p>
      <p style="margin-top:0.5rem">This code indicates: ${escapeHtml(record.description)}.</p>
      <p style="margin-top:0.5rem">If you see this code on your OBD-II scanner, we recommend consulting a qualified mechanic for proper diagnosis and repair.</p>
    </div>

    <div class="footer">
      <p>DTC Lookup — Free OBD-II Diagnostic Trouble Code Service</p>
      <p><a href="/">Search another DTC code</a> | <a href="/sitemap.xml">Sitemap</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── HTML 模板 — 按系统页面 ──

function generateSystemPageHtml(systemShort: string, codes: any[]) {
  const info = SYSTEM_INFO[systemShort] || { name: "Unknown", description: "", color: "#666" };
  const icon = systemShort === 'P' ? '⚙️' : systemShort === 'B' ? '🚗' : systemShort === 'C' ? '🛞' : '📡';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${info.name} (${systemShort}) DTC Codes — OBD-II Diagnostic Trouble Codes</title>
  <meta name="description" content="Complete list of ${info.name} (${systemShort}) OBD-II diagnostic trouble codes. Browse ${codes.length.toLocaleString()} fault codes related to ${info.description.toLowerCase()}.">
  <link rel="canonical" href="${SITE_URL}/${systemShort.toLowerCase()}.html">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    .subtitle { color: #94a3b8; margin-bottom: 1.5rem; }
    .back { margin-bottom: 1rem; }
    .back a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .code-table { width: 100%; border-collapse: collapse; }
    .code-table tr { border-bottom: 1px solid #1e293b; }
    .code-table td { padding: 0.6rem 0.5rem; font-size: 0.9rem; }
    .code-table .code { color: #60a5fa; font-weight: 600; text-decoration: none; font-family: 'Courier New', monospace; }
    .code-table .code:hover { text-decoration: underline; }
    .code-table .mfr { color: #94a3b8; font-size: 0.8rem; }
    .code-table .desc { color: #cbd5e1; }
    .footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="back"><a href="/">← Back to Home</a></div>
    <h1>${icon} ${info.name} (${systemShort}) DTC Codes</h1>
    <p class="subtitle">${codes.length.toLocaleString()} diagnostic trouble codes — ${info.description}</p>
    <table class="code-table">
${codes.map((c: any) => `
      <tr>
        <td><a class="code" href="/dtc/${c.code}.html">${c.code}</a></td>
        <td class="mfr">${c.manufacturer}</td>
        <td class="desc">${escapeHtml(c.description)}</td>
      </tr>`).join('\n')}
    </table>
    <div class="footer">
      <p><a href="/sitemap.xml">Sitemap</a> | <a href="/">DTC Lookup — Free OBD-II Service</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── 辅助函数 ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJson(text) {
  return text.replace(/"/g, "\\\"").replace(/\n/g, " ").replace(/\r/g, "");
}

// ── HTML 模板 — 制造商详情页 ──

function generateManufacturerPageHtml(mfr, codes) {
  const count = codes.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(mfr.displayName)} DTC Codes — OBD-II Diagnostic Trouble Codes</title>
  <meta name="description" content="Complete list of ${escapeHtml(mfr.displayName)} (${mfr.id}) OBD-II diagnostic trouble codes. Browse ${count.toLocaleString()} fault codes specific to ${escapeHtml(mfr.displayName)} vehicles.">
  <link rel="canonical" href="${SITE_URL}/manufacturers/${mfr.id}.html">
  <meta property="og:title" content="${escapeHtml(mfr.displayName)} DTC Codes">
  <meta property="og:description" content="${count.toLocaleString()} diagnostic trouble codes for ${escapeHtml(mfr.displayName)}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "${escapeHtml(mfr.displayName)} DTC Codes",
    "description": "${count.toLocaleString()} OBD-II diagnostic trouble codes for ${escapeHtml(mfr.displayName)}"
  }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    .subtitle { color: #94a3b8; margin-bottom: 1.5rem; }
    .back { margin-bottom: 1rem; }
    .back a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .code-table { width: 100%; border-collapse: collapse; }
    .code-table tr { border-bottom: 1px solid #1e293b; }
    .code-table td { padding: 0.6rem 0.5rem; font-size: 0.9rem; }
    .code-table .code { color: #60a5fa; font-weight: 600; text-decoration: none; font-family: 'Courier New', monospace; }
    .code-table .code:hover { text-decoration: underline; }
    .code-table .sys { color: #94a3b8; font-size: 0.8rem; }
    .code-table .desc { color: #cbd5e1; }
    .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.75rem 1.25rem; }
    .stat-card .num { font-size: 1.4rem; font-weight: bold; color: #60a5fa; }
    .stat-card .label { font-size: 0.78rem; color: #94a3b8; }
    .footer { text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #1e293b; }
    .footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="back"><a href="/">← Back to Home</a></div>
    <h1>🏭 ${escapeHtml(mfr.displayName)} DTC Codes</h1>
    <p class="subtitle">${mfr.fullName ? escapeHtml(mfr.fullName) + ' — ' : ''}${count.toLocaleString()} diagnostic trouble codes</p>
    <div class="stats">
      <div class="stat-card"><div class="num">${count.toLocaleString()}</div><div class="label">Total Codes</div></div>
      <div class="stat-card"><div class="num">${mfr.country || '—'}</div><div class="label">Country</div></div>
    </div>
    <table class="code-table">
${codes.map((c) => `
      <tr>
        <td><a class="code" href="/dtc/${c.code}.html">${c.code}</a></td>
        <td class="sys">${c.system_short}</td>
        <td class="desc">${escapeHtml(c.description)}</td>
      </tr>`).join('\n')}
    </table>
    <div class="footer">
      <p><a href="/sitemap.xml">Sitemap</a> | <a href="/">DTC Lookup — Free OBD-II Service</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── 主函数 ──

async function main() {
  console.log("\n📄 DTC SEO 页面生成器\n");

  if (!TURSO_URL) {
    console.error("❌ TURSO_URL 环境变量未设置");
    process.exit(1);
  }

  console.log(`📡 数据库: ${TURSO_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`📂 输出目录: ${OUTPUT_DIR}`);

  // 连接数据库
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });

  // 确保输出目录存在
  const dtcDir = join(OUTPUT_DIR, "dtc");
  const mfrDir = join(OUTPUT_DIR, "manufacturers");
  const cssDir = join(OUTPUT_DIR, "css");
  mkdirSync(dtcDir, { recursive: true });
  mkdirSync(mfrDir, { recursive: true });
  mkdirSync(cssDir, { recursive: true });

  // 查询所有 DTC 数据
  console.log("\n📖 查询 DTC 数据...");

  // 统计信息
  const stats: any = {};
  const totalResult = await client.execute("SELECT COUNT(*) as count FROM dtc_codes");
  stats.total = Number(totalResult.rows[0]?.count || 0);

  const mfrResult = await client.execute("SELECT COUNT(*) as count FROM manufacturers");
  stats.manufacturers = Number(mfrResult.rows[0]?.count || 0);

  const bySystemResult = await client.execute("SELECT system_short, COUNT(*) as count FROM dtc_codes GROUP BY system_short");
  stats.bySystem = {};
  for (const r of bySystemResult.rows) {
    stats.bySystem[String(r.system_short)] = Number(r.count);
  }

  // 热门码（选择前 30 条最常被搜索的 DTC）
  const topCodesResult = await client.execute(
    "SELECT code, description FROM dtc_codes WHERE manufacturer = 'GENERIC' ORDER BY code ASC LIMIT 30"
  );
  stats.topCodes = topCodesResult.rows.map((r: any) => ({ code: String(r.code), description: String(r.description || "") }));

  // 生成首页
  console.log("  📄 生成首页...");
  writeFileSync(join(OUTPUT_DIR, "index.html"), generateIndexHtml(stats));

  // 生成 sitemap.xml
  console.log("  🗺️ 生成站点地图...");
  const sitemapUrls: string[] = [];
  sitemapUrls.push(SITE_URL + "/");

  // 系统页面
  for (const short of ["P", "B", "C", "U"]) {
    if (stats.bySystem[short]) {
      sitemapUrls.push(`${SITE_URL}/${short.toLowerCase()}.html`);
    }
  }

  // 生成每个 DTC 码的页面
  console.log(`  📄 生成 ${stats.total} 个 DTC 详情页...`);

  // 分页查询，避免一次加载 18,000 条到内存
  const PAGE_SIZE = 500;
  let offset = 0;
  let totalGenerated = 0;

  while (true) {
    const rows = await client.execute({
      sql: "SELECT code, system, system_short, description, description_zh, manufacturer, is_generic, cause, remedy, severity, related_codes FROM dtc_codes ORDER BY code ASC LIMIT ? OFFSET ?",
      args: [PAGE_SIZE, offset],
    });

    if (rows.rows.length === 0) break;

    for (const row of rows.rows) {
      const code = String(row.code);
      const record = {
        code,
        system: String(row.system || ""),
        system_short: String(row.system_short || ""),
        description: String(row.description || ""),
        description_zh: String(row.description_zh || ""),
        manufacturer: String(row.manufacturer || "GENERIC"),
        is_generic: Number(row.is_generic || 1),
        cause: String(row.cause || ""),
        remedy: String(row.remedy || ""),
        severity: String(row.severity || "medium"),
        related_codes: String(row.related_codes || "[]"),
      };

      const html = generateDtcPageHtml(code, record, []);
      writeFileSync(join(dtcDir, `${code}.html`), html);
      sitemapUrls.push(`${SITE_URL}/dtc/${code}.html`);
      totalGenerated++;
    }

    offset += PAGE_SIZE;
    process.stdout.write(`    📊 已生成: ${totalGenerated}/${stats.total}\r`);
  }

  // 生成系统分类页面
  for (const short of ["P", "B", "C", "U"]) {
    const sysRows = await client.execute({
      sql: "SELECT code, manufacturer, description FROM dtc_codes WHERE system_short = ? ORDER BY code ASC",
      args: [short],
    });

    const codes = sysRows.rows.map((r) => ({
      code: String(r.code),
      manufacturer: String(r.manufacturer || ""),
      description: String(r.description || ""),
    }));

    const sysHtml = generateSystemPageHtml(short, codes);
    writeFileSync(join(OUTPUT_DIR, `${short.toLowerCase()}.html`), sysHtml);
    console.log(`\n  📄 生成 ${short}.html (${codes.length} codes)`);
  }

  // 生成制造商页面
  console.log("\n  🏭 生成制造商页面...");
  const mfrRows = await client.execute("SELECT id, display_name, full_name, country, code_count FROM manufacturers ORDER BY code_count DESC");
  for (const row of mfrRows.rows) {
    const mfrId = String(row.id);
    const mfr = {
      id: mfrId,
      displayName: String(row.display_name || mfrId),
      fullName: String(row.full_name || ""),
      country: String(row.country || ""),
      codeCount: Number(row.code_count || 0),
    };

    // 查询该制造商的前 200 条码（太多会导致页面过大）
    const codeRows = await client.execute({
      sql: "SELECT code, system_short, description FROM dtc_codes WHERE manufacturer = ? ORDER BY code ASC LIMIT 200",
      args: [mfrId],
    });

    const codes = codeRows.rows.map((r) => ({
      code: String(r.code),
      system_short: String(r.system_short || ""),
      description: String(r.description || ""),
    }));

    const mfrHtml = generateManufacturerPageHtml(mfr, codes);
    writeFileSync(join(mfrDir, `${mfrId}.html`), mfrHtml);
    sitemapUrls.push(`${SITE_URL}/manufacturers/${mfrId}.html`);
  }
  console.log(`    📄 生成 ${mfrRows.rows.length} 个制造商页面`);

  // 生成 sitemap.xml
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>`;
  writeFileSync(join(OUTPUT_DIR, "sitemap.xml"), sitemap);

  // 生成 robots.txt
  const robots = `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml

# AI crawler permission
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Googlebot
Allow: /
`;
  writeFileSync(join(OUTPUT_DIR, "robots.txt"), robots);

  // 生成 _headers
  const headers = `/* 
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin

/dtc/*
  Cache-Control: public, max-age=7200, stale-while-revalidate=86400

/manufacturers/*
  Cache-Control: public, max-age=7200, stale-while-revalidate=86400

/css/*
  Cache-Control: public, max-age=3600
`;
  writeFileSync(join(OUTPUT_DIR, "_headers"), headers);

  console.log(`\n\n✅ 生成完成！`);
  console.log(`   📝 首页: 1`);
  console.log(`   🔧 DTC 页面: ${totalGenerated}`);
  console.log(`   🗺️  Sitemap: ${sitemapUrls.length} URLs`);
  console.log(`   📂 输出目录: ${OUTPUT_DIR}`);

  client.close();
}

main().catch((err) => {
  console.error("\n❌ 生成失败:", err.message || err);
  process.exit(1);
});
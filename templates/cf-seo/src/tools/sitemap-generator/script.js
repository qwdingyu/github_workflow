// Sitemap XML Generator — Pure client-side
(function () {
  "use strict";

  window.generateSitemap = function () {
    var raw = document.getElementById("sm-urls").value.trim();
    if (!raw) {
      document.getElementById("sm-output").textContent = "Please enter at least one URL.";
      return;
    }

    var urls = raw.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s && /^https?:\/\//i.test(s); });
    if (urls.length === 0) {
      document.getElementById("sm-output").textContent = "No valid URLs found. Each URL must start with http:// or https://";
      return;
    }

    var changefreq = document.getElementById("sm-changefreq").value;
    var priority = parseFloat(document.getElementById("sm-priority").value) || 0.5;
    if (priority < 0) priority = 0;
    if (priority > 1) priority = 1;
    var lastmod = document.getElementById("sm-lastmod").value;

    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    urls.forEach(function (url) {
      lines.push("  <url>");
      lines.push("    <loc>" + escapeXml(url) + "</loc>");
      if (lastmod) lines.push("    <lastmod>" + lastmod + "T00:00:00+00:00</lastmod>");
      lines.push("    <changefreq>" + changefreq + "</changefreq>");
      lines.push("    <priority>" + priority.toFixed(1) + "</priority>");
      lines.push("  </url>");
    });

    lines.push("</urlset>");

    document.getElementById("sm-output").textContent = lines.join("\n");
  };

  window.copySitemap = function () {
    var code = document.getElementById("sm-output").textContent;
    if (!code || code.indexOf("<?xml") === -1) return;
    navigator.clipboard.writeText(code).then(function () {
      var btns = document.querySelectorAll('#sm-result .btn-secondary');
      var btn = btns[0];
      if (btn) { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy to Clipboard"; }, 2000); }
    });
  };

  window.downloadSitemap = function () {
    var code = document.getElementById("sm-output").textContent;
    if (!code || code.indexOf("<?xml") === -1) return;
    var blob = new Blob([code], { type: "application/xml" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sitemap.xml";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
})();

// Meta Tag Generator — Pure client-side
(function () {
  "use strict";

  // Character counters
  const titleInput = document.getElementById("mt-title");
  const descInput = document.getElementById("mt-description");
  const titleCount = document.getElementById("mt-title-count");
  const descCount = document.getElementById("mt-desc-count");

  function updateCounters() {
    if (titleCount) titleCount.textContent = (titleInput ? titleInput.value.length : 0);
    if (descCount) descCount.textContent = (descInput ? descInput.value.length : 0);
  }

  if (titleInput) titleInput.addEventListener("input", updateCounters);
  if (descInput) descInput.addEventListener("input", updateCounters);
  updateCounters();

  function v(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  window.generateMetaTags = function () {
    const lines = [];

    // Basic
    const title = v("mt-title");
    const desc = v("mt-description");
    if (title) lines.push('<title>' + escapeHtml(title) + '</title>');
    if (desc) lines.push('<meta name="description" content="' + escapeAttr(desc) + '">');
    const kw = v("mt-keywords");
    if (kw) lines.push('<meta name="keywords" content="' + escapeAttr(kw) + '">');
    lines.push('<meta name="robots" content="' + escapeAttr(v("mt-robots") || "index, follow") + '">');
    const canonical = v("mt-canonical");
    if (canonical) lines.push('<link rel="canonical" href="' + escapeAttr(canonical) + '">');
    const locale = v("mt-locale") || "en_US";
    lines.push('<meta charset="UTF-8">');
    lines.push('<html lang="' + escapeAttr(locale.replace("_", "-")) + '">');

    // Open Graph
    const ogTitle = v("mt-og-title") || title;
    const ogDesc = v("mt-og-desc") || desc;
    const ogImage = v("mt-og-image");
    const ogType = v("mt-og-type") || "website";
    const ogSite = v("mt-og-site");
    if (ogTitle || ogDesc || ogImage || ogSite) {
      lines.push("");
      lines.push("<!-- Open Graph -->");
      if (ogTitle) lines.push('<meta property="og:title" content="' + escapeAttr(ogTitle) + '">');
      if (ogDesc) lines.push('<meta property="og:description" content="' + escapeAttr(ogDesc) + '">');
      if (ogImage) lines.push('<meta property="og:image" content="' + escapeAttr(ogImage) + '">');
      lines.push('<meta property="og:type" content="' + escapeAttr(ogType) + '">');
      if (ogSite) lines.push('<meta property="og:site_name" content="' + escapeAttr(ogSite) + '">');
      if (canonical) lines.push('<meta property="og:url" content="' + escapeAttr(canonical) + '">');
    }

    // Twitter
    const twTitle = v("mt-tw-title") || title;
    const twDesc = v("mt-tw-desc") || desc;
    const twImage = v("mt-tw-image");
    const twCard = v("mt-tw-card") || "summary_large_image";
    const twSite = v("mt-tw-site");
    if (twTitle || twDesc || twImage || twSite) {
      lines.push("");
      lines.push("<!-- Twitter Card -->");
      lines.push('<meta name="twitter:card" content="' + escapeAttr(twCard) + '">');
      if (twTitle) lines.push('<meta name="twitter:title" content="' + escapeAttr(twTitle) + '">');
      if (twDesc) lines.push('<meta name="twitter:description" content="' + escapeAttr(twDesc) + '">');
      if (twImage) lines.push('<meta name="twitter:image" content="' + escapeAttr(twImage) + '">');
      if (twSite) lines.push('<meta name="twitter:site" content="' + escapeAttr(twSite) + '">');
    }

    document.getElementById("meta-output").textContent = lines.join("\n");
  };

  window.copyMetaTags = function () {
    const code = document.getElementById("meta-output").textContent;
    if (!code || code.startsWith("Fill")) return;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.querySelector('#meta-result .btn-secondary');
      if (btn) { btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = "Copy to Clipboard"), 2000); }
    });
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();

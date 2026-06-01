// SEO Scorecard — Pure client-side
(function () {
  "use strict";

  function parse(html) {
    var p = new DOMParser();
    return p.parseFromString(html, "text/html");
  }

  function q(doc, sel) { return doc.querySelector(sel); }
  function qa(doc, sel) { return doc.querySelectorAll(sel); }
  function attr(doc, tag, name) {
    var el = q(doc, tag);
    return el ? (el.getAttribute(name) || "").trim() : "";
  }

  function makeCheck(icon, msg) {
    return { icon: icon, msg: msg };
  }

  function scoreColor(pct) {
    if (pct >= 80) return "var(--success)";
    if (pct >= 50) return "var(--warning)";
    return "var(--error)";
  }

  window.runScorecard = function () {
    var raw = document.getElementById("ss-html").value;
    if (!raw.trim()) { alert("Please paste HTML source."); return; }

    var doc = parse(raw);
    var checks = [];
    var categories = {};

    // --- Title ---
    (function () {
      var t = attr(doc, "title", null);
      if (t) {
        if (t.length >= 10 && t.length <= 60) {
          checks.push(makeCheck("pass", "Title tag present and optimal length (" + t.length + " chars)"));
        } else if (t.length > 60) {
          checks.push(makeCheck("warn", "Title tag too long (" + t.length + " chars). Keep under 60."));
        } else {
          checks.push(makeCheck("warn", "Title tag too short (" + t.length + " chars). Aim for 30-60."));
        }
      } else {
        checks.push(makeCheck("fail", "Missing <title> tag."));
      }
      cat("Title", checks);
    })();

    // --- Meta Description ---
    (function () {
      var d = attr(doc, 'meta[name="description"]', "content");
      if (d) {
        if (d.length >= 50 && d.length <= 155) {
          checks.push(makeCheck("pass", "Meta description present and optimal length (" + d.length + " chars)"));
        } else if (d.length > 155) {
          checks.push(makeCheck("warn", "Meta description too long (" + d.length + " chars). Keep under 155."));
        } else {
          checks.push(makeCheck("warn", "Meta description too short (" + d.length + " chars). Aim for 120-155."));
        }
      } else {
        checks.push(makeCheck("fail", "Missing meta description tag."));
      }
      cat("Meta Description", checks);
    })();

    // --- Headings ---
    (function () {
      var h1s = qa(doc, "h1");
      if (h1s.length === 1) {
        checks.push(makeCheck("pass", "Exactly one H1 tag found."));
      } else if (h1s.length === 0) {
        checks.push(makeCheck("fail", "No H1 tag found."));
      } else {
        checks.push(makeCheck("warn", h1s.length + " H1 tags found. Use exactly one."));
      }
      var h2s = qa(doc, "h2");
      if (h2s.length >= 1) {
        checks.push(makeCheck("pass", h2s.length + " H2 tags found."));
      } else {
        checks.push(makeCheck("warn", "No H2 tags. Consider adding section headings."));
      }
      cat("Headings", checks);
    })();

    // --- Images ---
    (function () {
      var imgs = qa(doc, "img");
      if (imgs.length === 0) {
        checks.push(makeCheck("warn", "No images found on the page."));
      } else {
        var missing = imgs.length - qa(doc, "img[alt]").length;
        // Count imgs with non-empty alt
        var withAlt = 0;
        imgs.forEach(function (img) { if (img.getAttribute("alt") && img.getAttribute("alt").trim()) withAlt++; });
        if (withAlt === imgs.length) {
          checks.push(makeCheck("pass", "All " + imgs.length + " images have alt attributes."));
        } else if (withAlt > 0) {
          checks.push(makeCheck("warn", (imgs.length - withAlt) + " of " + imgs.length + " images missing alt text."));
        } else {
          checks.push(makeCheck("fail", "No images have alt attributes."));
        }
      }
      cat("Images", checks);
    })();

    // --- Links ---
    (function () {
      var links = qa(doc, "a[href]");
      if (links.length === 0) {
        checks.push(makeCheck("warn", "No links found. Internal linking helps SEO."));
      } else {
        checks.push(makeCheck("pass", links.length + " links found."));
        var broken = qa(doc, "a[href='#'], a[href=''], a[href='#top']");
        if (broken.length > 0) {
          checks.push(makeCheck("warn", broken.length + " placeholder/empty links found (#, empty)."));
        }
      }
      cat("Links", checks);
    })();

    // --- Technical ---
    (function () {
      var canonical = attr(doc, 'link[rel="canonical"]', "href");
      if (canonical) {
        checks.push(makeCheck("pass", "Canonical URL present."));
      } else {
        checks.push(makeCheck("warn", "No canonical link tag found."));
      }
      var lang = doc.documentElement.getAttribute("lang");
      if (lang) {
        checks.push(makeCheck("pass", "HTML lang attribute set to \"" + lang + "\"."));
      } else {
        checks.push(makeCheck("warn", "Missing html lang attribute."));
      }
      var charset = q(doc, 'meta[charset]') || q(doc, 'meta[http-equiv="Content-Type"]');
      if (charset) {
        checks.push(makeCheck("pass", "Character encoding declared."));
      } else {
        checks.push(makeCheck("warn", "No charset meta tag found."));
      }
      var vp = q(doc, 'meta[name="viewport"]');
      if (vp) {
        checks.push(makeCheck("pass", "Viewport meta tag present (mobile-friendly)."));
      } else {
        checks.push(makeCheck("fail", "Missing viewport meta tag. Page may not be mobile-friendly."));
      }
      cat("Technical", checks);
    })();

    // --- Structured Data ---
    (function () {
      var found = false;
      qa(doc, "script[type='application/ld+json']").forEach(function (s) { found = true; });
      if (found) {
        checks.push(makeCheck("pass", "JSON-LD structured data found."));
      } else {
        checks.push(makeCheck("warn", "No JSON-LD structured data found. Adding schema markup can enable rich results."));
      }
      var og = q(doc, 'meta[property="og:title"]');
      if (og) {
        checks.push(makeCheck("pass", "Open Graph tags present."));
      } else {
        checks.push(makeCheck("warn", "No Open Graph tags. Adding them improves social sharing."));
      }
      cat("Structured Data", checks);
    })();

    function cat(name, checks) {
      if (!categories[name]) categories[name] = [];
      categories[name] = checks;
    }

    // Render score
    var total = 0, passed = 0, warned = 0;
    var catScores = {};
    Object.keys(categories).forEach(function (name) {
      var cs = categories[name];
      var tp = 0, pw = 0;
      cs.forEach(function (c) {
        total++;
        if (c.icon === "pass") { passed++; pw = 1; }
        else if (c.icon === "warn") { warned++; pw = 0.5; }
        tp += pw;
      });
      catScores[name] = (tp / cs.length * 100);
    });

    var pct = Math.round(passed / total * 100);
    var color = scoreColor(pct);

    document.getElementById("ss-score-ring").innerHTML =
      '<div class="score-circle" style="color:' + color + ';border-color:' + color + '">' +
      pct + '<span class="label">/ 100</span></div>';

    // Categories
    var catHtml = "";
    Object.keys(catScores).forEach(function (name) {
      var s = Math.round(catScores[name]);
      var c = scoreColor(s);
      catHtml += '<div class="ss-cat"><div class="cat-name">' + escapeHtml(name) + '</div><div class="cat-score" style="color:' + c + '">' + s + '%</div><div class="cat-bar"><div class="cat-bar-fill" style="width:' + s + '%;background:' + c + '"></div></div></div>';
    });
    document.getElementById("ss-categories").innerHTML = catHtml;

    // Checks
    var allChecks = [];
    Object.keys(categories).forEach(function (name) {
      categories[name].forEach(function (c) { allChecks.push(c); });
    });
    var iconMap = { pass: "✅", fail: "❌", warn: "⚠️" };
    var checkHtml = "";
    allChecks.forEach(function (c) {
      checkHtml += '<div class="ss-check ' + c.icon + '"><span class="icon">' + iconMap[c.icon] + '</span><span>' + c.msg + '</span></div>';
    });
    document.getElementById("ss-checks").innerHTML = checkHtml;
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();

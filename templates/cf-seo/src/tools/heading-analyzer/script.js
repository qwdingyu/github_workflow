// Heading Structure Analyzer — Pure client-side
(function () {
  "use strict";

  function extractHeadings(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    var all = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
    var result = [];
    all.forEach(function (el) {
      result.push({
        level: parseInt(el.tagName.substring(1)),
        text: (el.textContent || "").trim().substring(0, 120)
      });
    });
    return result;
  }

  window.analyzeHeadings = function () {
    var raw = document.getElementById("ha-html").value;
    if (!raw.trim()) {
      alert("Please paste HTML content to analyze.");
      return;
    }

    var headings = extractHeadings(raw);
    var issues = [];
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    headings.forEach(function (h) { counts[h.level]++; });

    // Checks
    if (counts[1] === 0) issues.push({ type: "error", msg: "No H1 tag found. Every page should have exactly one H1." });
    if (counts[1] > 1) issues.push({ type: "warning", msg: "Multiple H1 tags found (" + counts[1] + "). Best practice: use exactly one H1 per page." });

    for (var i = 0; i < headings.length; i++) {
      if (i === 0 && headings[i].level !== 1) {
        issues.push({ type: "error", msg: "First heading is H" + headings[i].level + ", not H1. The document should start with H1." });
      }
      if (i > 0) {
        var prev = headings[i - 1].level;
        if (headings[i].level > prev + 1) {
          issues.push({ type: "warning", msg: "Skipped heading level: H" + prev + " → H" + headings[i].level + " (\"" + escapeHtml(headings[i].text.substring(0, 50)) + "\"). Skip directly to H" + (prev + 1) + "." });
        }
      }
    }

    if (headings.length === 0) {
      issues.push({ type: "error", msg: "No heading tags found in the provided HTML." });
    }

    if (issues.length === 0) {
      issues.push({ type: "ok", msg: "No heading structure issues detected. Good job!" });
    }

    // Summary
    document.getElementById("ha-summary").innerHTML =
      '<div class="ha-stat"><div class="label">Total Headings</div><div class="value">' + headings.length + '</div></div>' +
      '<div class="ha-stat"><div class="label">H1</div><div class="value">' + counts[1] + '</div></div>' +
      '<div class="ha-stat"><div class="label">H2</div><div class="value">' + counts[2] + '</div></div>' +
      '<div class="ha-stat"><div class="label">H3</div><div class="value">' + counts[3] + '</div></div>' +
      '<div class="ha-stat"><div class="label">H4-H6</div><div class="value">' + (counts[4] + counts[5] + counts[6]) + '</div></div>';

    // Tree view
    if (headings.length === 0) {
      document.getElementById("ha-tree").innerHTML = '<p class="form-hint">No headings found.</p>';
    } else {
      var treeHtml = "";
      headings.forEach(function (h, i) {
        var indent = (h.level - 1) * 24;
        var tagColor = h.level === 1 ? "var(--primary)" : h.level === 2 ? "#2563eb" : h.level === 3 ? "#7c3aed" : "var(--muted)";
        treeHtml += '<div class="heading-item" style="padding-left:' + indent + 'px">' +
          '<span style="color:' + tagColor + ';font-weight:700">H' + h.level + '</span> ' +
          '<span>' + escapeHtml(h.text || "<em>(empty)</em>") + '</span></div>';
      });
      document.getElementById("ha-tree").innerHTML = treeHtml;
    }

    // Issues
    var issuesHtml = "";
    issues.forEach(function (issue) {
      issuesHtml += '<div class="ha-issue ' + issue.type + '"><span class="tag">[' + issue.type.toUpperCase() + ']</span>' + issue.msg + '</div>';
    });
    document.getElementById("ha-issues").innerHTML = issuesHtml;
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();

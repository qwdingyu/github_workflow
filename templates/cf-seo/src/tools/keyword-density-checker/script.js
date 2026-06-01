// Keyword Density Checker — Pure client-side
(function () {
  "use strict";

  var STOP_WORDS = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","up","about","into","through","during",
    "before","after","above","below","between","out","off","over","under","again","further","then","once","here","there",
    "when","where","why","how","all","both","each","few","more","most","other","some","such","no","nor","not","only","own",
    "same","so","than","too","very","can","will","just","should","now","also","this","that","these","those","it","its",
    "is","are","was","were","be","been","being","have","has","had","do","does","did","would","could","might","shall","may",
    "i","me","my","we","our","you","your","he","him","his","she","her","they","them","their","what","which","who","whom",
    "if","as","because","until","while","am","any","get","got","like","new","one","two","first","well","even","back",
    "use","used","using","make","made","many","still","way","take","day","know","see","say","said","go","going","come",
    "time","thing","things","people","thing","things"
  ]);

  function stripHtml(html) {
    var div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s'\-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(function (w) { return w.length > 1 && !STOP_WORDS.has(w); });
  }

  function countBigrams(words) {
    var counts = {};
    for (var i = 0; i < words.length - 1; i++) {
      var bigram = words[i] + " " + words[i + 1];
      counts[bigram] = (counts[bigram] || 0) + 1;
    }
    return counts;
  }

  window.analyzeDensity = function () {
    var raw = document.getElementById("kd-content").value;
    if (!raw.trim()) {
      alert("Please enter some content to analyze.");
      return;
    }

    var text = stripHtml(raw);
    var words = tokenize(text);
    var totalWords = words.length;
    if (totalWords === 0) {
      document.getElementById("kd-summary").innerHTML = "<p>No meaningful words found.</p>";
      return;
    }

    // Word frequency
    var freq = {};
    words.forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });

    // Bigram frequency (top phrases)
    var bigrams = countBigrams(words);

    // Sort by count desc
    var sorted = Object.keys(freq).map(function (w) {
      return { word: w, count: freq[w], density: (freq[w] / totalWords * 100); };
    }).sort(function (a, b) { return b.count - a.count; });

    var topN = parseInt(document.getElementById("kd-top").value);
    var unique = sorted.length;
    var maxDensity = sorted[0] ? sorted[0].density : 0;

    // Summary stats
    document.getElementById("kd-summary").innerHTML =
      '<div class="kd-stat"><div class="label">Total Words</div><div class="value">' + totalWords.toLocaleString() + '</div></div>' +
      '<div class="kd-stat"><div class="label">Unique Words</div><div class="value">' + unique.toLocaleString() + '</div></div>' +
      '<div class="kd-stat"><div class="label">Diversity Ratio</div><div class="value">' + (unique / totalWords * 100).toFixed(1) + '%</div></div>';

    // Table
    var top = sorted.slice(0, topN);
    var html = '<table><thead><tr><th>#</th><th>Word</th><th>Count</th><th>Density</th><th class="bar-cell"></th></tr></thead><tbody>';
    top.forEach(function (item, i) {
      var pct = (item.density / maxDensity * 100).toFixed(0);
      var cls = item.density > 5 ? "danger" : item.density > 3 ? "warn" : "";
      html += '<tr><td>' + (i + 1) + '</td><td><strong>' + escapeHtml(item.word) + '</strong></td><td>' + item.count + '</td><td>' + item.density.toFixed(2) + '%</td><td><div class="density-bar ' + cls + '" style="width:' + pct + '%"></div></td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById("kd-table").innerHTML = html;

    // Target keyword analysis
    var target = document.getElementById("kd-target").value.trim().toLowerCase();
    var targetEl = document.getElementById("kd-target-result");
    if (!target) {
      targetEl.innerHTML = '<p class="form-hint">Enter a target keyword above to see its density analysis.</p>';
      return;
    }

    var targetCount = (text.toLowerCase().match(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g")) || []).length;
    var targetDensity = (targetCount / totalWords * 100);
    var verdict = targetDensity < 0.5 ? "Too low — consider adding more instances" :
                  targetDensity <= 3 ? "Good density range" :
                  "Potentially over-optimized (keyword stuffing risk)";
    var verdictColor = targetDensity < 0.5 ? "var(--warning)" : targetDensity <= 3 ? "var(--success)" : "var(--error)";

    targetEl.innerHTML =
      '<div class="kd-target-box">' +
      '<p>Target: <strong>' + escapeHtml(target) + '</strong></p>' +
      '<p>Occurrences: <span class="highlight">' + targetCount + '</span> / ' + totalWords.toLocaleString() + ' words</p>' +
      '<p>Density: <span class="highlight">' + targetDensity.toFixed(2) + '%</span></p>' +
      '<p style="color:' + verdictColor + ';font-weight:600">' + verdict + '</p>' +
      '</div>';
  };

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();

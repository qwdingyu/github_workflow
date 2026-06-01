// Robots.txt Generator — Pure client-side
(function () {
  "use strict";

  let ruleIndex = 0;

  function renderRule(idx, ua, allows, disallows, delay) {
    return `
    <div class="form-fieldset" id="rg-rule-${idx}" style="margin-bottom:16px">
      <legend>User-Agent Rule #${idx + 1}
        <button type="button" class="btn-secondary" onclick="window._rgRemoveRule(${idx})" style="font-size:0.8em;padding:2px 8px;margin-left:8px">Remove</button>
      </legend>
      <div class="form-group">
        <label>User-Agent</label>
        <select onchange="document.getElementById('rg-ua-custom-${idx}').style.display=this.value==='custom'?'block':'none'">
          <option value="*" ${ua === "*" ? "selected" : ""}>All crawlers (*)</option>
          <option value="Googlebot" ${ua === "Googlebot" ? "selected" : ""}>Googlebot</option>
          <option value="Bingbot" ${ua === "Bingbot" ? "selected" : ""}>Bingbot</option>
          <option value="Baiduspider" ${ua === "Baiduspider" ? "selected" : ""}>Baiduspider</option>
          <option value="custom" ${ua !== "*" && ua !== "Googlebot" && ua !== "Bingbot" && ua !== "Baiduspider" ? "selected" : ""}>Custom</option>
        </select>
        <input type="text" id="rg-ua-custom-${idx}" placeholder="Custom user-agent" value="${ua === "*" || ua === "Googlebot" || ua === "Bingbot" || ua === "Baiduspider" ? "" : ua}" style="margin-top:4px;display:${ua === "custom" || (ua !== "*" && ua !== "Googlebot" && ua !== "Bingbot" && ua !== "Baiduspider") ? "block" : "none"}">
      </div>
      <div class="form-group">
        <label>Disallow paths (one per line)</label>
        <textarea rows="3" placeholder="/admin/&amp;#10;/tmp/&amp;#10;/private/">${disallows}</textarea>
      </div>
      <div class="form-group">
        <label>Allow paths (one per line, overrides Disallow)</label>
        <textarea rows="2" placeholder="/admin/public/">${allows}</textarea>
      </div>
      <div class="form-group">
        <label>Crawl-delay (seconds, optional)</label>
        <input type="number" min="1" value="${delay || ""}" placeholder="10">
      </div>
    </div>`;
  }

  const container = document.getElementById("rg-rules");

  window._rgAddRule = function () {
    const html = renderRule(ruleIndex, "*", "", "", "");
    container.insertAdjacentHTML("beforeend", html);
    ruleIndex++;
  };

  window._rgRemoveRule = function (idx) {
    const el = document.getElementById("rg-rule-" + idx);
    if (el) el.remove();
  };

  // Start with one default rule
  container.innerHTML = renderRule(ruleIndex, "*", "", "", "");
  ruleIndex++;

  window.generateRobots = function () {
    const lines = [];
    const sitemap = document.getElementById("rg-sitemap").value.trim();
    if (sitemap) lines.push("Sitemap: " + sitemap);
    lines.push("");

    const ruleEls = container.querySelectorAll("[id^='rg-rule-']");
    ruleEls.forEach(function (ruleEl) {
      const select = ruleEl.querySelector("select");
      const customInput = ruleEl.querySelector('input[type="text"]');
      const textareas = ruleEl.querySelectorAll("textarea");
      const numberInput = ruleEl.querySelector('input[type="number"]');

      let ua = select.value;
      if (ua === "custom" || (customInput && customInput.value.trim())) {
        ua = customInput ? customInput.value.trim() : ua;
      }

      const disallows = textareas[0] ? textareas[0].value.trim() : "";
      const allows = textareas[1] ? textareas[1].value.trim() : "";
      const delay = numberInput ? numberInput.value.trim() : "";

      if (ua) {
        lines.push("User-agent: " + ua);
        if (delay) lines.push("Crawl-delay: " + delay);
        if (allows) {
          allows.split("\n").filter(Boolean).forEach(function (p) { lines.push("Allow: " + p.trim()); });
        }
        if (disallows) {
          disallows.split("\n").filter(Boolean).forEach(function (p) { lines.push("Disallow: " + p.trim()); });
        }
        if (!allows && !disallows) lines.push("Disallow:");
        lines.push("");
      }
    });

    document.getElementById("rg-output").textContent = lines.join("\n");
  };

  window.copyRobots = function () {
    const code = document.getElementById("rg-output").textContent;
    if (!code || code.startsWith("Add")) return;
    navigator.clipboard.writeText(code).then(function () {
      var btn = document.querySelector('#rg-result .btn-secondary');
      if (btn) { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy to Clipboard"; }, 2000); }
    });
  };
})();

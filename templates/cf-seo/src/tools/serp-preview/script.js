// SERP Preview Tool — Pure client-side
(function () {
  "use strict";

  window.updateSERP = function () {
    var title = document.getElementById("sp-title").value.trim();
    var desc = document.getElementById("sp-desc").value.trim();
    var url = document.getElementById("sp-url").value.trim() || "https://example.com/page";
    var date = document.getElementById("sp-date").value.trim();

    // Counters
    var titleLen = title.length;
    var descLen = desc.length;
    document.getElementById("sp-title-count").textContent = titleLen;
    document.getElementById("sp-desc-count").textContent = descLen;

    // Status indicators
    var tStatus = document.getElementById("sp-title-status");
    var dStatus = document.getElementById("sp-desc-status");
    tStatus.className = titleLen === 0 ? "sp-warn" : titleLen <= 60 ? "sp-ok" : "sp-error";
    tStatus.textContent = titleLen === 0 ? "Empty" : titleLen <= 60 ? "OK" : "Too long (" + titleLen + ")";
    dStatus.className = descLen === 0 ? "sp-warn" : descLen <= 155 ? "sp-ok" : "sp-error";
    dStatus.textContent = descLen === 0 ? "Empty" : descLen <= 155 ? "OK" : "Too long (" + descLen + ")";

    // Preview text
    var displayTitle = title || "Your Page Title Will Appear Here";
    var displayDesc = desc || "Your meta description will appear here. Write something compelling to improve your click-through rate.";

    // URL formatting
    var displayUrl = formatUrl(url);

    // Breadcrumb
    var breadcrumb = "";
    if (date) {
      var d = parseDate(date);
      if (d) breadcrumb = formatBreadcrumbDate(d);
    }

    // Desktop
    document.getElementById("sp-preview-title").textContent = displayTitle;
    document.getElementById("sp-preview-desc").textContent = displayDesc;
    document.getElementById("sp-preview-url").textContent = displayUrl;
    document.getElementById("sp-breadcrumb").textContent = breadcrumb;

    // Mobile
    document.getElementById("sp-preview-title-mobile").textContent = displayTitle;
    document.getElementById("sp-preview-desc-mobile").textContent = displayDesc;
    document.getElementById("sp-preview-url-mobile").textContent = displayUrl;
    document.getElementById("sp-breadcrumb-mobile").textContent = breadcrumb;
  };

  function formatUrl(url) {
    try {
      var u = new URL(url);
      var path = u.pathname.replace(/^\/|\/$/g, "").replace(/\//g, " › ") || "homepage";
      return u.hostname + " › " + path;
    } catch (e) {
      return url;
    }
  }

  function parseDate(s) {
    var parts = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!parts) return null;
    return new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]));
  }

  function formatBreadcrumbDate(d) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  // Auto-update on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.updateSERP);
  } else {
    window.updateSERP();
  }
})();

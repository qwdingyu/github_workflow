// Schema Markup Generator — Pure client-side
(function () {
  "use strict";

  const fieldSets = {
    Article: [
      { id: "headline", label: "Headline *", type: "text", required: true },
      { id: "author", label: "Author Name *", type: "text", required: true },
      { id: "datePublished", label: "Date Published (YYYY-MM-DD) *", type: "date", required: true },
      { id: "dateModified", label: "Date Modified (YYYY-MM-DD)", type: "date" },
      { id: "imageUrl", label: "Image URL", type: "url" },
      { id: "publisher", label: "Publisher Name", type: "text" },
      { id: "articleBody", label: "Article Body (first 200 chars)", type: "textarea" },
    ],
    Product: [
      { id: "name", label: "Product Name *", type: "text", required: true },
      { id: "description", label: "Description *", type: "textarea", required: true },
      { id: "imageUrl", label: "Image URL", type: "url" },
      { id: "price", label: "Price *", type: "number", required: true },
      { id: "currency", label: "Currency", type: "text", default: "USD" },
      { id: "availability", label: "Availability", type: "select", options: ["InStock", "OutOfStock", "PreOrder"] },
      { id: "brand", label: "Brand", type: "text" },
      { id: "ratingValue", label: "Rating (1-5)", type: "number", step: "0.1", min: "1", max: "5" },
      { id: "reviewCount", label: "Review Count", type: "number" },
    ],
    FAQPage: [
      { id: "faqNote", label: "Add questions and answers below. One pair per block.", type: "note" },
      { id: "faqPairs", label: "FAQ Pairs", type: "repeatable", fields: [
        { id: "question", label: "Question", type: "text" },
        { id: "answer", label: "Answer", type: "textarea" },
      ]},
    ],
    HowTo: [
      { id: "name", label: "HowTo Name *", type: "text", required: true },
      { id: "description", label: "Description *", type: "textarea", required: true },
      { id: "totalTime", label: "Total Time (e.g. PT30M)", type: "text" },
      { id: "howtoSteps", label: "Steps", type: "repeatable", fields: [
        { id: "name", label: "Step Name", type: "text" },
        { id: "text", label: "Step Description", type: "textarea" },
      ]},
    ],
    Event: [
      { id: "name", label: "Event Name *", type: "text", required: true },
      { id: "description", label: "Description *", type: "textarea", required: true },
      { id: "startDate", label: "Start Date/Time *", type: "datetime-local", required: true },
      { id: "endDate", label: "End Date/Time", type: "datetime-local" },
      { id: "locationName", label: "Location Name", type: "text" },
      { id: "address", label: "Address", type: "text" },
      { id: "imageUrl", label: "Image URL", type: "url" },
      { id: "price", label: "Price", type: "text" },
      { id: "currency", label: "Currency", type: "text", default: "USD" },
    ],
    LocalBusiness: [
      { id: "name", label: "Business Name *", type: "text", required: true },
      { id: "description", label: "Description", type: "textarea" },
      { id: "address", label: "Street Address *", type: "text", required: true },
      { id: "city", label: "City *", type: "text", required: true },
      { id: "state", label: "State/Region", type: "text" },
      { id: "postalCode", label: "Postal Code", type: "text" },
      { id: "country", label: "Country", type: "text", default: "US" },
      { id: "telephone", label: "Phone Number", type: "tel" },
      { id: "url", label: "Website URL", type: "url" },
      { id: "openingHours", label: "Opening Hours (e.g. Mo-Fr 09:00-17:00)", type: "text" },
      { id: "priceRange", label: "Price Range ($-$$$$)", type: "text" },
    ],
    BreadcrumbList: [
      { id: "bcNote", label: "Add breadcrumb items below.", type: "note" },
      { id: "bcItems", label: "Breadcrumb Items", type: "repeatable", fields: [
        { id: "name", label: "Name", type: "text" },
        { id: "item", label: "URL", type: "url" },
      ]},
    ],
    Organization: [
      { id: "name", label: "Organization Name *", type: "text", required: true },
      { id: "url", label: "Website URL *", type: "url", required: true },
      { id: "logo", label: "Logo URL", type: "url" },
      { id: "description", label: "Description", type: "textarea" },
      { id: "foundingDate", label: "Founding Date (YYYY)", type: "text" },
      { id: "sameAs", label: "Social Profiles (one per line)", type: "textarea" },
    ],
  };

  function renderField(field, prefix) {
    const id = prefix + field.id;
    if (field.type === "note") {
      return `<p class="form-hint">${field.label}</p>`;
    }
    if (field.type === "textarea") {
      return `<div class="form-group"><label for="${id}">${field.label}</label><textarea id="${id}" rows="3" placeholder="${field.label}"></textarea></div>`;
    }
    if (field.type === "select") {
      const opts = field.options.map((o) => `<option value="${o}">${o}</option>`).join("");
      return `<div class="form-group"><label for="${id}">${field.label}</label><select id="${id}">${opts}</select></div>`;
    }
    const req = field.required ? ' required' : '';
    const step = field.step ? ` step="${field.step}"` : '';
    const min = field.min ? ` min="${field.min}"` : '';
    const max = field.max ? ` max="${field.max}"` : '';
    const def = field.default ? ` value="${field.default}"` : '';
    return `<div class="form-group"><label for="${id}">${field.label}</label><input type="${field.type || "text"}" id="${id}"${req}${step}${min}${max}${def}></div>`;
  }

  function renderRepeatable(field, prefix) {
    const containerId = prefix + field.id;
    let html = `<div class="form-group"><label>${field.label}</label>`;
    html += `<div id="${containerId}" data-fields='${JSON.stringify(field.fields)}'>`;
    html += `<div class="repeatable-item" data-index="0">`;
    field.fields.forEach((f) => (html += renderField(f, containerId + "-0-")));
    html += `<button type="button" class="btn-secondary" onclick="window._schemaRemoveItem(this)" style="margin-top:4px;font-size:0.85em">Remove</button>`;
    html += `</div></div>`;
    html += `<button type="button" class="btn-secondary" onclick="window._schemaAddItem('${containerId}')">+ Add ${field.label.replace("s", "")}</button>`;
    html += `</div>`;
    return html;
  }

  function renderFields(type) {
    const fields = fieldSets[type] || [];
    let html = "";
    fields.forEach((f) => {
      if (f.type === "repeatable") {
        html += renderRepeatable(f, "");
      } else {
        html += renderField(f, "");
      }
    });
    document.getElementById("schema-fields").innerHTML = html;
  }

  window._schemaRemoveItem = function (btn) {
    const item = btn.closest(".repeatable-item");
    const container = item.parentElement;
    if (container.querySelectorAll(".repeatable-item").length > 1) {
      item.remove();
    }
  };

  window._schemaAddItem = function (containerId) {
    const container = document.getElementById(containerId);
    const fields = JSON.parse(container.dataset.fields);
    const idx = container.querySelectorAll(".repeatable-item").length;
    let html = `<div class="repeatable-item" data-index="${idx}">`;
    fields.forEach((f) => (html += renderField(f, containerId + "-" + idx + "-")));
    html += `<button type="button" class="btn-secondary" onclick="window._schemaRemoveItem(this)" style="margin-top:4px;font-size:0.85em">Remove</button>`;
    html += `</div>`;
    container.insertAdjacentHTML("beforeend", html);
  };

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function generateArticle(d) {
    const obj = { "@context": "https://schema.org", "@type": "NewsArticle", headline: d.headline, author: { "@type": "Person", name: d.author }, datePublished: d.datePublished };
    if (d.dateModified) obj.dateModified = d.dateModified;
    if (d.imageUrl) obj.image = [d.imageUrl];
    if (d.publisher) obj.publisher = { "@type": "Organization", name: d.publisher };
    if (d.articleBody) obj.articleBody = d.articleBody;
    return obj;
  }

  function generateProduct(d) {
    const obj = { "@context": "https://schema.org", "@type": "Product", name: d.name, description: d.description };
    if (d.imageUrl) obj.image = [d.imageUrl];
    obj.offers = { "@type": "Offer", price: d.price, priceCurrency: d.currency || "USD", availability: "https://schema.org/" + (d.availability === "OutOfStock" ? "OutOfStock" : d.availability === "PreOrder" ? "PreOrder" : "InStock") };
    if (d.brand) obj.brand = { "@type": "Brand", name: d.brand };
    if (d.ratingValue) {
      obj.aggregateRating = { "@type": "AggregateRating", ratingValue: d.ratingValue };
      if (d.reviewCount) obj.aggregateRating.reviewCount = d.reviewCount;
    }
    return obj;
  }

  function generateFAQ(d) {
    const container = document.getElementById("faqPairs");
    const items = container ? container.querySelectorAll(".repeatable-item") : [];
    const questionList = Array.from(items).map((item) => {
      const q = item.querySelector('[id$="-question"]');
      const a = item.querySelector('[id$="-answer"]');
      return { "@type": "Question", name: q ? q.value.trim() : "", acceptedAnswer: { "@type": "Answer", text: a ? a.value.trim() : "" } };
    }).filter((q) => q.name);
    return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questionList };
  }

  function generateHowTo(d) {
    const container = document.getElementById("howtoSteps");
    const items = container ? container.querySelectorAll(".repeatable-item") : [];
    const steps = Array.from(items).map((item, i) => {
      const n = item.querySelector('[id$="-name"]');
      const t = item.querySelector('[id$="-text"]');
      return { "@type": "HowToStep", position: i + 1, name: n ? n.value.trim() : "", itemListElement: { "@type": "HowToDirection", text: t ? t.value.trim() : "" } };
    }).filter((s) => s.name);
    const obj = { "@context": "https://schema.org", "@type": "HowTo", name: d.name, description: d.description, step: steps };
    if (d.totalTime) obj.totalTime = "PT" + d.totalTime.replace("PT", "");
    return obj;
  }

  function generateEvent(d) {
    const obj = { "@context": "https://schema.org", "@type": "Event", name: d.name, description: d.description, startDate: d.startDate };
    if (d.endDate) obj.endDate = d.endDate;
    if (d.locationName) obj.location = { "@type": "Place", name: d.locationName };
    if (d.address && obj.location) obj.location.address = { "@type": "PostalAddress", streetAddress: d.address };
    if (d.imageUrl) obj.image = [d.imageUrl];
    if (d.price) obj.offers = { "@type": "Offer", price: d.price, priceCurrency: d.currency || "USD" };
    return obj;
  }

  function generateLocalBusiness(d) {
    const obj = { "@context": "https://schema.org", "@type": "LocalBusiness", name: d.name };
    if (d.description) obj.description = d.description;
    obj.address = { "@type": "PostalAddress", streetAddress: d.address, addressLocality: d.city };
    if (d.state) obj.address.addressRegion = d.state;
    if (d.postalCode) obj.address.postalCode = d.postalCode;
    if (d.country) obj.address.addressCountry = d.country;
    if (d.telephone) obj.telephone = d.telephone;
    if (d.url) obj.url = d.url;
    if (d.openingHours) obj.openingHours = d.openingHours;
    if (d.priceRange) obj.priceRange = d.priceRange;
    return obj;
  }

  function generateBreadcrumbList(d) {
    const container = document.getElementById("bcItems");
    const items = container ? container.querySelectorAll(".repeatable-item") : [];
    const itemList = Array.from(items).map((item, i) => {
      const n = item.querySelector('[id$="-name"]');
      const u = item.querySelector('[id$="-item"]');
      return { "@type": "ListItem", position: i + 1, name: n ? n.value.trim() : "", item: u ? u.value.trim() : "" };
    }).filter((l) => l.name);
    return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: itemList };
  }

  function generateOrganization(d) {
    const obj = { "@context": "https://schema.org", "@type": "Organization", name: d.name, url: d.url };
    if (d.logo) obj.logo = d.logo;
    if (d.description) obj.description = d.description;
    if (d.foundingDate) obj.foundingDate = d.foundingDate;
    if (d.sameAs) obj.sameAs = d.sameAs.split("\n").map((s) => s.trim()).filter(Boolean);
    return obj;
  }

  const generators = {
    Article: generateArticle,
    Product: generateProduct,
    FAQPage: generateFAQ,
    HowTo: generateHowTo,
    Event: generateEvent,
    LocalBusiness: generateLocalBusiness,
    BreadcrumbList: generateBreadcrumbList,
    Organization: generateOrganization,
  };

  window.generateSchema = function () {
    const type = document.getElementById("schema-type").value;
    const gen = generators[type];
    if (!gen) return;
    const data = {};
    document.querySelectorAll("#schema-fields input, #schema-fields textarea, #schema-fields select").forEach((el) => {
      const key = el.id;
      if (key) data[key] = el.value;
    });
    try {
      const result = gen(data);
      document.getElementById("schema-output").textContent = JSON.stringify(result, null, 2);
    } catch (e) {
      document.getElementById("schema-output").textContent = "Error: " + e.message;
    }
  };

  window.copySchema = function () {
    const code = document.getElementById("schema-output").textContent;
    if (!code || code.startsWith("Select") || code.startsWith("Error")) return;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.querySelector('#schema-result .btn-secondary');
      if (btn) { btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = "Copy to Clipboard"), 2000); }
    });
  };

  document.getElementById("schema-type").addEventListener("change", function () {
    renderFields(this.value);
  });

  // Init
  renderFields("Article");
})();

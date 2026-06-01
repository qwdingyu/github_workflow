// Schema & Optimization Code Generator
// Generates copy-paste ready code for all GEO/SEO fixes

// ─── Schema.org Generators ────────────────────────────────────────────────

export function generateProductSchema(data: {
  name: string;
  description: string;
  image: string;
  price: string;
  currency?: string;
  availability?: string;
  brand?: string;
  sku?: string;
  reviewCount?: string;
  ratingValue?: string;
}) {
  const offers: Record<string, string> = {
    "@type": "Offer",
    "price": data.price,
    "priceCurrency": data.currency || "USD",
    "availability": data.availability || "https://schema.org/InStock",
  };
  if (data.sku) offers.sku = data.sku;

  const product: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: data.name,
    description: data.description,
    image: data.image,
    offers,
  };
  if (data.brand) product.brand = { "@type": "Brand", name: data.brand };
  if (data.ratingValue && data.reviewCount) {
    product.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: data.ratingValue,
      reviewCount: data.reviewCount,
    };
  }
  return formatJsonLd(product);
}

export function generateFaqSchema(questions: { question: string; answer: string }[]) {
  return formatJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: { "@type": "AcceptedAnswer", text: q.answer },
    })),
  });
}

export function generateBreadcrumbSchema(items: { name: string; url: string }[]) {
  return formatJsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

export function generateOrganizationSchema(data: {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
  telephone?: string;
  address?: string;
}) {
  const org: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: data.name,
    url: data.url,
  };
  if (data.logo) org.logo = data.logo;
  if (data.sameAs && data.sameAs.length) org.sameAs = data.sameAs;
  if (data.telephone) org.telephone = data.telephone;
  if (data.address) {
    org.address = { "@type": "PostalAddress", streetAddress: data.address };
  }
  return formatJsonLd(org);
}

export function generateHowToSchema(data: {
  name: string;
  steps: { name: string; text: string; image?: string }[];
  totalTime?: string;
}) {
  return formatJsonLd({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: data.name,
    step: data.steps.map((s) => {
      const step: Record<string, any> = {
        "@type": "HowToStep",
        name: s.name,
        itemListElement: s.text,
      };
      if (s.image) step.image = s.image;
      return step;
    }),
  });
}

export function generateLocalBusinessSchema(data: {
  name: string;
  address: string;
  telephone: string;
  url?: string;
  openingHours?: string[];
}) {
  const biz: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: data.name,
    address: { "@type": "PostalAddress", streetAddress: data.address },
    telephone: data.telephone,
  };
  if (data.url) biz.url = data.url;
  if (data.openingHours && data.openingHours.length) biz.openingHours = data.openingHours;
  return formatJsonLd(biz);
}

export function generateBlogPostingSchema(data: {
  headline: string;
  datePublished: string;
  author: string;
  image: string;
  description?: string;
  dateModified?: string;
}) {
  const post: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: data.headline,
    datePublished: data.datePublished,
    author: { "@type": "Person", name: data.author },
    image: data.image,
  };
  if (data.description) post.description = data.description;
  if (data.dateModified) post.dateModified = data.dateModified;
  return formatJsonLd(post);
}

// ─── llms.txt Generator ──────────────────────────────────────────────────

export function generateLlmsTxt(data: {
  siteName: string;
  description: string;
  sections?: { title: string; content: string }[];
  techStack?: string;
  version?: string;
}) {
  const lines: string[] = [];
  lines.push(`# ${data.siteName}`);
  lines.push("");
  lines.push(`> ${data.description}`);
  lines.push("");
  if (data.techStack) {
    lines.push(`Tech Stack: ${data.techStack}`);
    lines.push("");
  }
  if (data.version) {
    lines.push(`Version: ${data.version}`);
    lines.push("");
  }
  if (data.sections && data.sections.length) {
    for (const section of data.sections) {
      lines.push(`## ${section.title}`);
      lines.push("");
      lines.push(section.content);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ─── robots.txt AI Rules Generator ────────────────────────────────────────

export function generateRobotsAiRules(allowedBots: string[], blockedBots: string[], sitemapUrl?: string) {
  const lines: string[] = [];
  lines.push("# AI Bot Rules — Generated by SEO Guardian");
  lines.push("");

  for (const bot of allowedBots) {
    lines.push(`User-agent: ${bot}`);
    lines.push("Allow: /");
    lines.push("");
  }
  for (const bot of blockedBots) {
    lines.push(`User-agent: ${bot}`);
    lines.push("Disallow: /");
    lines.push("");
  }
  if (sitemapUrl) {
    lines.push(`Sitemap: ${sitemapUrl}`);
  }
  return lines.join("\n");
}

// ─── OG / Twitter Meta Generator ──────────────────────────────────────────

export function generateOgTags(data: {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName?: string;
  type?: string;
}) {
  const tags: string[] = [];
  tags.push(`<meta property="og:title" content="${escapeHtml(data.title)}" />`);
  tags.push(`<meta property="og:description" content="${escapeHtml(data.description)}" />`);
  tags.push(`<meta property="og:image" content="${escapeHtml(data.image)}" />`);
  tags.push(`<meta property="og:url" content="${escapeHtml(data.url)}" />`);
  if (data.siteName) tags.push(`<meta property="og:site_name" content="${escapeHtml(data.siteName)}" />`);
  if (data.type) tags.push(`<meta property="og:type" content="${escapeHtml(data.type)}" />`);
  // Twitter Card
  tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(data.title)}" />`);
  tags.push(`<meta name="twitter:description" content="${escapeHtml(data.description)}" />`);
  tags.push(`<meta name="twitter:image" content="${escapeHtml(data.image)}" />`);
  return tags.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatJsonLd(obj: Record<string, any>): string {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

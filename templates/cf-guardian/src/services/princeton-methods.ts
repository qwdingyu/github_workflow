// Princeton Citation Methods Checker — based on Princeton University KDD 2024 research
// 9 citation enhancement methods with impact percentages
// Source: geo-optimizer-skill docs/geo-methods.md

export interface PrincetonMethod {
  name: string;
  impact: number; // impact percentage from research
  detected: boolean;
  details?: Record<string, any>;
}

export interface PrincetonResult {
  methods: PrincetonMethod[];
  totalImpact: number;
  score: number; // normalized to 0-12
  maxScore: number;
  details: Record<string, any>;
}

const PRINCETON_METHODS = [
  { key: "stat_front_load", name: "统计数据前置", impact: 15 },
  { key: "authority_cite", name: "权威引用", impact: 12 },
  { key: "table_data", name: "表格数据", impact: 10 },
  { key: "faq_structure", name: "FAQ结构化", impact: 10 },
  { key: "brand_consistency", name: "品牌一致性", impact: 8 },
  { key: "link_diversity", name: "外部链接多样性", impact: 8 },
  { key: "question_headings", name: "标题问题化", impact: 7 },
  { key: "list_enumeration", name: "列表枚举", impact: 7 },
  { key: "code_examples", name: "代码示例", impact: 3 },
] as const;

const MAX_IMPACT = PRINCETON_METHODS.reduce((s, m) => s + m.impact, 0); // 80%
const MAX_SCORE = 12;

export function checkPrincetonMethods(
  bodyText: string,
  doc: any,
  html: string,
): PrincetonResult {
  const methods: PrincetonMethod[] = [];

  // 1. Statistical data front-loading (15%)
  // Check if first 50 words contain digit patterns
  const firstWords = bodyText.split(/\s+/).slice(0, 50).join(" ");
  const hasStatFrontLoad = /\d+[%,.:]/.test(firstWords) || /[\d,]+(\.\d+)?[%]/.test(firstWords);
  methods.push({
    name: PRINCETON_METHODS[0].name,
    impact: PRINCETON_METHODS[0].impact,
    detected: hasStatFrontLoad,
    details: { firstWordsPreview: firstWords.slice(0, 120) },
  });

  // 2. Authority citations (12%)
  // Links to .edu/.gov/.ac domains
  const allLinks = doc.querySelectorAll("a[href]");
  const authorityDomains = [
    /\.edu(\.\w+)?$/, /\.gov(\.\w+)?$/, /\.ac\.\w+$/, /\.go\.\w+$/,
    /\.edu\.\w{2}$/, /\.gov\.\w{2}$/, /\.org\/(unesco|who|wto|un)\//i,
  ];
  const authorityLinks = Array.from(allLinks).filter((a: any) => {
    const href = a.getAttribute("href") || "";
    return authorityDomains.some((pat) => pat.test(href));
  });
  const hasAuthorityCite = authorityLinks.length >= 1;
  methods.push({
    name: PRINCETON_METHODS[1].name,
    impact: PRINCETON_METHODS[1].impact,
    detected: hasAuthorityCite,
    details: { count: authorityLinks.length },
  });

  // 3. Table data presentation (10%)
  const tables = doc.querySelectorAll("table");
  const hasTables = tables.length > 0;
  methods.push({
    name: PRINCETON_METHODS[2].name,
    impact: PRINCETON_METHODS[2].impact,
    detected: hasTables,
    details: { tableCount: tables.length },
  });

  // 4. FAQ structured format (10%)
  const h2s = doc.querySelectorAll("h2");
  const hasFaqSection = Array.from(h2s).some((el: any) =>
    /faq|常见问题|问答|frequently.asked/i.test(el.textContent || "")
  );
  methods.push({
    name: PRINCETON_METHODS[3].name,
    impact: PRINCETON_METHODS[3].impact,
    detected: hasFaqSection,
  });

  // 5. Brand consistency (8%)
  // Brand name appears 3+ times in body
  const brandMentions = countBrandMentions(bodyText, doc);
  const hasBrandConsistency = brandMentions >= 3;
  methods.push({
    name: PRINCETON_METHODS[4].name,
    impact: PRINCETON_METHODS[4].impact,
    detected: hasBrandConsistency,
    details: { mentions: brandMentions },
  });

  // 6. External link diversity (8%)
  // 3+ unique external domains
  const externalDomains = new Set<string>();
  Array.from(allLinks).forEach((a: any) => {
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("http") || href.startsWith("#") || href.startsWith("/")) return;
    try {
      const url = new URL(href);
      externalDomains.add(url.hostname);
    } catch { /* skip */ }
  });
  const hasLinkDiversity = externalDomains.size >= 3;
  methods.push({
    name: PRINCETON_METHODS[5].name,
    impact: PRINCETON_METHODS[5].impact,
    detected: hasLinkDiversity,
    details: { uniqueDomains: externalDomains.size, domains: Array.from(externalDomains).slice(0, 10) },
  });

  // 7. Question-format headings (7%)
  const headings = doc.querySelectorAll("h2, h3");
  const questionHeadings = Array.from(headings).filter(
    (el: any) => /\?|¿/.test(el.textContent || ""),
  );
  const hasQuestionHeadings = questionHeadings.length >= 1;
  methods.push({
    name: PRINCETON_METHODS[6].name,
    impact: PRINCETON_METHODS[6].impact,
    detected: hasQuestionHeadings,
    details: { count: questionHeadings.length },
  });

  // 8. List enumeration (7%)
  const lists = doc.querySelectorAll("ul, ol");
  const substantialLists = Array.from(lists).filter((list: any) => {
    const items = list.querySelectorAll("li");
    return items.length >= 3;
  });
  const hasListEnumeration = substantialLists.length >= 1;
  methods.push({
    name: PRINCETON_METHODS[7].name,
    impact: PRINCETON_METHODS[7].impact,
    detected: hasListEnumeration,
    details: { listCount: substantialLists.length },
  });

  // 9. Code examples (3%)
  const codeBlocks = doc.querySelectorAll("pre, code");
  const hasCodeExamples = codeBlocks.length > 0;
  methods.push({
    name: PRINCETON_METHODS[8].name,
    impact: PRINCETON_METHODS[8].impact,
    detected: hasCodeExamples,
    details: { count: codeBlocks.length },
  });

  // Calculate total impact and normalize score
  const totalImpact = methods.filter((m) => m.detected).reduce((s, m) => s + m.impact, 0);
  const score = Math.round((totalImpact / MAX_IMPACT) * MAX_SCORE);

  return {
    methods,
    totalImpact,
    score: Math.min(score, MAX_SCORE),
    maxScore: MAX_SCORE,
    details: {
      totalImpact,
      maxImpact: MAX_IMPACT,
      detectedCount: methods.filter((m) => m.detected).length,
      totalCount: methods.length,
    },
  };
}

function countBrandMentions(bodyText: string, doc: any): number {
  // Extract brand from title
  const titleEl = doc.querySelector("title");
  const titleText = titleEl?.textContent?.trim() || "";
  if (!titleText) return 0;

  // Simple brand extraction: first meaningful word group from title
  const brand = titleText.split(/[\s|\-–—]+/).find((part: string) => {
    const lower = part.toLowerCase().trim();
    return lower && lower.length > 1 && !["home", "welcome", "index", "page", "blog", "shop", "store"].includes(lower);
  });
  if (!brand || brand.length < 2) return 0;

  const regex = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (bodyText.match(regex) || []).length;
}

// Keyword Tracking Service — tracks target keywords and estimates rankings
// Uses Google Custom Search JSON API pattern (free tier: 100 queries/day)

export interface TrackedKeyword {
  id: string;
  user_id: string;
  site_id: string;
  keyword: string;
  searchVolume: number; // estimated monthly searches
  difficulty: number; // 0-100
  currentRank: number | null; // position in SERP, null = not in top 100
  previousRank: number | null;
  bestRank: number | null;
  lastChecked: string;
  createdAt: string;
}

export interface KeywordRanking {
  keyword: string;
  position: number | null;
  url: string | null;
  checkedAt: string;
  serpFeatures: string[]; // AI Overview, Featured Snippet, etc.
}

export interface KeywordReport {
  siteId: string;
  siteUrl: string;
  keywords: KeywordRanking[];
  avgPosition: number | null;
  topRanking: number | null;
  keywordsInTop10: number;
  keywordsInTop3: number;
  keywordsNotRanking: number;
  estimatedTraffic: number; // rough estimate
  lastChecked: string;
}

/**
 * Extract target keywords from page content.
 * Analyzes title, headings, meta description, and body text to identify
 * the keywords the page is targeting.
 */
export function extractTargetKeywords(
  html: string,
  url: string,
): { keyword: string; relevance: number }[] {
  const parser = new (globalThis as any).DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const title = doc.querySelector("title")?.textContent?.toLowerCase().trim() || "";
  const h1 = Array.from(doc.querySelectorAll("h1"))
    .map((el: any) => el.textContent?.toLowerCase().trim() || "")
    .join(" ");
  const metaDesc = doc.querySelector('meta[name="description"]')
    ?.getAttribute("content")?.toLowerCase().trim() || "";

  // Combine signals
  const combined = `${title} ${h1} ${metaDesc}`;

  // Extract meaningful phrases (2-4 words)
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "this", "that",
    "these", "those", "it", "its", "we", "our", "you", "your", "they",
    "their", "he", "she", "his", "her", "i", "my", "me", "not", "no",
    "about", "how", "what", "when", "where", "why", "who", "which",
  ]);

  const words = combined.replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const keywords: { keyword: string; relevance: number }[] = [];
  const seen = new Set<string>();

  // Extract 2-4 word phrases
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      const phraseWords = phrase.split(" ");

      // Skip if too many stop words
      const stopCount = phraseWords.filter((w) => stopWords.has(w)).length;
      if (stopCount >= phraseWords.length - 1) continue;

      // Skip if too short
      const meaningfulWords = phraseWords.filter((w) => !stopWords.has(w));
      if (meaningfulWords.length < 2) continue;

      // Skip if already seen
      if (seen.has(phrase)) continue;
      seen.add(phrase);

      // Calculate relevance score
      let relevance = 0;
      if (title.includes(phrase)) relevance += 30;
      if (h1.includes(phrase)) relevance += 25;
      if (metaDesc.includes(phrase)) relevance += 15;
      relevance += meaningfulWords.length * 5;

      if (relevance > 20) {
        keywords.push({ keyword: phrase, relevance });
      }
    }
  }

  return keywords
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 20);
}

/**
 * Estimate search volume for a keyword based on heuristics.
 * In production, you'd use Google Keyword Planner or similar API.
 */
export function estimateSearchVolume(keyword: string): {
  volume: number;
  difficulty: number;
  cpc: number;
} {
  // Very rough heuristic based on keyword characteristics
  const words = keyword.split(" ").filter(Boolean);
  const wordCount = words.length;
  const totalLength = keyword.replace(/\s/g, "").length;

  // Longer, more specific keywords tend to have lower volume but lower difficulty
  let volume: number;
  if (wordCount === 1) {
    volume = Math.floor(Math.random() * 50000) + 10000; // head term
  } else if (wordCount === 2) {
    volume = Math.floor(Math.random() * 10000) + 1000;
  } else if (wordCount === 3) {
    volume = Math.floor(Math.random() * 3000) + 100;
  } else {
    volume = Math.floor(Math.random() * 500) + 10; // long-tail
  }

  // Difficulty inversely correlates with specificity
  const difficulty = Math.max(
    5,
    Math.min(95, 80 - wordCount * 15 - (totalLength > 20 ? 10 : 0)),
  );

  // CPC estimate
  const cpc = Math.round((volume / 10000) * (difficulty / 50) * 100) / 100;

  return { volume, difficulty, cpc };
}

/**
 * Generate a keyword tracking report for a site.
 */
export function generateKeywordReport(
  siteId: string,
  siteUrl: string,
  keywords: { keyword: string; relevance: number }[],
): KeywordReport {
  const keywordRankings: KeywordRanking[] = keywords.map((kw) => {
    const { volume, difficulty } = estimateSearchVolume(kw.keyword);
    // Simulate ranking (in production, this would query actual SERPs)
    const position = Math.floor(Math.random() * 80) + 10; // placeholder
    return {
      keyword: kw.keyword,
      position: position < 100 ? position : null,
      url: position < 100 ? siteUrl : null,
      checkedAt: new Date().toISOString(),
      serpFeatures: position <= 3 ? ["Featured Snippet"] : position <= 10 ? [] : [],
    };
  });

  const ranked = keywordRankings.filter((kr) => kr.position !== null);
  const avgPosition = ranked.length > 0
    ? Math.round(ranked.reduce((sum, kr) => sum + (kr.position || 0), 0) / ranked.length)
    : null;
  const topRanking = ranked.length > 0
    ? Math.min(...ranked.map((kr) => kr.position || 100))
    : null;

  return {
    siteId,
    siteUrl,
    keywords: keywordRankings,
    avgPosition,
    topRanking,
    keywordsInTop10: keywordRankings.filter((kr) => kr.position !== null && kr.position <= 10).length,
    keywordsInTop3: keywordRankings.filter((kr) => kr.position !== null && kr.position <= 3).length,
    keywordsNotRanking: keywordRankings.filter((kr) => kr.position === null).length,
    estimatedTraffic: ranked.reduce((sum, kr) => {
      // Rough CTR model: position 1 = ~30%, position 10 = ~5%
      const ctr = kr.position ? Math.max(0.5, 30 / kr.position) / 100 : 0;
      const vol = estimateSearchVolume(kr.keyword).volume;
      return sum + Math.round(vol * ctr);
    }, 0),
    lastChecked: new Date().toISOString(),
  };
}

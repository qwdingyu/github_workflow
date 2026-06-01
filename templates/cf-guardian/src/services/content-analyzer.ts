// Content Analyzer — deep content quality analysis for SEO
// Analyzes readability, keyword density, content structure, and duplicate content
export interface ContentAnalysis {
  // Text metrics
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgWordsPerSentence: number;
  avgWordsPerParagraph: number;

  // Readability
  readabilityScore: number; // 0-100, higher is better
  readabilityGrade: string; // "Excellent" | "Good" | "Fair" | "Poor"
  fleschKincaidGrade: number; // US grade level

  // Keyword analysis
  topKeywords: { word: string; count: number; density: number }[];
  keywordDensityScore: number; // 0-100

  // Content structure
  hasIntroduction: boolean;
  hasConclusion: boolean;
  headingHierarchy: number[]; // [1, 2, 3] = h1, h2, h3 counts
  orphanHeadings: boolean; // h3 without parent h2
  textToHtmlRatio: number; // 0-1

  // Content quality signals
  hasImages: boolean;
  hasVideos: boolean;
  hasInternalLinks: boolean;
  hasExternalLinks: boolean;
  hasDataTables: boolean;
  hasLists: boolean;
  hasBlockquotes: boolean;

  // Issues
  issues: ContentIssue[];
}

export interface ContentIssue {
  severity: "critical" | "warning" | "info";
  category: "content" | "readability" | "structure" | "quality";
  title: string;
  message: string;
}

// Common English stop words to filter for keyword analysis
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "dare",
  "ought", "used", "it", "its", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they", "what", "which", "who",
  "whom", "my", "your", "his", "her", "our", "their", "not", "no",
  "as", "if", "then", "than", "too", "very", "just", "about", "up",
  "out", "all", "also", "into", "over", "after", "before", "between",
  "through", "during", "above", "below", "any", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "only",
  "own", "same", "so", "very", "because", "how", "when", "where",
]);

function extractText(doc: any): string {
  // Remove script, style, nav, footer noise
  const remove = doc.querySelectorAll("script, style, nav, footer, header, noscript, svg");
  for (const el of remove) el.remove();
  return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countSentences(text: string): number {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
}

function getTopKeywords(text: string, topN: number = 10): { word: string; count: number; density: number }[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
  const total = words.length;
  const freq: Record<string, number> = {};

  for (const word of words) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    freq[word] = (freq[word] || 0) + 1;
  }

  return Object.entries(freq)
    .map(([word, count]) => ({ word, count, density: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function calcFleschKincaid(text: string): number {
  const sentences = countSentences(text);
  const words = countWords(text);
  if (sentences === 0 || words === 0) return 0;

  // Count syllables (approximation)
  const wordList = words > 0 ? text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean) : [];
  let syllables = 0;
  for (const word of wordList) {
    if (word.length <= 3) { syllables += 1; continue; }
    // Remove trailing e
    const w = word.endsWith("e") ? word.slice(0, -1) : word;
    const matches = w.match(/[aeiouy]+/gi);
    syllables += matches ? matches.length : 1;
  }

  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return Math.max(0, Math.min(20, Math.round(score * 10) / 10));
}

function checkHeadingHierarchy(doc: any): { hierarchy: number[]; orphanHeadings: boolean } {
  const counts: number[] = [0, 0, 0, 0, 0, 0];
  const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let seenLevel = 0; // track max level seen

  for (const h of headings) {
    const level = parseInt(h.tagName.substring(1));
    if (level >= 1 && level <= 6) counts[level - 1]++;
    // Check for orphan headings (h4+ without preceding lower-level heading)
    if (level >= 3 && seenLevel < level - 1) {
      return { hierarchy: counts, orphanHeadings: true };
    }
    seenLevel = Math.max(seenLevel, level);
  }

  return { hierarchy: counts, orphanHeadings: false };
}

export function analyzeContent(doc: any, baseUrl?: string): ContentAnalysis {
  const text = extractText(doc);
  const wordCount = countWords(text);
  const sentenceCount = countSentences(text);
  const paragraphs = doc.querySelectorAll("p");
  const paragraphCount = paragraphs.length;

  const avgWordsPerSentence = sentenceCount > 0 ? Math.round(wordCount / sentenceCount * 10) / 10 : 0;
  const avgWordsPerParagraph = paragraphCount > 0 ? Math.round(wordCount / paragraphCount * 10) / 10 : 0;

  const fkGrade = calcFleschKincaid(text);
  // Readability score: lower FK grade = easier to read, sweet spot is 6-8
  let readabilityScore = 100;
  if (fkGrade > 12) readabilityScore -= (fkGrade - 12) * 8;
  else if (fkGrade < 4) readabilityScore -= (4 - fkGrade) * 5;
  readabilityScore = Math.max(0, Math.min(100, Math.round(readabilityScore)));

  const grades: string[] = ["Excellent", "Good", "Fair", "Poor"];
  const readabilityGrade = readabilityScore >= 80 ? grades[0] : readabilityScore >= 60 ? grades[1] : readabilityScore >= 40 ? grades[2] : grades[3];

  const topKeywords = getTopKeywords(text);
  // Keyword density score: ideal is 1-3% for primary keyword
  let keywordDensityScore = 0;
  if (topKeywords.length > 0 && wordCount > 0) {
    const primary = topKeywords[0];
    if (primary.density >= 1 && primary.density <= 3) keywordDensityScore = 100;
    else if (primary.density > 3 && primary.density <= 5) keywordDensityScore = 60;
    else if (primary.density > 5) keywordDensityScore = 30; // keyword stuffing
    else keywordDensityScore = 50; // too low
  }

  const { hierarchy, orphanHeadings } = checkHeadingHierarchy(doc);

  // Text-to-HTML ratio
  const htmlLength = doc.documentElement?.outerHTML?.length || 1;
  const textLength = text.length;
  const textToHtmlRatio = Math.round((textLength / htmlLength) * 100);

  // Content quality signals
  const hasImages = doc.querySelectorAll("img").length > 0;
  const hasVideos = doc.querySelectorAll("video, iframe[src*=\"youtube\"], iframe[src*=\"vimeo\"]").length > 0;

  let hasInternalLinks = false;
  let hasExternalLinks = false;
  if (baseUrl) {
    const baseHost = new URL(baseUrl).hostname;
    const links = doc.querySelectorAll("a[href]");
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      try {
        const url = new URL(href, baseUrl);
        if (url.hostname === baseHost) hasInternalLinks = true;
        else hasExternalLinks = true;
      } catch {}
    }
  }

  const hasDataTables = doc.querySelectorAll("table").length > 0;
  const hasLists = doc.querySelectorAll("ul, ol").length > 0;
  const hasBlockquotes = doc.querySelectorAll("blockquote").length > 0;

  // Check intro/conclusion (heuristic: first/last paragraph length)
  const hasIntroduction = paragraphCount > 0 && paragraphs[0]?.textContent?.split(/\s+/).length > 20;
  const hasConclusion = paragraphCount > 1 && paragraphs[paragraphCount - 1]?.textContent?.split(/\s+/).length > 20;

  // Generate issues
  const issues: ContentIssue[] = [];

  if (wordCount < 300) {
    issues.push({ severity: "critical", category: "content", title: "Thin content", message: `Only ${wordCount} words. Aim for at least 300 words for a minimum viable page, 1000+ for competitive keywords.` });
  } else if (wordCount < 600) {
    issues.push({ severity: "warning", category: "content", title: "Short content", message: `${wordCount} words. Consider expanding to 1000+ words for better rankings.` });
  }

  if (avgWordsPerSentence > 25) {
    issues.push({ severity: "warning", category: "readability", title: "Sentences too long", message: `Average ${avgWordsPerSentence} words/sentence. Aim for 15-20 for optimal readability.` });
  }

  if (fkGrade > 12) {
    issues.push({ severity: "warning", category: "readability", title: "Hard to read", message: `Flesch-Kincaid grade ${fkGrade}. Aim for grade 8-10 for web content.` });
  }

  if (topKeywords.length > 0 && topKeywords[0].density > 5) {
    issues.push({ severity: "warning", category: "content", title: "Possible keyword stuffing", message: `"${topKeywords[0].word}" appears at ${topKeywords[0].density}% density. Keep under 3%.` });
  }

  if (orphanHeadings) {
    issues.push({ severity: "info", category: "structure", title: "Broken heading hierarchy", message: "Some headings skip levels (e.g., h3 after h1). Use sequential h1→h2→h3 structure." });
  }

  if (textToHtmlRatio < 10) {
    issues.push({ severity: "warning", category: "quality", title: "Low text-to-HTML ratio", message: `Only ${textToHtmlRatio}% text. Aim for 25%+ for content-rich pages.` });
  }

  if (!hasImages) {
    issues.push({ severity: "info", category: "quality", title: "No images", message: "Pages with relevant images get 94% more views." });
  }

  return {
    wordCount, sentenceCount, paragraphCount,
    avgWordsPerSentence, avgWordsPerParagraph,
    readabilityScore, readabilityGrade, fleschKincaidGrade: fkGrade,
    topKeywords, keywordDensityScore,
    hasIntroduction, hasConclusion, headingHierarchy: hierarchy, orphanHeadings, textToHtmlRatio,
    hasImages, hasVideos, hasInternalLinks, hasExternalLinks, hasDataTables, hasLists, hasBlockquotes,
    issues,
  };
}

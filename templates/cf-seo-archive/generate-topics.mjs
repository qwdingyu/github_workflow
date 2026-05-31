#!/usr/bin/env node
/**
 * generate-topics.mjs
 * Pre-generates topics.json with 10,000 SEO-ready topic entries.
 * Each entry has enough structured data for Eleventy to render a full page.
 *
 * Usage: node scripts/generate-topics.mjs [--count 10000] [--output src/_data/topics.json]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// ─── CLI args ───
const args = process.argv.slice(2);
let count = 10000;
let output = "src/_data/topics.json";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" && args[i + 1]) { count = parseInt(args[++i], 10); }
  if (args[i] === "--output" && args[i + 1]) { output = args[++i]; }
}

// ─── Topic seed data ───
// 100 categories × 100 subtopics = 10,000 pages
// Each category has real keyword clusters for programmatic SEO

const categories = [
  // ── Technology (20 categories) ──
  { name: "Cloud Computing", slug: "cloud-computing", keywords: ["cloud", "aws", "azure", "gcp", "infrastructure"] },
  { name: "Cybersecurity", slug: "cybersecurity", keywords: ["security", "encryption", "firewall", "threat", "protection"] },
  { name: "Artificial Intelligence", slug: "artificial-intelligence", keywords: ["AI", "machine learning", "deep learning", "neural network", "automation"] },
  { name: "Web Development", slug: "web-development", keywords: ["frontend", "backend", "fullstack", "framework", "API"] },
  { name: "Mobile Development", slug: "mobile-development", keywords: ["iOS", "Android", "React Native", "Flutter", "mobile app"] },
  { name: "DevOps", slug: "devops", keywords: ["CI/CD", "Docker", "Kubernetes", "automation", "deployment"] },
  { name: "Data Science", slug: "data-science", keywords: ["analytics", "big data", "visualization", "statistics", "ML"] },
  { name: "Blockchain", slug: "blockchain", keywords: ["crypto", "DeFi", "smart contract", "Web3", "NFT"] },
  { name: "Programming Languages", slug: "programming-languages", keywords: ["Python", "JavaScript", "Rust", "Go", "TypeScript"] },
  { name: "Database", slug: "database", keywords: ["SQL", "NoSQL", "PostgreSQL", "MongoDB", "caching"] },
  { name: "API Design", slug: "api-design", keywords: ["REST", "GraphQL", "gRPC", "OpenAPI", "webhook"] },
  { name: "Microservices", slug: "microservices", keywords: ["service mesh", "distributed", "event-driven", "container", "orchestration"] },
  { name: "Serverless", slug: "serverless", keywords: ["Lambda", "Cloudflare Workers", "edge computing", "FaaS", "cold start"] },
  { name: "Open Source", slug: "open-source", keywords: ["GitHub", "MIT license", "contributing", "community", "FOSS"] },
  { name: "Version Control", slug: "version-control", keywords: ["Git", "branching", "merge", "rebase", "workflow"] },
  { name: "Testing", slug: "testing", keywords: ["unit test", "integration test", "E2E", "TDD", "coverage"] },
  { name: "Performance Optimization", slug: "performance", keywords: ["speed", "caching", "CDN", "lazy loading", "compression"] },
  { name: "Accessibility", slug: "accessibility", keywords: ["WCAG", "a11y", "screen reader", "ARIA", "inclusive design"] },
  { name: "Progressive Web Apps", slug: "pwa", keywords: ["service worker", "offline", "manifest", "push notification", "installable"] },
  { name: "Low Code No Code", slug: "low-code", keywords: ["no-code", "drag and drop", "builder", "automation", "workflow"] },

  // ── Business & Marketing (20 categories) ──
  { name: "Digital Marketing", slug: "digital-marketing", keywords: ["SEO", "SEM", "PPC", "content marketing", "social media"] },
  { name: "E-commerce", slug: "ecommerce", keywords: ["online store", "Shopify", "conversion", "cart", "checkout"] },
  { name: "SaaS", slug: "saas", keywords: ["subscription", "MRR", "churn", "freemium", "SaaS metrics"] },
  { name: "Startup", slug: "startup", keywords: ["MVP", "pivot", "fundraising", "VC", "bootstrapping"] },
  { name: "Freelancing", slug: "freelancing", keywords: ["remote work", "gig economy", "client", "upwork", "rate"] },
  { name: "Project Management", slug: "project-management", keywords: ["Agile", "Scrum", "Kanban", "sprint", "backlog"] },
  { name: "Product Management", slug: "product-management", keywords: ["roadmap", "user story", "PRD", "prioritization", "OKR"] },
  { name: "Growth Hacking", slug: "growth-hacking", keywords: ["viral", "referral", "A/B testing", "funnel", "retention"] },
  { name: "Email Marketing", slug: "email-marketing", keywords: ["newsletter", "open rate", "CTR", "segmentation", "automation"] },
  { name: "Content Strategy", slug: "content-strategy", keywords: ["editorial calendar", "pillar", "cluster", "topic", "repurposing"] },
  { name: "Social Media", slug: "social-media", keywords: ["Instagram", "TikTok", "LinkedIn", "engagement", "algorithm"] },
  { name: "Influencer Marketing", slug: "influencer-marketing", keywords: ["micro-influencer", "UGC", "sponsorship", "collab", "reach"] },
  { name: "Brand Strategy", slug: "brand-strategy", keywords: ["branding", "identity", "positioning", "voice", "messaging"] },
  { name: "Customer Success", slug: "customer-success", keywords: ["onboarding", "NPS", "retention", "CSAT", "support"] },
  { name: "Sales", slug: "sales", keywords: ["pipeline", "lead gen", "closing", "CRM", "outreach"] },
  { name: "Analytics", slug: "analytics", keywords: ["GA4", "metrics", "KPI", "dashboard", "attribution"] },
  { name: "Marketing Automation", slug: "marketing-automation", keywords: ["HubSpot", "Mailchimp", "workflow", "trigger", "drip"] },
  { name: "Conversion Optimization", slug: "cRO", keywords: ["CRO", "landing page", "A/B test", "heat map", "UX"] },
  { name: "Affiliate Marketing", slug: "affiliate-marketing", keywords: ["commission", "referral link", "CPA", "network", "cookie"] },
  { name: "Video Marketing", slug: "video-marketing", keywords: ["YouTube", "shorts", "streaming", "live", "tutorial"] },

  // ── Finance & Crypto (15 categories) ──
  { name: "Personal Finance", slug: "personal-finance", keywords: ["budget", "savings", "investing", "debt", "retirement"] },
  { name: "Cryptocurrency", slug: "cryptocurrency", keywords: ["Bitcoin", "Ethereum", "trading", "wallet", "exchange"] },
  { name: "DeFi", slug: "defi", keywords: ["yield farming", "liquidity pool", "DEX", "lending", "governance"] },
  { name: "NFT", slug: "nft", keywords: ["digital art", "collectible", "marketplace", "minting", "royalty"] },
  { name: "Stock Market", slug: "stock-market", keywords: ["ETF", "index fund", "dividend", "blue chip", "trading"] },
  { name: "Real Estate", slug: "real-estate", keywords: ["property", "mortgage", "REIT", "rental", "investment"] },
  { name: "Tax Planning", slug: "tax-planning", keywords: ["deduction", "credit", "filing", "IRS", "tax bracket"] },
  { name: "Insurance", slug: "insurance", keywords: ["health", "life", "auto", "coverage", "premium"] },
  { name: "Passive Income", slug: "passive-income", keywords: ["side hustle", "dividend", "rental", "royalty", "automation"] },
  { name: "Credit Cards", slug: "credit-cards", keywords: ["rewards", "cashback", "points", "APR", "balance transfer"] },
  { name: "Emergency Fund", slug: "emergency-fund", keywords: ["savings", "high yield", "liquidity", "reserves", "expenses"] },
  { name: "Retirement Planning", slug: "retirement", keywords: ["401k", "IRA", "Roth", "pension", "Social Security"] },
  { name: "Student Loans", slug: "student-loans", keywords: ["forgiveness", "repayment", "refinance", "deferment", "interest"] },
  { name: "Fintech", slug: "fintech", keywords: ["neobank", "payment", "digital wallet", "BNPL", "lending"] },
  { name: "Wealth Management", slug: "wealth-management", keywords: ["portfolio", "advisory", "asset allocation", "HNI", "trust"] },

  // ── Health & Wellness (15 categories) ──
  { name: "Fitness", slug: "fitness", keywords: ["workout", "strength", "cardio", "HIIT", "gym"] },
  { name: "Nutrition", slug: "nutrition", keywords: ["diet", "macros", "calories", "meal prep", "supplements"] },
  { name: "Mental Health", slug: "mental-health", keywords: ["anxiety", "depression", "therapy", "meditation", "mindfulness"] },
  { name: "Sleep", slug: "sleep", keywords: ["insomnia", "sleep hygiene", "REM", "melatonin", "circadian"] },
  { name: "Yoga", slug: "yoga", keywords: ["pose", "breathing", "flexibility", "vinyasa", "restoration"] },
  { name: "Running", slug: "running", keywords: ["marathon", "5K", "pace", "shoes", "training plan"] },
  { name: "Weight Loss", slug: "weight-loss", keywords: ["calorie deficit", "BMI", "fat loss", "metabolism", "intermittent fasting"] },
  { name: "Muscle Building", slug: "muscle-building", keywords: ["hypertrophy", "protein", "progressive overload", "split", "gains"] },
  { name: "Skincare", slug: "skincare", keywords: ["routine", "moisturizer", "SPF", "retinol", "acne"] },
  { name: "Home Remedies", slug: "home-remedies", keywords: ["natural", "herbal", "essential oil", "turmeric", "ginger"] },
  { name: "Vegan Diet", slug: "vegan-diet", keywords: ["plant-based", "protein sources", "B12", "tofu", "sustainability"] },
  { name: "Keto Diet", slug: "keto-diet", keywords: ["ketosis", "low carb", "fat adaptation", "electrolytes", "keto flu"] },
  { name: "Supplements", slug: "supplements", keywords: ["vitamin D", "magnesium", "omega-3", "creatine", "pre-workout"] },
  { name: "Stress Management", slug: "stress-management", keywords: ["cortisol", "relaxation", "breathing", "work-life balance", "burnout"] },
  { name: "Telehealth", slug: "telehealth", keywords: ["virtual doctor", "remote care", "telemedicine", "app", "prescription"] },

  // ── Education & Career (15 categories) ──
  { name: "Online Learning", slug: "online-learning", keywords: ["MOOC", "Coursera", "Udemy", "certificate", "self-paced"] },
  { name: "Career Change", slug: "career-change", keywords: ["pivot", "transferable skills", "resume", "interview", "networking"] },
  { name: "Remote Work", slug: "remote-work", keywords: ["WFH", "distributed team", "async", "Slack", "productivity"] },
  { name: "Leadership", slug: "leadership", keywords: ["management", "communication", "delegation", "vision", "coaching"] },
  { name: "Public Speaking", slug: "public-speaking", keywords: ["presentation", "TED", "stage fright", "storytelling", "audience"] },
  { name: "Resume Writing", slug: "resume-writing", keywords: ["CV", "ATS", "format", "keywords", "quantify"] },
  { name: "Interview Prep", slug: "interview-prep", keywords: ["behavioral", "technical", "system design", "negotiation", "questions"] },
  { name: "Salary Negotiation", slug: "salary-negotiation", keywords: ["compensation", "equity", "benefits", "market rate", "counteroffer"] },
  { name: "Side Hustle", slug: "side-hustle", keywords: ["gig", "freelance", "passive income", "Fiverr", "scalable"] },
  { name: "Networking", slug: "networking", keywords: ["LinkedIn", "events", "mentorship", "cold email", "referral"] },
  { name: "Time Management", slug: "time-management", keywords: ["Pomodoro", "time blocking", "prioritization", "deep work", "focus"] },
  { name: "Productivity Tools", slug: "productivity-tools", keywords: ["Notion", "Obsidian", "Todoist", "automation", "workflow"] },
  { name: "Certifications", slug: "certifications", keywords: ["AWS", "Google Cloud", "PMP", "CompTIA", "study guide"] },
  { name: "Coding Bootcamp", slug: "coding-bootcamp", keywords: ["immersive", "fullstack", "job placement", "scholarship", "curriculum"] },
  { name: "Higher Education", slug: "higher-education", keywords: ["university", "grad school", "online degree", "accreditation", "tuition"] },

  // ── Lifestyle & Travel (15 categories) ──
  { name: "Travel", slug: "travel", keywords: ["destination", "budget travel", "itinerary", "flight deals", "packing"] },
  { name: "Digital Nomad", slug: "digital-nomad", keywords: ["remote", "visa", "co-working", "nomad life", "tax"] },
  { name: "Home Organization", slug: "home-organization", keywords: ["declutter", "minimalism", "storage", "KonMari", "systems"] },
  { name: "Cooking", slug: "cooking", keywords: ["recipe", "meal prep", "kitchen", "technique", "ingredients"] },
  { name: "DIY Projects", slug: "diy-projects", keywords: ["home improvement", "repair", "woodworking", "upcycle", "tools"] },
  { name: "Gardening", slug: "gardening", keywords: ["indoor plants", "vegetables", "composting", "seasonal", "hydroponic"] },
  { name: "Pet Care", slug: "pet-care", keywords: ["dog", "cat", "grooming", "training", "veterinary"] },
  { name: "Photography", slug: "photography", keywords: ["camera", "editing", "composition", "lighting", "portfolio"] },
  { name: "Sustainable Living", slug: "sustainable-living", keywords: ["eco-friendly", "zero waste", "renewable", "carbon footprint", "upcycling"] },
  { name: "Parenting", slug: "parenting", keywords: ["toddler", "education", "screen time", "discipline", "development"] },
  { name: "Relationships", slug: "relationships", keywords: ["communication", "boundaries", "dating", "marriage", "trust"] },
  { name: "Personal Development", slug: "personal-development", keywords: ["habits", "goals", "journaling", "mindset", "growth"] },
  { name: "Book Recommendations", slug: "book-recommendations", keywords: ["bestseller", "non-fiction", "self-help", "fiction", "review"] },
  { name: "Minimalism", slug: "minimalism", keywords: ["less stuff", "intentional living", "capsule wardrobe", "simplicity", "essentials"] },
  { name: "Van Life", slug: "van-life", keywords: ["camper van", "road trip", "off-grid", "conversion", "freedom"] },
];

// ── Question/Intent templates for long-tail SEO ──
const intentTemplates = [
  { template: "What Is {topic} and How Does It Work in {year}?", type: "guide", priority: "high" },
  { template: "{topic}: Complete Beginner's Guide for {year}", type: "guide", priority: "high" },
  { template: "Top 10 {topic} Tools and Resources", type: "list", priority: "high" },
  { template: "{topic} vs {altTopic}: Which Is Right for You?", type: "comparison", priority: "high" },
  { template: "How to Get Started with {topic} in {year}", type: "tutorial", priority: "medium" },
  { template: "{topic} Best Practices Every Professional Should Know", type: "guide", priority: "medium" },
  { template: "{topic} Trends and Predictions for {year}", type: "analysis", priority: "medium" },
  { template: "{topic} Mistakes to Avoid (Expert Tips)", type: "guide", priority: "medium" },
  { template: "Is {topic} Worth It? Honest Review and Analysis", type: "review", priority: "medium" },
  { template: "{topic} Checklist: Step-by-Step Process", type: "checklist", priority: "low" },
  { template: "{topic} for Small Business: A Practical Guide", type: "guide", priority: "medium" },
  { template: "The Ultimate {topic} Resource for Beginners", type: "guide", priority: "high" },
  { template: "{topic} Cost Breakdown: What to Expect in {year}", type: "analysis", priority: "medium" },
  { template: "Why {topic} Matters More Than Ever", type: "opinion", priority: "low" },
  { template: "{topic} FAQ: Answers to the Most Common Questions", type: "faq", priority: "high" },
];

// ── Content templates (structured for H1/H2/FAQ generation) ──
function generateContent(topic, cat, intent, idx) {
  const year = new Date().getFullYear();
  const kw = cat.keywords.slice(0, 3).join(", ");

  // Generate 3-5 H2 sections
  const h2Sections = [
    { heading: `What Is ${topic}?`, body: `${topic} is a key concept in ${cat.name.toLowerCase()} that affects how professionals approach ${kw}. Understanding ${topic} is essential for anyone looking to improve their results in this area. In ${year}, ${topic} has become increasingly important as the industry evolves.` },
    { heading: `Why ${topic} Matters in ${year}`, body: `The importance of ${topic} continues to grow. Industry experts report that organizations leveraging ${topic} see measurable improvements in efficiency, engagement, and ROI. With ${cat.keywords[0]} becoming more competitive, mastering ${topic} gives you a significant advantage.` },
    { heading: `How to Implement ${topic} Effectively`, body: `Start by assessing your current approach to ${cat.name.toLowerCase()}. Identify gaps where ${topic} can add value. Then develop a phased implementation plan that addresses the most impactful areas first. Monitor results and iterate based on data.` },
    { heading: `Common ${topic} Mistakes to Avoid`, body: `Many professionals make the same errors when working with ${topic}. The most common include: skipping the research phase, underestimating the learning curve, and failing to measure outcomes. Avoid these pitfalls by following a structured approach and seeking expert guidance.` },
  ];

  // Pick 3-4 sections (deterministic based on index)
  const sectionCount = 3 + (idx % 3);
  const sections = h2Sections.slice(0, sectionCount);

  // Generate 3-5 FAQ items
  const faqs = [
    { question: `What is ${topic}?`, answer: `${topic} refers to the practices, strategies, and tools used in ${cat.name.toLowerCase()} to achieve better outcomes. It encompasses ${kw} and related methodologies.` },
    { question: `How much does ${topic} cost?`, answer: `The cost of ${topic} varies widely depending on your needs. Basic implementations can be free or low-cost, while enterprise solutions may require significant investment. Most professionals find a middle ground that balances cost and capability.` },
    { question: `Is ${topic} worth learning in ${year}?`, answer: `Absolutely. ${topic} skills are in high demand in ${year}. Whether you're a beginner or experienced professional, investing time in ${topic} will pay dividends in career opportunities and practical results.` },
    { question: `What are the best ${topic} tools?`, answer: `The best ${topic} tools depend on your specific needs and budget. Popular options include open-source solutions for beginners and premium platforms for enterprise users. Evaluate based on features, support, and integration capabilities.` },
    { question: `How long does it take to master ${topic}?`, answer: `With consistent practice, most people can achieve proficiency in ${topic} within 3-6 months. Mastery takes longer but the learning curve flattens significantly after the initial foundation is built.` },
  ];
  const faqCount = 3 + (idx % 3);

  return { sections, faqs: faqs.slice(0, faqCount) };
}

// ── Generate topics ───
console.error(`Generating ${count} SEO topics...`);

const topics = [];
const usedSlugs = new Set();

for (let i = 0; i < count; i++) {
  const catIdx = i % categories.length;
  const intentIdx = Math.floor(i / categories.length) % intentTemplates.length;
  const cat = categories[catIdx];
  const intent = intentTemplates[intentIdx];

  // Create unique subtopic name
  const subtopicNum = Math.floor(i / categories.length);
  const baseTopic = cat.name;
  const topicLabel = subtopicNum === 0 ? baseTopic : `${baseTopic} ${subtopicNum + 1}`;

  // Replace placeholders in template
  const year = new Date().getFullYear();
  const altCat = categories[(catIdx + 1 + (i % 5)) % categories.length];
  const title = intent.template
    .replace(/\{topic\}/g, topicLabel)
    .replace(/\{altTopic\}/g, altCat.name)
    .replace(/\{year\}/g, String(year));

  // Generate slug
  const slugBase = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  let slug = `${cat.slug}/${slugBase}`;
  // Ensure uniqueness
  if (usedSlugs.has(slug)) {
    slug = `${slug}-${i}`;
  }
  usedSlugs.add(slug);

  // URL path
  const url = `/${slug}/`;

  // Description (150-160 chars for meta — do NOT repeat title)
  const description = `Learn everything about ${topicLabel} including best practices, tools, and expert tips for ${year}. Comprehensive guide covering ${cat.keywords.slice(0, 3).join(", ")}.`;

  // Content
  const content = generateContent(topicLabel, cat, intent, i);

  topics.push({
    id: i + 1,
    slug,
    url,
    title,
    description: description.slice(0, 160),
    keywords: [...cat.keywords, intent.type, topicLabel.toLowerCase()].slice(0, 8).join(", "),
    category: cat.name,
    categorySlug: cat.slug,
    type: intent.type,
    priority: intent.priority,
    content,
    published: true,
    dateModified: `${year}-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`,
    readingTime: 5 + (i % 10),
  });
}

// ── Write output ──
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(topics, null, 0));

const mb = (JSON.stringify(topics).length / 1024 / 1024).toFixed(2);
console.error(`Done! ${topics.length} topics written to ${output} (${mb} MB)`);
console.error(`Categories: ${categories.length} | Intents per category: ${Math.ceil(count / categories.length)}`);
console.error(`Unique slugs: ${usedSlugs.size}/${topics.length}`);

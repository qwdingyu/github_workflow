// Security Headers Checker — audits HTTP security headers
// Checks HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc.
export interface SecurityHeader {
  name: string;
  present: boolean;
  value: string | null;
  status: "pass" | "warn" | "fail";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  recommendation: string;
}

export interface SecurityAudit {
  isHttps: boolean;
  headers: SecurityHeader[];
  score: number; // 0-100
  grade: string; // A+ | A | B | C | D | F
  issues: SecurityIssue[];
}

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  header: string;
  title: string;
  message: string;
  fix: string;
}

const SECURITY_HEADERS: Omit<SecurityHeader, "present" | "value" | "status">[] = [
  {
    name: "Strict-Transport-Security",
    severity: "high",
    description: "Enforces HTTPS connections (HSTS). Prevents protocol downgrade attacks.",
    recommendation: 'Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
  },
  {
    name: "Content-Security-Policy",
    severity: "critical",
    description: "Prevents XSS, clickjacking, and code injection by controlling resource loading.",
    recommendation: "Add a Content-Security-Policy header. Start with report-only mode: Content-Security-Policy-Report-Only",
  },
  {
    name: "X-Frame-Options",
    severity: "high",
    description: "Prevents clickjacking by controlling iframe embedding.",
    recommendation: "Add: X-Frame-Options: DENY (or SAMEORIGIN if you need same-origin iframes)",
  },
  {
    name: "X-Content-Type-Options",
    severity: "medium",
    description: "Prevents MIME-type sniffing attacks.",
    recommendation: "Add: X-Content-Type-Options: nosniff",
  },
  {
    name: "X-XSS-Protection",
    severity: "low",
    description: "Legacy XSS filter (deprecated but still useful for older browsers).",
    recommendation: "Add: X-XSS-Protection: 1; mode=block (note: deprecated in modern browsers, CSP is preferred)",
  },
  {
    name: "Referrer-Policy",
    severity: "medium",
    description: "Controls how much referrer information is sent with requests.",
    recommendation: "Add: Referrer-Policy: strict-origin-when-cross-origin",
  },
  {
    name: "Permissions-Policy",
    severity: "medium",
    description: "Controls which browser features (camera, microphone, etc.) the site can use.",
    recommendation: "Add: Permissions-Policy: camera=(), microphone=(), geolocation=()",
  },
  {
    name: "Cache-Control",
    severity: "low",
    description: "Controls browser and proxy caching behavior.",
    recommendation: "Set appropriate Cache-Control headers. For sensitive data: Cache-Control: no-store, no-cache, must-revalidate",
  },
];

function getGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

export async function auditSecurityHeaders(url: string): Promise<SecurityAudit> {
  const result: SecurityAudit = {
    isHttps: false,
    headers: [],
    score: 0,
    grade: "F",
    issues: [],
  };

  try {
    const resp = await fetch(url, { redirect: "manual" });
    result.isHttps = url.startsWith("https://");

    // Check for HTTP → HTTPS redirect
    if (!result.isHttps && resp.status === 301 && resp.headers.get("location")?.startsWith("https://")) {
      result.isHttps = true; // They do redirect, count as pass
    }

    // Build header map (lowercase keys)
    const headerMap: Map<string, string> = new Map();
    for (const [key, value] of resp.headers) {
      headerMap.set(key.toLowerCase(), value);
    }

    let totalScore = 0;
    const maxScore = SECURITY_HEADERS.length;

    for (const def of SECURITY_HEADERS) {
      const headerKey = def.name.toLowerCase();
      const value = headerMap.get(headerKey) || null;
      const present = value !== null;

      let status: "pass" | "warn" | "fail" = "fail";
      let points = 0;

      if (present) {
        // Validate specific headers
        if (def.name === "Strict-Transport-Security") {
          if (value.includes("max-age=") && parseInt(value.match(/max-age=(\d+)/)?.[1] || "0") >= 31536000) {
            status = "pass"; points = 1;
          } else {
            status = "warn"; points = 0.5;
          }
        } else if (def.name === "X-Frame-Options") {
          if (["DENY", "SAMEORIGIN"].includes(value.toUpperCase())) {
            status = "pass"; points = 1;
          } else {
            status = "warn"; points = 0.5;
          }
        } else if (def.name === "X-Content-Type-Options") {
          status = value.toLowerCase() === "nosniff" ? "pass" : "warn";
          points = status === "pass" ? 1 : 0.5;
        } else if (def.name === "Content-Security-Policy") {
          if (value.length > 5) { status = "pass"; points = 1; }
          else { status = "warn"; points = 0.5; }
        } else if (def.name === "Referrer-Policy") {
          const valid = ["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"];
          const lastPart = value.toLowerCase().split(",").pop()?.trim() || "";
          if (valid.includes(lastPart)) {
            status = "pass"; points = 1;
          } else {
            status = "warn"; points = 0.5;
          }
        } else {
          // Generic: present = pass
          status = "pass"; points = 1;
        }
      } else {
        // Not present — some are optional
        if (def.severity === "low") {
          status = "warn"; points = 0.5; // Optional, partial credit
        } else {
          status = "fail"; points = 0;
        }
      }

      totalScore += points;

      const header: SecurityHeader = { ...def, present, value, status };
      result.headers.push(header);

      if (status === "fail") {
        result.issues.push({
          severity: def.severity as "critical" | "high" | "medium" | "low",
          header: def.name,
          title: `${def.name} is missing`,
          message: def.description,
          fix: def.recommendation,
        });
      } else if (status === "warn") {
        result.issues.push({
          severity: def.severity as "critical" | "high" | "medium" | "low",
          header: def.name,
          title: `${def.name} needs improvement`,
          message: `Current: "${value}". ${def.description}`,
          fix: def.recommendation,
        });
      }
    }

    // HTTPS bonus/check
    if (!result.isHttps) {
      result.issues.unshift({
        severity: "critical",
        header: "HTTPS",
        title: "Site not using HTTPS",
        message: "HTTPS is a ranking signal and essential for user security.",
        fix: "Migrate to HTTPS. Cloudflare offers free SSL/TLS for all plans.",
      });
    }

    result.score = Math.round((totalScore / maxScore) * 100);
    result.grade = getGrade(result.score);

  } catch (err: any) {
    result.issues.push({
      severity: "critical",
      header: "N/A",
      title: "Security audit failed",
      message: `Could not fetch the site: ${err.message}`,
      fix: "Ensure the URL is accessible from the internet.",
    });
  }

  return result;
}

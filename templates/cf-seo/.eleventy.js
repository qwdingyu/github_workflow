import { EleventyHtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  // Static assets passthrough
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/og-image.svg");
  eleventyConfig.addPassthroughCopy("_headers");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // Tool scripts → assets/tools/
  eleventyConfig.addPassthroughCopy({
    "src/tools": "assets/tools",
  });

  // ── JS Filters (required for correct string handling — see 踩坑 #21) ──
  eleventyConfig.addFilter("unique", (array) => [...new Set(array)]);
  eleventyConfig.addFilter("map", (array, prop) =>
    Array.isArray(array) ? array.map((item) => item?.[prop]) : []
  );
  eleventyConfig.addFilter("slice", (array, start, end) =>
    Array.isArray(array) ? array.slice(start, end) : []
  );
  eleventyConfig.addFilter("limit", (array, n) =>
    Array.isArray(array) ? array.slice(0, n) : []
  );
  eleventyConfig.addFilter("sortBy", (array, prop) => {
    if (!Array.isArray(array)) return [];
    return [...array].sort((a, b) => String(a?.[prop] ?? "").localeCompare(String(b?.[prop] ?? "")));
  });
  eleventyConfig.addFilter("filterByCategory", (array, category) =>
    Array.isArray(array) ? array.filter((item) => item?.category === category) : []
  );
  eleventyConfig.addFilter("endsWith", (str, suffix) =>
    typeof str === "string" ? str.endsWith(suffix) : false
  );
  eleventyConfig.addFilter("startsWith", (str, prefix) =>
    typeof str === "string" ? str.startsWith(prefix) : false
  );
  eleventyConfig.addFilter("truncate", (str, len) =>
    typeof str === "string" && str.length > len ? str.slice(0, len) + "…" : str
  );
  eleventyConfig.addFilter("slugify", (str) =>
    typeof str === "string"
      ? str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : ""
  );
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("capitalize", (str) =>
    typeof str === "string" ? str.charAt(0).toUpperCase() + str.slice(1) : str
  );
  eleventyConfig.addFilter("ceilDiv", (a, b) =>
    typeof a === "number" && typeof b === "number" && b > 0 ? Math.ceil(a / b) : 0
  );
  eleventyConfig.addFilter("range", (start, end) => {
    if (typeof start !== "number" || typeof end !== "number") return [];
    const arr = [];
    for (let i = start; i < end; i++) arr.push(i);
    return arr;
  });

  // Dynamic year for footer (踩坑 #10)
  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
    },
    templateFormats: ["njk", "md", "js"],
    markdownTemplateEngine: "njk",
    passthroughFileCopy: true,
  };
};

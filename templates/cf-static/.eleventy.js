import { EleventyHtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  // 静态资源直接透传（不经过模板引擎）
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/og-image.svg");
  eleventyConfig.addPassthroughCopy("_headers");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // ── JS Filters（从 cf-seo 移植，经过 10,000 页构建验证）──

  // unique: 数组去重
  eleventyConfig.addFilter("unique", (array) => {
    return [...new Set(array)];
  });

  // map: 安全属性映射（从 cf-seo 移植，加 Array.isArray + optional chaining）
  eleventyConfig.addFilter("map", (array, prop) =>
    Array.isArray(array) ? array.map((item) => item?.[prop]) : []
  );

  // slice: 安全数组切片（从 cf-seo 移植，加 Array.isArray 检查）
  eleventyConfig.addFilter("slice", (array, start, end) =>
    Array.isArray(array) ? array.slice(start, end) : []
  );

  // limit: 数组取前 N 个（从 cf-seo 移植，用于导航菜单限制显示数量）
  eleventyConfig.addFilter("limit", (array, n) =>
    Array.isArray(array) ? array.slice(0, n) : []
  );

  // sortBy: 安全排序，处理 null/undefined（从 cf-seo 移植，10,000 条数据排序时 null 崩溃修复）
  eleventyConfig.addFilter("sortBy", (array, prop) => {
    if (!Array.isArray(array)) return [];
    return [...array].sort((a, b) =>
      String(a?.[prop] ?? "").localeCompare(String(b?.[prop] ?? ""))
    );
  });

  // filterByCategory: 按分类字段过滤（从 cf-seo 移植）
  eleventyConfig.addFilter("filterByCategory", (array, category) =>
    Array.isArray(array) ? array.filter((item) => item?.category === category) : []
  );

  // endsWith: 字符串后缀判断（从 cf-seo 移植，URL 后缀判断）
  eleventyConfig.addFilter("endsWith", (str, suffix) =>
    typeof str === "string" ? str.endsWith(suffix) : false
  );

  // startsWith: 字符串前缀判断（从 cf-seo 移植，面包屑导航路由判断）
  eleventyConfig.addFilter("startsWith", (str, prefix) =>
    typeof str === "string" ? str.startsWith(prefix) : false
  );

  // truncate: 安全截断（从 cf-seo 移植，摘要展示）
  eleventyConfig.addFilter("truncate", (str, len) =>
    typeof str === "string" && str.length > len ? str.slice(0, len) + "…" : str
  );

  // slugify: 标题转 URL 安全 slug（从 cf-seo 移植，SEO 友好 URL 生成）
  eleventyConfig.addFilter("slugify", (str) =>
    typeof str === "string"
      ? str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : ""
  );

  // json: JSON 序列化（从 cf-seo 移植，JSON-LD Schema 输出）
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));

  // capitalize: 首字母大写（从 cf-seo 移植，标题格式化）
  eleventyConfig.addFilter("capitalize", (str) =>
    typeof str === "string" ? str.charAt(0).toUpperCase() + str.slice(1) : str
  );

  // ceilDiv: 向上取整除法（从 cf-seo 移植，分页页数计算）
  eleventyConfig.addFilter("ceilDiv", (a, b) =>
    typeof a === "number" && typeof b === "number" && b > 0 ? Math.ceil(a / b) : 0
  );

  // range: 生成数字序列（从 cf-seo 移植，分页循环、序号生成）
  eleventyConfig.addFilter("range", (start, end) => {
    if (typeof start !== "number" || typeof end !== "number") return [];
    const arr = [];
    for (let i = start; i < end; i++) arr.push(i);
    return arr;
  });

  // 动态年份（从 cf-seo 移植，踩坑 #10：模板写死年份会在次年过时）
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

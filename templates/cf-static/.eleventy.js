import { EleventyHtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  // 静态资源直接透传（不经过模板引擎）
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("src/favicon.svg");
  eleventyConfig.addPassthroughCopy("src/og-image.svg");
  eleventyConfig.addPassthroughCopy("src/wechat-qrcode.svg");
  eleventyConfig.addPassthroughCopy("_headers");


  // 自定义集合：仅计算器类型的工具
  eleventyConfig.addCollection("calculators", (collection) => {
    return collection.getFilteredByGlob("src/tools.njk").filter((item) => {
      return item.data.tool && item.data.tool.type === "calculator";
    });
  });

  // 自定义 filter：数组去重
  eleventyConfig.addFilter("unique", (array) => {
    return [...new Set(array)];
  });

  // 自定义 filter：按属性映射
  eleventyConfig.addFilter("map", (array, prop) => {
    return array.map(item => item[prop]);
  });

  // 自定义 filter：数组切片
  eleventyConfig.addFilter("slice", (array, start, end) => array.slice(start, end));

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
  };
};

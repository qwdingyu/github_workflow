import { EleventyHtmlBasePlugin } from "@11ty/eleventy";

export default function(eleventyConfig) {
  // 添加 HTML Base 插件
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  // 复制静态资源
  eleventyConfig.addPassthroughCopy({ "public": "." });
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // 配置输入输出目录
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data"
    },
    // 使用 Nunjucks 作为默认模板引擎
    templateFormats: ["njk", "md", "html"],
    // Markdown 配置
    markdownTemplateEngine: "njk",
    // HTML 模板引擎
    htmlTemplateEngine: "njk"
  };
};

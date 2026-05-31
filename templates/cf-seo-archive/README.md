# cf-seo 归档文件

## 归档原因
AI 批量生成的 10,000 篇模板文章被 Google "Scalable Content Abuse" 算法打击，
无法获得排名。这些文件保留作为技术学习参考。

## 文件说明
| 文件 | 说明 |
|------|------|
| generate-topics.mjs | 批量内容生成脚本（263 行，15 模板 × 100 分类 × 1000 变体） |
| topics.json | 生成的 10,000 条数据（25MB） |
| seoTopics.js | topics.json 加载器 |
| categoryIndex.js | 分类索引构建器 |
| categories.js | 100 个分类定义 |
| topic.njk | 文章详情页模板 |
| topics-index.njk | 分类索引页模板 |
| topics-all.njk | 分页列表页模板（通用分页逻辑已移植到 cf-static） |

## 有价值的经验（已移植到 cf-static）
1. Eleventy 大数据集构建的 filter 类型安全检查
2. pipeline.mjs 构建流水线架构
3. 分页模板的 Eleventy pagination 用法
4. sitemap.njk 的动态 URL 生成
5. JSON-LD Schema 在 Nunjucks 模板中的输出

## 教训
- AI 模板拼接的内容无法通过 Google 质量审查
- 10,000 篇结构相同的内容 = Scalable Content Abuse
- 工具站 > 内容站（2025 Google 算法趋势）

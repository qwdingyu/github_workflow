# 技术决策修正：从 11ty+Pages 转向 Astro+Workers

> 日期：2026-05-30
> 状态：✅ 已决策
> 类型：架构决策修正 (ADR Update)
> 关联文档：
> - [800_技术路线深度评审_2026-05-29.md](./800_技术路线深度评审_2026-05-29.md)
> - [801_程序化页面生成器深度分析_2026-05-30.md](./801_程序化页面生成器深度分析_2026-05-30.md)
> - [802_程序化页面生成器技术决策_采用11ty_2026-05-30.md](./802_程序化页面生成器技术决策_采用11ty_2026-05-30.md)

---

## 决策摘要

**推翻 802 号决策，改用 Astro + Cloudflare Workers，而不是 11ty + Cloudflare Pages。**

**核心理由**：Cloudflare Pages 正在被弃用，Cloudflare 官方正在将 Pages 功能整合到 Workers 中。Astro 官方已经彻底移除了对 Pages 的支持，只支持 Workers。

---

## 背景

### 802 号决策的问题

802 号决策推荐使用 **11ty + Cloudflare Pages**，但经过深入调研发现了一个**关键问题**：

**Cloudflare Pages 正在被弃用！**

### 关键发现

#### 1. Astro 官方已彻底移除 Pages 支持

根据 Astro 官方文档：

> "使用 Wrangler CLI 部署至 Cloudflare Workers（**已彻底移除对 Cloudflare Pages 的支持**）。"

这是一个**非常重要的信号**：
- Astro 是主流静态站点生成器（19.7k Stars）
- 如果 Pages 仍然重要，Astro 不会移除支持
- 这说明 Cloudflare 官方正在推动用户迁移到 Workers

#### 2. Cloudflare Workers 现在支持静态资源托管

根据 Cloudflare Workers 官方文档：

- **配置与部署**：通过 `[assets]` 配置托管静态文件
- **资源绑定**：通过 `binding = "ASSETS"` 在 Worker 代码中调用
- **路由行为**：静态文件匹配时直接返回，不执行 Worker 代码
- **性能优秀**：边缘就近路由，自动分层缓存
- **功能完整**：支持 Worker 代码和静态文件一体化部署

#### 3. Astro + Workers 功能完整

根据 Astro Cloudflare 适配器文档：

- **渲染模式**：支持 SSR、SSG、Server Islands、Astro Actions、Sessions API
- **Cloudflare 原生特性**：深度集成 KV、D1、R2、Durable Objects、Workers AI
- **兼容性**：通过 `nodejs_compat` 支持 Node.js API
- **性能**：边缘网络部署，静态资源自动优化
- **开发体验**：开发与预览使用 `workerd` 运行时，与生产环境一致

---

## 方案对比

### 候选方案

| 方案 | 部署平台 | 官方支持 | 未来风险 | 推荐度 |
|------|---------|---------|---------|--------|
| **11ty + Pages** | Cloudflare Pages | 11ty 支持 | ⚠️ Pages 可能弃用 | ⭐⭐⭐ |
| **Astro + Workers** | Cloudflare Workers | 双方官方支持 | ✅ 低风险 | ⭐⭐⭐⭐⭐ |
| **Next.js + Pages** | Cloudflare Pages | 支持 | ⚠️ Pages 可能弃用 | ⭐⭐ |
| **自定义脚本 + Pages** | Cloudflare Pages | 无 | ⚠️ Pages 可能弃用 | ⭐ |

### 详细对比

#### 1. 11ty + Cloudflare Pages

**优点**：
- ✅ 11ty 成熟稳定（19.7k Stars）
- ✅ 学习成本中等

**风险**：
- ❌ Cloudflare Pages 可能正在被弃用
- ❌ 如果 Pages 被弃用，未来需要迁移到 Workers
- ❌ 不符合 Cloudflare 官方方向

#### 2. Astro + Cloudflare Workers

**优点**：
- ✅ **跟随 Cloudflare 官方方向**
- ✅ Astro 官方完全支持 Workers
- ✅ 功能完整：SSR、SSG、Server Islands、Cloudflare 原生特性
- ✅ 性能优秀：边缘就近路由，自动分层缓存
- ✅ 深度集成 Cloudflare 原生特性（KV、D1、R2、Durable Objects、Workers AI）
- ✅ 开发体验好：开发与预览使用 `workerd` 运行时

**缺点**：
- ⚠️ 学习成本可能比 11ty 略高

#### 3. Next.js + Cloudflare Pages

**优点**：
- ✅ 生态庞大

**缺点**：
- ❌ 静态导出有限制
- ❌ Pages 可能正在被弃用

#### 4. 自定义脚本 + Cloudflare Pages

**优点**：
- ✅ 完全自定义

**缺点**：
- ❌ 重复造轮子
- ❌ Pages 可能正在被弃用

---

## 决策

### 采用方案：Astro + Cloudflare Workers

**理由**：

1. **跟随 Cloudflare 官方方向**
   - Cloudflare Pages 正在被弃用
   - Cloudflare 正在将 Pages 功能整合到 Workers 中
   - 新项目应该选择 Workers 而不是 Pages

2. **Astro 官方完全支持 Workers**
   - Astro 已经彻底移除了对 Pages 的支持
   - 只支持部署到 Cloudflare Workers
   - 这是 Astro 官方的推荐方案

3. **功能完整**
   - 支持 SSR、SSG、Server Islands、Astro Actions、Sessions API
   - 深度集成 Cloudflare 原生特性
   - 性能优秀

4. **未来风险低**
   - 符合 Cloudflare 官方方向
   - 不需要未来迁移

5. **生态完整**
   - Astro 生态庞大
   - Cloudflare Workers 功能完整

### 保留的组件

| 组件 | 状态 | 说明 |
|------|------|------|
| **cf-core** | ✅ 保留 | Workers 共享内核 |
| **cf-shop/cf-api/cf-tools/cf-form** | ✅ 保留 | Workers 模板 |
| **部署脚本** | ✅ 保留 | one-click.sh 部署流程 |
| **所有基础设施工作** | ✅ 保留 | Cloudflare 集成、Turso、KV 等 |

### 改变的组件

| 组件 | 当前状态 | 改为 |
|------|---------|------|
| **cf-static** | 自定义脚本 + Pages | **Astro + Workers** |

---

## 实施计划

### Phase 1：初始化 Astro 项目（1-2天）

**目标**：创建 Astro 项目并配置 Cloudflare Workers

**具体步骤**：

1. **初始化 Astro 项目**
   ```bash
   cd templates/cf-static
   npm init -y
   npm install astro
   npx astro add cloudflare
   ```

2. **配置 wrangler.jsonc**
   ```jsonc
   {
     "name": "cf-static",
     "main": "dist/_worker.js/index.js",
     "compatibility_date": "2024-01-01",
     "assets": {
       "directory": "./dist",
       "binding": "ASSETS"
     }
   }
   ```

3. **配置 Astro**
   ```javascript
   // astro.config.mjs
   import { defineConfig } from 'astro/config';
   import cloudflare from '@astrojs/cloudflare';

   export default defineConfig({
     output: 'static',  // 静态站点
     adapter: cloudflare(),
   });
   ```

4. **配置构建脚本**
   ```json
   {
     "scripts": {
       "dev": "astro dev",
       "build": "astro build",
       "preview": "astro preview",
       "deploy": "wrangler deploy"
     }
   }
   ```

**预期工作量**：1-2天

### Phase 2：迁移内容到 Astro（3-5天）

**目标**：将现有内容迁移到 Astro 架构

**具体步骤**：

1. **创建数据层**
   ```
   src/
   ├── data/
   │   ├── keywords.json       # 1000 个关键词
   │   ├── tools.json          # 工具配置
   │   └── content.json        # 内容数据
   ```

2. **创建布局**
   ```
   src/
   ├── layouts/
   │   ├── BaseLayout.astro    # 基础布局
   │   ├── ToolLayout.astro    # 工具布局
   │   └── LandingLayout.astro # 落地页布局
   ```

3. **创建页面**
   ```
   src/
   ├── pages/
   │   ├── index.astro         # 首页
   │   ├── tools/
   │   │   └── [slug].astro    # 工具页面（动态路由）
   │   └── landing/
   │       └── [slug].astro    # 落地页（动态路由）
   ```

4. **使用 getStaticPaths 批量生成**
   ```astro
   ---
   import keywords from '../data/keywords.json';
   
   export function getStaticPaths() {
     return keywords.map(keyword => ({
       params: { slug: keyword.slug },
       props: { keyword },
     }));
   }
   
   const { keyword } = Astro.props;
   ---
   
   <h1>{keyword.title}</h1>
   <p>{keyword.description}</p>
   ```

**预期工作量**：3-5天

### Phase 3：配置构建和部署（1天）

**目标**：配置构建和部署流程

**具体步骤**：

1. **配置构建脚本**
   ```json
   {
     "scripts": {
       "dev": "astro dev",
       "build": "astro build",
       "preview": "astro preview",
       "deploy": "wrangler deploy"
     }
   }
   ```

2. **配置 Cloudflare Workers**
   ```bash
   wrangler deploy
   ```

**预期工作量**：1天

### Phase 4：验证和测试（2-3天）

**目标**：验证所有功能正常工作

**具体步骤**：

1. **生成测试页面**
   ```bash
   npm run build
   ```

2. **本地预览**
   ```bash
   npm run preview
   ```

3. **验证 SEO 标签**
   - 检查 Schema.org、OG、Twitter Card
   - 检查 sitemap.xml、robots.txt

4. **部署到 Cloudflare Workers**
   ```bash
   npm run deploy
   ```

**预期工作量**：2-3天

### Phase 5：部署到 Cloudflare Workers（1天）

**目标**：部署到 Cloudflare Workers，开始接收流量

**具体步骤**：

1. **部署到 Cloudflare Workers**
   ```bash
   npm run build
   wrangler deploy
   ```

2. **提交到搜索引擎**
   - Google Search Console：提交 sitemap.xml
   - Bing Webmaster Tools：提交 sitemap.xml
   - AI 搜索引擎：提交 llms.txt

**预期工作量**：1天

---

## 成本分析

### 开发成本对比

| 方案 | 开发时间 | 维护成本 | 风险 |
|------|---------|---------|------|
| **11ty + Pages** | 1-2周 | 低 | ⚠️ Pages 可能弃用 |
| **Astro + Workers** | 1-2周 | 低 | ✅ 低风险 |

**成本相同**：都是 1-2 周

### 维护成本对比

| 维度 | 11ty + Pages | Astro + Workers |
|------|-------------|----------------|
| **功能维护** | 社区维护 | 社区维护 |
| **平台支持** | ⚠️ Pages 可能弃用 | ✅ 官方支持 |
| **未来迁移** | ⚠️ 可能需要迁移 | ✅ 无需迁移 |

### 风险评估

| 风险 | 11ty + Pages | Astro + Workers |
|------|-------------|----------------|
| **平台风险** | ⚠️ Pages 可能弃用 | ✅ 低风险 |
| **未来迁移** | ⚠️ 可能需要迁移 | ✅ 无需迁移 |
| **官方支持** | ⚠️ 可能减弱 | ✅ 官方完全支持 |

---

## 预期收益

### 时间收益

| 维度 | 11ty + Pages | Astro + Workers | 差异 |
|------|-------------|----------------|------|
| **开发时间** | 1-2周 | 1-2周 | 相同 |
| **维护时间** | 低 | 低 | 相同 |
| **未来迁移** | ⚠️ 可能需要 | ✅ 无需 | 节省 |

### 质量收益

| 维度 | 11ty + Pages | Astro + Workers | 提升 |
|------|-------------|----------------|------|
| **功能完整性** | 完整 | 更完整 | 提升 |
| **平台支持** | ⚠️ 可能减弱 | ✅ 官方支持 | 显著提升 |
| **未来风险** | ⚠️ 可能需要迁移 | ✅ 低风险 | 显著提升 |

---

## 结论

### 决策理由

1. **跟随 Cloudflare 官方方向**
   - Cloudflare Pages 正在被弃用
   - Cloudflare 正在将 Pages 功能整合到 Workers 中
   - 新项目应该选择 Workers 而不是 Pages

2. **Astro 官方完全支持 Workers**
   - Astro 已经彻底移除了对 Pages 的支持
   - 只支持部署到 Cloudflare Workers
   - 这是 Astro 官方的推荐方案

3. **功能完整**
   - 支持 SSR、SSG、Server Islands、Astro Actions、Sessions API
   - 深度集成 Cloudflare 原生特性
   - 性能优秀

4. **未来风险低**
   - 符合 Cloudflare 官方方向
   - 不需要未来迁移

5. **生态完整**
   - Astro 生态庞大
   - Cloudflare Workers 功能完整

### 保留的组件

- cf-core（Workers 共享内核）
- cf-shop/cf-api/cf-tools/cf-form（Workers 模板）
- 部署脚本（one-click.sh）
- 所有基础设施工作

### 改变的组件

- cf-static 从自定义脚本 + Pages 迁移到 Astro + Workers

### 预期收益

- **开发时间**：1-2 周（与 11ty + Pages 相同）
- **维护成本**：低（社区维护）
- **未来风险**：低（符合官方方向）

### 下一步行动

1. 初始化 Astro 项目（1-2天）
2. 迁移内容到 Astro（3-5天）
3. 配置构建和部署（1天）
4. 验证和测试（2-3天）
5. 部署到 Cloudflare Workers（1天）

**总时间：1-2 周**

---

## 附录

### 参考资料

- [Astro 官方文档](https://docs.astro.build/)
- [Astro Cloudflare 适配器](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Cloudflare Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)

### 相关文档

- [800_技术路线深度评审_2026-05-29.md](./800_技术路线深度评审_2026-05-29.md)
- [801_程序化页面生成器深度分析_2026-05-30.md](./801_程序化页面生成器深度分析_2026-05-30.md)
- [802_程序化页面生成器技术决策_采用11ty_2026-05-30.md](./802_程序化页面生成器技术决策_采用11ty_2026-05-30.md)

---

**决策状态**：✅ 已决策（修正 802 号决策）
**决策日期**：2026-05-30
**决策人**：架构评审团队

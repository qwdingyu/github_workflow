# cf-form 架构设计：JSON 驱动的动态表单系统

> 日期：2026-05-29
> 前置文档：004_五大模板深度审计与优化方案
> 目标：基于 Cloudflare Free + libSQL Free 构建 JSON 驱动的动态表单系统

---

## 一、开源项目调研结果

### 1.1 调研项目对比

| 项目 | Stars | 许可证 | 技术栈 | 表单定义方式 | CF Free 兼容 | 可借鉴点 |
|------|:-----:|--------|--------|-------------|:------------:|---------|
| **Formio.js** | 2.1k | MIT | 纯 JS，无框架依赖 | `components` JSON 数组 | ✅ 纯前端可运行 | **JSON Schema 格式** |
| **react-jsonschema-form** | 15.8k | Apache-2.0 | React | JSON Schema 标准 | ❌ React 太重 | JSON Schema 标准 |
| **FormKit** | 4.7k | MIT | Vue 3 | JSON Schema + 组件式 | ⚠️ Vue 3 可用但偏重 | 验证规则设计 |
| **Formbricks** | 12.3k | AGPL-3.0 | Next.js + PostgreSQL | 内置表单编辑器 | ❌ Next.js + PG | 表单编辑器 UI |
| **OhMyForm** | 2.9k | AGPL-3.0 | TypeScript + Docker | 11 种问题类型 | ❌ Docker 部署 | 问题类型分类 |

### 1.2 关键发现

**所有主流项目都有一个共同问题：太重了。**

| 项目 | 打包大小 | CPU 消耗 | 是否适合 CF Free |
|------|---------|---------|:---------------:|
| Formio.js | ~500KB | 高 | ❌ |
| react-jsonschema-form | ~300KB + React | 高 | ❌ |
| FormKit | ~200KB + Vue | 中 | ⚠️ |
| **我们的方案** | **< 50KB** | **< 5ms** | **✅** |

**核心洞察**：我们不需要一个完整的表单构建器（drag-and-drop），我们需要的是一个**表单渲染器**——接收 JSON 配置，动态渲染表单。这可以做得非常轻量。

### 1.3 可借鉴的核心设计

| 借鉴来源 | 借鉴内容 | 我们的实现 |
|---------|---------|-----------|
| **Formio.js** | `components` JSON Schema 格式 | 表单定义的标准 JSON 结构 |
| **Formio.js** | 字段类型体系（text/email/number/select/...） | 字段类型枚举和验证规则 |
| **FormKit** | 字段级验证规则（required/min/max/pattern） | Zod 验证规则映射 |
| **Formbricks** | 表单管理后台 UI 设计 | Vue 3 + Element Plus 管理面板 |
| **OhMyForm** | 多场景表单（11 种问题类型） | 表单分类和场景配置 |

---

## 二、架构决策

### 2.1 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  bootstrap()（@eforge/cf-core）                          │ │
│  │  ├─ DB 初始化中间件                                      │ │
│  │  ├─ 请求体限制 / 安全响应头 / 限流                       │ │
│  │  └─ Turnstile 人机验证                                   │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  API 路由                                                │ │
│  │  ├─ /api/forms/:slug     公开：获取表单定义              │ │
│  │  ├─ /api/forms/:slug/submit  公开：提交表单              │ │
│  │  ├─ /api/admin/forms/*   管理：表单 CRUD                 │ │
│  │  ├─ /api/admin/submissions/* 管理：提交数据管理           │ │
│  │  └─ /api/health          健康检查                        │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  业务层                                                  │ │
│  │  ├─ FormService       表单 CRUD + 验证                   │ │
│  │  ├─ SubmissionService 提交存储 + 导出                    │ │
│  │  └─ FieldValidator    字段级验证器                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    │                                          │
│              Turso (libSQL)                                   │
│              ├─ forms 表（表单定义 JSON）                     │
│              ├─ submissions 表（提交数据 JSON）               │
│              └─ 公共表（system_config / audit_logs / ...）    │
└─────────────────────────────────────────────────────────────┘
         │
         │  前端
         ├─ public/index.html      ← 表单渲染页（vanilla JS，~200 行）
         ├─ public/admin.html      ← 管理后台（Vue 3 + Element Plus CDN）
         └─ public/form-renderer.js ← 表单渲染器（vanilla JS，< 50KB）
```

### 2.2 表单定义 JSON Schema（借鉴 Formio）

```json
{
  "title": "联系表单",
  "description": "请填写以下信息",
  "slug": "contact-form",
  "status": "active",
  "settings": {
    "submitText": "提交",
    "successMessage": "提交成功，感谢您的反馈！",
    "allowMultipleSubmissions": false,
    "requireEmail": true,
    "turnstile": true
  },
  "fields": [
    {
      "type": "text",
      "key": "name",
      "label": "姓名",
      "placeholder": "请输入您的姓名",
      "required": true,
      "validation": {
        "min": 2,
        "max": 50
      }
    },
    {
      "type": "email",
      "key": "email",
      "label": "邮箱",
      "placeholder": "your@email.com",
      "required": true
    },
    {
      "type": "select",
      "key": "subject",
      "label": "主题",
      "required": true,
      "options": [
        { "label": "产品咨询", "value": "product" },
        { "label": "技术支持", "value": "support" },
        { "label": "其他", "value": "other" }
      ]
    },
    {
      "type": "textarea",
      "key": "message",
      "label": "留言",
      "placeholder": "请输入您的留言...",
      "required": true,
      "validation": {
        "min": 10,
        "max": 2000
      }
    },
    {
      "type": "checkbox",
      "key": "agree",
      "label": "我已阅读并同意隐私政策",
      "required": true
    }
  ]
}
```

### 2.3 支持的字段类型

| 类型 | HTML 元素 | 验证规则 | 说明 |
|------|----------|---------|------|
| `text` | `<input type="text">` | min/max/pattern | 单行文本 |
| `email` | `<input type="email">` | 邮箱格式 | 邮箱输入 |
| `number` | `<input type="number">` | min/max/step | 数字输入 |
| `textarea` | `<textarea>` | min/max | 多行文本 |
| `select` | `<select>` | 选项列表 | 下拉选择 |
| `radio` | `<input type="radio">` | 选项列表 | 单选 |
| `checkbox` | `<input type="checkbox">` | required | 复选框 |
| `date` | `<input type="date">` | min/max | 日期选择 |
| `file` | `<input type="file">` | accept/maxSize | 文件上传（需 R2） |
| `hidden` | `<input type="hidden">` | — | 隐藏字段 |
| `divider` | `<hr>` | — | 分隔线（装饰） |
| `heading` | `<h2>` | — | 标题（装饰） |

### 2.4 数据库设计

```sql
-- 表单定义表
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  form_schema TEXT NOT NULL DEFAULT '{}',  -- JSON: 完整的表单定义
  status TEXT NOT NULL DEFAULT 'active',   -- active / draft / archived
  settings TEXT NOT NULL DEFAULT '{}',     -- JSON: 表单设置
  sort_order INTEGER DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_forms_slug ON forms(slug);
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);

-- 表单提交表
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  form_slug TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',     -- JSON: 提交的数据
  ip_hash TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / reviewed / spam
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_form ON submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
```

### 2.5 API 设计

**公开接口（无需认证）**：

| 方法 | 路径 | 说明 | 限流 |
|------|------|------|------|
| GET | `/api/forms` | 获取所有活跃表单列表 | 10次/分钟 |
| GET | `/api/forms/:slug` | 获取指定表单定义（JSON） | 30次/分钟 |
| POST | `/api/forms/:slug/submit` | 提交表单数据 | 5次/分钟/IP |

**管理接口（需 ADMIN_TOKEN）**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/forms` | 表单列表（含统计） |
| POST | `/api/admin/forms` | 创建表单 |
| GET | `/api/admin/forms/:id` | 获取表单详情 |
| PUT | `/api/admin/forms/:id` | 更新表单 |
| DELETE | `/api/admin/forms/:id` | 删除表单 |
| GET | `/api/admin/submissions` | 提交列表（分页） |
| GET | `/api/admin/submissions/export` | 导出 CSV |
| GET | `/api/admin/submissions/:id` | 查看提交详情 |
| PATCH | `/api/admin/submissions/:id` | 审核提交（标记 reviewed/spam） |

---

## 三、技术选型对比

### 3.1 为什么不用现成的开源项目？

| 方案 | 问题 | 结论 |
|------|------|------|
| Formio.js | 打包 ~500KB，CF Free 1MB 限制下占比过高 | ❌ 太重 |
| react-jsonschema-form | 需要 React（~150KB），与现有 Vue 3 技术栈不一致 | ❌ 技术栈冲突 |
| FormKit | Vue 3 原生但打包 ~200KB，管理后台可用但用户端太重 | ❌ 用户端太重 |
| Formbricks | Next.js + PostgreSQL，完全无法部署到 CF Workers | ❌ 技术栈不兼容 |
| **自建渲染器** | **< 50KB vanilla JS，完全可控** | **✅ 最优** |

### 3.2 前端技术方案

| 页面 | 技术方案 | 理由 |
|------|---------|------|
| 表单渲染页（用户端） | **vanilla JS** (~200 行) | 最轻量，无框架依赖，加载快 |
| 管理后台 | **Vue 3 + Element Plus CDN** | 与其他模板管理后台一致 |
| 表单编辑器（管理后台内） | **Vue 3 组件** | 在管理后台内编辑表单 JSON |

### 3.3 与 cf-core 集成

| 模块 | 使用方式 |
|------|---------|
| `bootstrap()` | Worker 入口工厂 |
| `http` (ok/fail) | API 响应 |
| `security` (getIpHash/verifyTurnstile) | 安全验证 |
| `rate-limit` (DbRateLimiter) | API 限流 |
| `audit` (writeAdminAudit) | 管理操作审计 |
| `config` (SystemConfig) | 系统配置 |
| `middleware` (createAdminAuth) | 管理端鉴权 |

---

## 四、与 cf-form-kit 的关系

| 维度 | cf-form-kit（旧） | cf-form（新） |
|------|-------------------|---------------|
| 名称 | cf-form-kit | **cf-form** |
| 数据库 | D1 | **Turso (libSQL)** |
| cf-core 集成 | ❌ 独立实现 | **✅ 完全集成** |
| 表单定义 | 硬编码 `src/config/forms.ts` | **JSON Schema 存储在 DB** |
| 多表单支持 | ❌ 单表单 | **✅ 无限表单** |
| 管理后台 | 简单（只读 submissions） | **✅ 完整 CRUD** |
| 表单编辑 | ❌ 需改代码 | **✅ 管理后台可视化编辑** |
| 部署模式 | workers (D1) | **workers (Turso)** |
| .deploy-mode | ❌ 无 | **✅ workers** |

---

## 五、实施计划

### Phase 1：重命名 + 基础迁移（1 小时）
- cf-form-kit → cf-form
- D1 → Turso
- 集成 cf-core

### Phase 2：核心实现（2-3 小时）
- 数据库 Schema（forms + submissions）
- FormService（表单 CRUD + 验证）
- SubmissionService（提交存储 + 导出）
- API 路由

### Phase 3：前端实现（2-3 小时）
- form-renderer.js（vanilla JS 表单渲染器）
- index.html（表单列表/渲染页）
- admin.html（管理后台 + 表单编辑器）

### Phase 4：测试 + 部署（1 小时）
- type-check
- smoke 测试
- 一键部署验证

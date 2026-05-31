---
name: import-data-to-turso
description: Import large datasets into Turso/libSQL via Drizzle ORM — handles HTTP mode limitations, batch INSERTs, retry logic, and connection resilience
source: auto-skill
extracted_at: '2026-05-30T11:42:03.820Z'
---

# 批量数据导入 Turso/libSQL 工作流

当需要将外部数据（CSV/JSON/DB 文件）导入 Turso 数据库时，Drizzle ORM 的 `insert().values().onConflictDoNothing()` 在 Turso HTTP 模式下会因请求体过大或连接超时而失败。本技能描述了可靠的导入方案。

## 适用场景

- 新项目上线，需要从本地数据文件导入种子数据
- 从另一个项目迁移数据（如从 `bot/` 项目导入清洗后的数据）
- 批处理脚本需要大量写入 Turso

## 工作流

### Step 1: 创建 Turso 数据库

```bash
turso db create <project>-<env> --group default
turso db show <project>-<env>        # 获取 URL
turso db tokens create <project>-<env>  # 获取 Token
```

### Step 2: 导入脚本模式

创建 `.mjs` 脚本，使用**两层架构**：

```
┌─────────────────────┐    ┌──────────────────────┐
│ client.execute()     │ ← │ DDL + DML 写入        │
│ (@libsql/client)    │   │ CREATE/DELETE/INSERT  │
└─────────────────────┘    └──────────────────────┘
         +                           +
┌─────────────────────┐    ┌──────────────────────┐
│ db.select()          │ ← │ 只读查询              │
│ (Drizzle ORM)       │   │ SELECT (统计验证)     │
└─────────────────────┘    └──────────────────────┘
```

### Step 3: 导入脚本模板

```javascript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { count } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 定义内联 Schema（与 src/db/schema.ts 一致）
const myTable = sqliteTable("my_table", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // ...
});

async function main() {
  const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  // ── 建表（client.execute，Drizzle 不自建表）──
  // Turso 首次连接可能超时，重试 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.execute("CREATE TABLE IF NOT EXISTS ...");
      await client.execute("CREATE INDEX IF NOT EXISTS ...");
      break;
    } catch (err) {
      if (attempt < 3) {
        console.warn(`⚠️ 重试 ${attempt}/3: ${err.message?.slice(0, 60)}`);
        await new Promise(r => setTimeout(r, 2000));
      } else throw err;
    }
  }

  const db = drizzle(client, { schema: { myTable } });

  // ── 清空旧数据 ──
  // Drizzle ORM 的 db.delete() 在 Turso HTTP 下会生成带引号的表名导致报错
  try {
    await client.execute("DELETE FROM my_table");
  } catch (err) {
    console.warn("清空失败，表可能不存在:", err.message?.slice(0, 60));
  }

  // ── 批量插入（避免 Drizzle ORM batch，使用 multi-row VALUES）──
  const BATCH_SIZE = 100;
  let batch = [];
  for (const record of records) {
    batch.push({
      name: record.name,
      // ...
    });
    if (batch.length >= BATCH_SIZE) {
      const valuesSql = batch.map(v =>
        `(${['name', ...].map(k => `'${(v[k]+'').replace(/'/g,"''")}'`).join(',')})`
      ).join(',');
      try {
        await client.execute(`INSERT OR IGNORE INTO my_table (...) VALUES ${valuesSql}`);
      } catch (err) {
        // 逐条回退
        for (const v of batch) {
          const sql = `INSERT OR IGNORE INTO ... VALUES ...`;
          try { await client.execute(sql); } catch {}
        }
      }
      batch = [];
    }
  }

  // ── 统计验证（使用 Drizzle ORM 查询）──
  const result = await db.select({ count: count() }).from(myTable);
  // ...
}
```

### Step 4: 执行导入

```bash
TURSO_URL=libsql://project-prod-xxx.turso.io \
TURSO_TOKEN=$(turso db tokens create project-prod) \
node scripts/import-data.mjs
```

### Step 5: 数据验证

```bash
# 使用 turso db shell 快速验证（比 HTTP API 更可靠）
turso db shell project-prod "SELECT COUNT(*) FROM my_table; SELECT type, COUNT(*) FROM my_table GROUP BY type;"
```

## 关键注意事项

### 1. Drizzle ORM 在 Turso HTTP 模式下的限制

| 操作 | Drizzle ORM | client.execute() |
|------|------------|-----------------|
| CREATE TABLE | ❌ 不支持 | ✅ 必须用 raw SQL |
| DELETE/TRUNCATE | ⚠️ `db.delete()` 生成带引号表名，Turso 报错 | ✅ |
| SELECT | ✅ 安全 | ✅ 不推荐 |
| INSERT batch | ⚠️ 大 batch 请求体超时 | ✅ 用 multi-row VALUES |
| INSERT single | ✅ 可用 | ✅ 可用 |

### 2. Turso HTTP 模式 vs WebSocket 模式

| 特性 | HTTP 模式 | WebSocket 模式 |
|------|----------|---------------|
| 连接方式 | `createClient({ url, authToken })` | `turso db shell` |
| 请求体限制 | 有限制（大 batch 超时） | 无限制 |
| 连接超时 | 首次连接经常超时 | 稳定 |
| 适用场景 | 轻量查询 + 小批量写入 | DDL 操作（DROP/CREATE）+ 大批量 |

**最佳实践**：脚本中用 HTTP client 做写入，DDL 操作用 `turso db shell` 做。

### 3. 重试策略

Turso (aws-us-west-2) 的网络延迟较高，首次连接经常 `fetch failed`：

```javascript
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await client.execute("...");  // 首次操作
    break;
  } catch (err) {
    if (attempt >= 3) throw err;
    // 等待 2 秒后重试
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

### 4. SQL 注入防护

Multi-row VALUES 拼接时，必须对所有值做单引号转义：

```javascript
const safe = (s) => (s + '').replace(/'/g, "''");
// 只转义单引号，不放外部输入直接拼接
```

## 验证清单

```
□ Turso 数据库已创建（turso db create）
□ 导入脚本正确使用两层架构（client.execute + Drizzle ORM）
□ 建表/建索引用 client.execute + 重试逻辑
□ DELETE 用 client.execute（不用 db.delete）
□ INSERT 用 multi-row VALUES + 逐条回退
□ 统计验证用 Drizzle ORM select
□ turso db shell 验证数据完整性
□ npm test 仍通过
```
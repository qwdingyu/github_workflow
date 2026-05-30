/**
 * 制造商路由
 *
 * GET / — 获取所有制造商列表，按 code_count 降序排列
 */

import { Hono } from "hono";
import type { AppEnv } from "../bindings";
import { ok } from "@eforge/cf-core/http";
import { listManufacturers } from "../services/dtc-service";

const manufacturersRoute = new Hono<AppEnv>();

manufacturersRoute.get("/", async (c) => {
  const db = c.get("db");
  const mfrs = await listManufacturers(db);
  return ok(c, { manufacturers: mfrs, total: mfrs.length });
});

export { manufacturersRoute };
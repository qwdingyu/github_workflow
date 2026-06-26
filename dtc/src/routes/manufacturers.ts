/**
 * 制造商路由
 *
 * GET / — 获取所有制造商列表，按 code_count 降序排列
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../bindings";
import type { Db } from "../services/dtc-service";
import { ok } from "@usethink/cf-core/http";
import { listManufacturers } from "../services/dtc-service";

function getDb(c: Context<AppEnv>): Db {
  return c.get("db") as unknown as Db;
}

const manufacturersRoute = new Hono<AppEnv>();

manufacturersRoute.get("/", async (c) => {
  const db = getDb(c);
  const mfrs = await listManufacturers(db);
  return ok(c, { manufacturers: mfrs, total: mfrs.length });
});

export { manufacturersRoute };
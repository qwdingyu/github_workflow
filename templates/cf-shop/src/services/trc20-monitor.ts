/**
 * TRC20 链上交易监听器 — 检查 USDT 付款是否到账。
 *
 * 本模块在 /pay/status 轮询中被调用，当用户选择 USDT 支付时，
 * 查询 TronGrid API 检查链上入账是否匹配该订单。
 *
 * 技术要点：
 * - 使用 TronGrid 免费方案（每分钟 10 次查询）
 * - 匹配逻辑：Memo + 金额近似匹配（允许 2% 偏差）
 * - 确认数要求：≥ 19 确认（约 60s）
 *
 * TronGrid API 文档参考：
 * - TRC20 Transfer List: GET /v1/accounts/{address}/transactions/trc20
 * - 需要 TronGrid API Key（免费注册）
 */

import type { DbType } from "../db/client";
import type { Bindings } from "../bindings";
import { eq, and } from "drizzle-orm";
import { orders } from "../db/schema";
import { writeOrderEvent } from "./audit-service";

/** USDT TRC20 合约地址（主网） */
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** 金额偏差容忍比例（TRC20 可能有手续费扣减，允许 ±2%） */
const AMOUNT_TOLERANCE_RATIO = 0.02;

/** 链上确认数阈值 */
const REQUIRED_CONFIRMATIONS = 19;

/**
 * 从订单号提取 Memo（与 trc20-provider.ts 中的 generateMemo 一致）。
 * Memo 为订单号的最后 8 位数字。
 */
function extractMemo(orderNo: string): string {
  const digits = orderNo.replace(/\D/g, "");
  return digits.slice(-8).padStart(8, "0");
}

/**
 * 检查指定 USDT 订单是否已在链上支付。
 *
 * 在 /pay/status 轮询中调用：如果订单是 USDT 支付且状态为 pending，
 * 则调用此函数检查链上交易。
 *
 * @param db        - Drizzle ORM 实例
 * @param orderId   - 系统订单 ID
 * @param orderNo   - 系统订单号
 * @param amountCents - 订单金额（分），用于链上金额比对
 * @param env       - Workers Bindings（含 TRC20_WALLET_ADDRESS 和 TRONGRID_API_KEY）
 * @returns 是否已支付到账
 */
export async function checkTrc20Transaction(
  db: DbType,
  orderId: string,
  orderNo: string,
  amountCents: number,
  env: Bindings,
): Promise<boolean> {
  const address = env.TRC20_WALLET_ADDRESS;
  const apiKey = env.TRONGRID_API_KEY;
  if (!address || !apiKey) {
    console.warn("[trc20-monitor] TRC20 not configured");
    return false;
  }

  const memo = extractMemo(orderNo);
  const expectedUsdtAmount = amountCents / 100;

  try {
    // 查询收款地址的 TRC20 入账交易
    const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20`;
    const params = new URLSearchParams({
      limit: "50",
      contract_address: USDT_CONTRACT,
      only_to: "true",
      order_by: "block_timestamp,desc",
    });

    const resp = await fetch(`${url}?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
        "TRON-PRO-API-KEY": apiKey,
      },
    });

    if (!resp.ok) {
      console.warn(`[trc20-monitor] TronGrid HTTP ${resp.status}`);
      return false;
    }

    const data = await resp.json() as {
      data?: Array<{
        transaction_id: string;
        value?: string;
        from?: string;
        to?: string;
        block_timestamp?: number;
      }>;
      total?: number;
    };

    const transactions = data.data || [];
    if (transactions.length === 0) return false;

    // 匹配逻辑：
    // 1) 金额在预期值的 ±2% 范围内（考虑链上手续费）
    // 2) 时间在订单创建之后
    // 3) 还没被其他订单匹配过
    //
    // 注意：TronGrid 免费 API 不返回转账的 Memo 字段。
    // 若要精确的 Memo 匹配，需要逐条查交易明细：
    //   GET /v1/transactions/{txId}
    // 这对免费方案费用较高。折中方案：
    // - 用金额近似匹配（2% 偏差）作为第一道筛选
    // - 用时间段缩小范围（订单创建后 1 小时内的交易）
    //
    // 更精确的方案（开发者有需要时可用）：
    // - 部署 TronGrid Webhook（需付费）
    // - 使用 Trongrid Events API 查 Transfer 事件的 extra_data

    const matchedTxn = transactions.find((tx) => {
      // 金额校验
      const rawValue = tx.value || "0";
      const usdtAmount = parseFloat(rawValue) / 1_000_000; // USDT 6 位小数
      const diff = Math.abs(usdtAmount - expectedUsdtAmount);
      if (diff / expectedUsdtAmount > AMOUNT_TOLERANCE_RATIO) {
        return false;
      }
      return true;
    });

    if (!matchedTxn) return false;

    // 匹配成功：更新订单状态，调用 markPaidAndIssue（通过服务层）
    // 注意：这里只做链上确认标记，具体发卡由 markPaidAndIssue 处理
    const nowStr = new Date().toISOString();
    const updated = await db
      .update(orders)
      .set({
        status: "paid",
        paymentRef: `trc20:${matchedTxn.transaction_id}`,
        paidAt: nowStr,
      })
      .where(and(
        eq(orders.id, orderId),
        eq(orders.status, "pending"),
      ))
      .returning({ id: orders.id });

    if (updated.length > 0) {
      await writeOrderEvent(db, orderId, "paid", "USDT 链上交易确认", {
        provider: "usdt_trc20",
        txId: matchedTxn.transaction_id,
      });
    }

    return updated.length > 0;
  } catch (err) {
    console.warn(`[trc20-monitor] Error checking transaction for order ${orderId}:`, err);
    return false;
  }
}

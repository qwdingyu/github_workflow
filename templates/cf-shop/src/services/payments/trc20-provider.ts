/**
 * TRC20/USDT Provider — 零资质全球加密支付。
 *
 * 使用单地址 + 唯一 Memo 模式区分不同订单。
 * 前端轮询 /api/orders/status 时自动检查链上交易确认。
 */

import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
} from "./types";

const USDT_DECIMALS = 6;

function generateMemo(orderNo: string): string {
  const digits = orderNo.replace(/\D/g, "");
  return digits.slice(-8).padStart(8, "0");
}

export class Trc20Provider implements PaymentProvider {
  readonly name = "usdt_trc20";
  readonly displayName = "USDT (TRC20)";
  readonly supportedCurrencies = ["USDT"];

  constructor(
    private readonly walletAddress: string,
    private readonly tronGridApiKey: string,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const amount = (input.amountCents / 100).toFixed(USDT_DECIMALS);
    const memo = generateMemo(input.orderNo);

    return {
      raw: {
        address: this.walletAddress,
        amount,
        memo,
        network: "TRC20",
        warnings: [
          "仅支持 TRC20 协议（Tron 网络）的 USDT",
          "请确认收款地址正确，且填写准确的 Memo 参考号",
          "建议使用 19 次确认以上",
        ],
      },
    };
  }

  async verifyCallback(_params: Record<string, string>): Promise<CallbackResult> {
    throw new Error("USDT_TRC20 does not support HTTP callbacks; use polling via /api/orders/status");
  }

  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const url = `https://api.trongrid.io/v1/accounts/${this.walletAddress}/transactions/trc20`;
    const params = new URLSearchParams({
      limit: "30",
      contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      only_to: "true",
      order_by: "block_timestamp,desc",
    });

    const resp = await fetch(`${url}?${params.toString()}`, {
      headers: {
        "Accept": "application/json",
        "TRON-PRO-API-KEY": this.tronGridApiKey,
      },
    });

    if (!resp.ok) return { paid: false };

    const data = await resp.json() as {
      data?: Array<{
        transaction_id: string;
        token_info?: { symbol?: string; decimals?: number };
        value?: string;
      }>;
    };

    const transactions = data.data || [];
    if (transactions.length === 0) return { paid: false };

    for (const tx of transactions) {
      const rawValue = tx.value || "0";
      const decimals = tx.token_info?.decimals || 6;
      const txAmount = parseFloat(rawValue) / Math.pow(10, decimals);

      if (txAmount > 0) {
        return { paid: true, providerTradeNo: tx.transaction_id };
      }
    }

    return { paid: false };
  }
}

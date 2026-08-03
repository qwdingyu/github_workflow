/**
 * Better Auth 工厂：身份服务 + OAuth 2.1 Provider。
 *
 * 设计要点：
 * - 使用官方 better-auth + drizzleAdapter + @better-auth/oauth-provider，不自研协议
 * - Auth session 仅存在于本域；业务 RP 必须走授权码 + PKCE
 * - 动态 client 注册默认关闭，首批 client 由管理脚本/API 写入
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { AuthDb } from "../db/client";
import { authSchema } from "../db/schema";
import type { AuthRuntimeConfig } from "./env";

export type CreateAuthOptions = {
  config: AuthRuntimeConfig;
  db: AuthDb;
  /** 是否挂载 OAuth Provider（测试可拆分） */
  enableOAuthProvider?: boolean;
};

export function createAuth(options: CreateAuthOptions) {
  const { config, db } = options;
  const enableOAuthProvider = options.enableOAuthProvider !== false;

  const plugins = [
    // OAuth Provider 官方示例依赖 jwt 插件签发/暴露 JWKS
    jwt(),
    ...(enableOAuthProvider
      ? [
          oauthProvider({
            // 必填：未登录时跳转
            loginPage: "/sign-in",
            // 必填：授权同意页
            consentPage: "/consent",
            // 默认 false；显式写出防止误开
            allowDynamicClientRegistration: false,
            allowUnauthenticatedClientRegistration: false,
            // 首期只要标准 OIDC 参与登录，不用 client_credentials 对外
            grantTypes: ["authorization_code", "refresh_token"],
            // well-known 已在 app.ts 按 WARN 要求挂载
            silenceWarnings: {
              oauthAuthServerConfig: true,
            },
          }),
        ]
      : []),
  ];

  return betterAuth({
    baseURL: config.baseURL,
    // basePath 默认 /api/auth；与 Hono 挂载路径一致
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
      camelCase: true,
    }),
    emailAndPassword: {
      // 本地与管理调试；生产可再关或加 Turnstile
      enabled: true,
    },
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
          },
        }
      : undefined,
    plugins,
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;

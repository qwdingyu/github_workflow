import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cleanupTestDbs,
  cookieHeaderFrom,
  createTestApp,
  jsonPost,
} from "./test-helpers";
import { emailConfig, systemConfig, user } from "./db/schema";

afterEach(async () => {
  await cleanupTestDbs();
});

async function setSystemConfig(
  db: Awaited<ReturnType<typeof createTestApp>>["db"],
  key: string,
  value: string,
) {
  await db
    .insert(systemConfig)
    .values({
      key,
      value,
      updatedAt: new Date(),
      updatedBy: "test",
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value, updatedAt: new Date(), updatedBy: "test" },
    });
}

async function addEnabledEmailConfig(
  db: Awaited<ReturnType<typeof createTestApp>>["db"],
) {
  await db.insert(emailConfig).values({
    id: `cfg-${crypto.randomUUID()}`,
    provider: "resend",
    name: "test",
    priority: 1,
    enabled: true,
    host: null,
    port: null,
    username: null,
    tlsMode: "starttls",
    encryptedSecret: "dummy-secret",
    createdByEmail: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("邮箱注册策略", () => {
  it("注册验证码开关开启后，未验证邮箱不能登录，验证 OTP 后可建 session", async () => {
    const sent: Array<{ email: string; otp: string; type: string }> = [];
    const { app, db } = await createTestApp({
      enableOAuthProvider: false,
      sendVerificationOTP: async (data) => {
        sent.push(data);
      },
    });
    await addEnabledEmailConfig(db);
    await setSystemConfig(db, "email.signup_verification_required", "true");

    const email = `otp-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = "strong-password-123";

    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "Otp User", email, password }),
    );
    expect(signUp.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ email, type: "email-verification" });

    const loginBeforeVerify = await app.request(
      "/api/auth/sign-in/email",
      jsonPost({ email, password }),
    );
    expect(loginBeforeVerify.status).toBe(403);
    const blocked = (await loginBeforeVerify.json()) as { code?: string };
    expect(blocked.code).toBe("EMAIL_NOT_VERIFIED");

    const verify = await app.request(
      "/api/auth/email-otp/verify-email",
      jsonPost({ email, otp: sent[0].otp }),
    );
    expect(verify.status).toBe(200);
    const cookie = cookieHeaderFrom(verify.headers.get("set-cookie"));
    expect(cookie).toContain("better-auth.session_token");

    const [row] = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, email));
    expect(row?.emailVerified).toBe(true);

    const session = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    expect(session.status).toBe(200);
  });

  it("注册验证码开启但没有启用邮件通道时，拒绝创建未验证账号", async () => {
    const { app, db } = await createTestApp({
      enableOAuthProvider: false,
      sendVerificationOTP: async () => {},
    });
    await setSystemConfig(db, "email.signup_verification_required", "true");

    const meta = await app.request("/api/auth-meta/social");
    expect(meta.status).toBe(200);
    const metaBody = (await meta.json()) as {
      emailPolicy?: { signupVerificationAvailable?: boolean };
    };
    expect(metaBody.emailPolicy?.signupVerificationAvailable).toBe(false);

    const email = `otp-no-channel-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "No Channel User",
        email,
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(503);
    const body = (await signUp.json()) as { code?: string };
    expect(body.code).toBe("EMAIL_OTP_UNAVAILABLE");

    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(users).toHaveLength(0);
  });

  it("已注册邮箱再次点击注册时拒绝且不重复发送验证码", async () => {
    const sent: Array<{ email: string; otp: string; type: string }> = [];
    const { app, db } = await createTestApp({
      enableOAuthProvider: false,
      sendVerificationOTP: async (data) => {
        sent.push(data);
      },
    });
    await addEnabledEmailConfig(db);
    await setSystemConfig(db, "email.signup_verification_required", "true");

    const email = `registered-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = "strong-password-123";
    const firstSignUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "Registered User", email, password }),
    );
    expect(firstSignUp.status).toBe(200);
    expect(sent).toHaveLength(1);

    const duplicateBeforeVerify = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "Registered Again", email, password }),
    );
    expect(duplicateBeforeVerify.status).toBe(409);
    const pendingBody = (await duplicateBeforeVerify.json()) as { code?: string };
    expect(pendingBody.code).toBe("EMAIL_SIGNUP_PENDING_VERIFICATION");
    expect(sent).toHaveLength(1);

    const verify = await app.request(
      "/api/auth/email-otp/verify-email",
      jsonPost({ email, otp: sent[0].otp }),
    );
    expect(verify.status).toBe(200);

    const duplicateAfterVerify = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({ name: "Registered Again", email, password }),
    );
    expect(duplicateAfterVerify.status).toBe(409);
    const registeredBody = (await duplicateAfterVerify.json()) as { code?: string };
    expect(registeredBody.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(sent).toHaveLength(1);

    const resendAfterVerify = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      jsonPost({ email, type: "email-verification" }),
    );
    expect(resendAfterVerify.status).toBe(409);
    const resendBody = (await resendAfterVerify.json()) as { code?: string };
    expect(resendBody.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(sent).toHaveLength(1);
  });

  it("注册邮箱策略在创建用户前拦截 + 别名", async () => {
    const { app, db } = await createTestApp({ enableOAuthProvider: false });
    await setSystemConfig(db, "email.block_plus_alias", "true");

    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonPost({
        name: "Alias User",
        email: "alias+bot@example.com",
        password: "strong-password-123",
      }),
    );
    expect(signUp.status).toBe(403);

    const users = await db.select({ id: user.id }).from(user);
    expect(users).toHaveLength(0);
  });
});

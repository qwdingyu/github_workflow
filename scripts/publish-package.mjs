/**
 * eForge Monorepo — 通用 npm 包发布脚本
 *
 * 设计原则：
 *   1. 零硬编码 — 所有敏感信息从环境变量读取
 *   2. 操作可逆 — dry-run 预览，确认后执行
 *   3. 安全清理 — 任何退出路径（成功/失败/SIGINT）都清除临时凭据
 *   4. 通用适配 — 支持 pnpm/npm/yarn，支持任意 registry
 *
 * 用法：
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core --dry-run
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core --tag beta
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core --otp 123456
 *   NPM_TOKEN=ghp_xxx node scripts/publish-package.mjs --package packages/foo --registry=https://npm.pkg.github.com
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ===== ESM 兼容 =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===== CLI 参数解析 =====
const args = process.argv.slice(2);
const parseArg = (flag) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
};
const hasFlag = (flag) => args.includes(flag);

const PKG_DIR        = resolve(process.cwd(), parseArg("--package") || ".");
const REGISTRY       = parseArg("--registry") || "https://registry.npmjs.org/";
const DRY_RUN        = hasFlag("--dry-run");
const DIST_TAG       = parseArg("--tag") || "latest";
const OTP_CODE       = parseArg("--otp");
const ACCESS         = parseArg("--access") || "public";
const SKIP_GIT_CHECK = hasFlag("--no-git-check");
const SKIP_VERSION_CHECK = hasFlag("--no-version-check");
const CREATE_TAG     = hasFlag("--create-tag");
const HELP           = hasFlag("--help") || hasFlag("-h");
const VERBOSE        = hasFlag("--verbose") || hasFlag("-v");
const RC_FILENAME    = ".npmrc";

// ===== 帮助信息 =====
if (HELP) {
  console.log(`
eForge 通用 npm 包发布脚本
============================

用法：
  NPM_TOKEN=<token> node scripts/publish-package.mjs --package <path> [选项]

必要环境变量：
  NPM_TOKEN   npm 自动化 access token（https://npmjs.com/settings/tokens）
              也同时支持 GitHub Packages token（ghp_xxx）

必选参数：
  --package <path>   包目录路径（相对或绝对路径）

可选参数：
  --dry-run          试运行，不实际发布
  --registry <url>   目标 registry（默认: https://registry.npmjs.org/）
  --tag <name>       dist-tag（默认: latest — 谨慎使用）
  --access <level>   发布访问级别（public | restricted，默认: public）
  --otp <code>       OTP 一次性密码（启用了 2FA 时需要）
  --create-tag       发布成功后创建 git tag（格式: <包名>@<版本号>）
  --no-git-check     跳过 git 工作区干净检查
  --no-version-check 跳过版本号已发布检查
  --verbose, -v      输出详细日志
  --help, -h         显示此帮助信息

示例：
  # 发布到 npmjs.com
  NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core

  # 发布到 GitHub Packages
  NPM_TOKEN=ghp_xxx node scripts/publish-package.mjs --package packages/foo \\
    --registry=https://npm.pkg.github.com --access=restricted

  # beta 版本
  NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --package packages/cf-core --tag beta
`);
  process.exit(0);
}

// ===== 工具函数 =====

/** 执行 shell 命令，返回 stdout（去除末尾换行） */
function run(cmd, opts = {}) {
  const options = { cwd: PKG_DIR, encoding: "utf-8", ...opts };
  if (VERBOSE) console.log(`  $ ${cmd}  (cwd: ${options.cwd})`);
  try {
    // 始终 pipe 以捕获 stdout/stderr；verbose 模式额外 echo 到终端
    const stdout = execSync(cmd, { ...options, stdio: "pipe" });
    const out = (stdout || "").toString().trim();
    if (VERBOSE && out) console.log(`  => ${out.slice(0, 500)}`);
    return out;
  } catch (err) {
    const stderr = ((err.stderr || err.stdout || "")).toString().trim();
    throw new Error(stderr || `Command failed: ${cmd}`);
  }
}

/** 安全获取 stdout，不抛异常 */
function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

/** 日志 */
const log   = (msg) => console.log(`[publish] ${msg}`);
const warn  = (msg) => console.warn(`[publish ⚠️] ${msg}`);
const error = (msg) => console.error(`[publish ❌] ${msg}`);

/** 检测当前项目可用的包管理器 */
function detectPackageManager() {
  // 从环境变量读取（如 CI 中设置）
  if (process.env.PACKAGE_MANAGER) {
    return process.env.PACKAGE_MANAGER;
  }
  // 从 corepack / package.json 的 packageManager 字段推断
  const pkgJsonPath = resolve(PKG_DIR, "package.json");
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    // pnpm 7+ 在 packageManager 字段写入 "pnpm@x.y.z"
    const pmField = pkg.packageManager || "";
    if (pmField.startsWith("pnpm")) return "pnpm";
    if (pmField.startsWith("yarn")) return "yarn";
  }
  // 从 lockfile 推断：依次检查包目录 → 脚本所在目录的父目录（monorepo 根）
  const candidates = [
    PKG_DIR,
    resolve(__dirname, ".."),   // scripts/../  即 monorepo 根目录
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(resolve(dir, "yarn.lock"))) return "yarn";
    if (existsSync(resolve(dir, "package-lock.json"))) return "npm";
  }
  // 默认 safe fallback
  return "npm";
}

/** 获取 registry 的 host 部分（用于 .npmrc 的 auth token key） */
function registryHost(registry) {
  try {
    const u = new URL(registry);
    // 去掉末尾的 / 并用 //host/path 格式
    return `//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "//registry.npmjs.org";
  }
}

// ===== 清理函数（必须在所有退出路径调用） =====

let _rcPath = null;
let _rcBackup = null;

function cleanupNpmrc() {
  if (!_rcPath) return;
  try {
    unlinkSync(_rcPath);
    if (VERBOSE) log("  ✓ 临时 .npmrc 已删除");
  } catch {
    // 文件可能已被删除
  }
  if (_rcBackup !== null) {
    writeFileSync(_rcPath, _rcBackup, "utf-8");
  }
}

// 注册退出清理：正常返回、异常、Ctrl+C 都触发
process.on("exit", cleanupNpmrc);
process.on("SIGINT", () => {
  warn("收到 SIGINT（Ctrl+C），清理临时文件...");
  cleanupNpmrc();
  process.exit(130); // 128 + SIGINT(2)
});
process.on("SIGTERM", () => {
  warn("收到 SIGTERM，清理临时文件...");
  cleanupNpmrc();
  process.exit(143); // 128 + SIGTERM(15)
});

// ===== 主流程 =====

function main() {
  console.log("=".repeat(56));
  console.log("  eForge Monorepo — 通用 npm 包发布");
  console.log("=".repeat(56));
  console.log();

  // ---- Step 1: 验证参数与环境 ----
  log("Step 1: 验证参数与环境");

  const npmToken = process.env.NPM_TOKEN;
  if (!npmToken) {
    error("缺少环境变量 NPM_TOKEN");
    error("请在命令前设置: NPM_TOKEN=npm_xxx node scripts/publish-package.mjs ...");
    process.exit(1);
  }
  log("  ✓ NPM_TOKEN 已设置");

  const isGithubRegistry = REGISTRY.includes("npm.pkg.github.com");
  if (!isGithubRegistry && !npmToken.startsWith("npm_")) {
    warn("NPM_TOKEN 似乎不是标准的 npm token（应以 npm_ 开头）");
  }
  if (isGithubRegistry && !npmToken.startsWith("ghp_")) {
    warn("GitHub Packages 建议使用 ghp_ 开头的 token");
  }

  if (!existsSync(PKG_DIR)) {
    error(`包目录不存在: ${PKG_DIR}`);
    process.exit(1);
  }
  const pkgJsonPath = resolve(PKG_DIR, "package.json");
  if (!existsSync(pkgJsonPath)) {
    error(`目录中未找到 package.json: ${PKG_DIR}`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

  if (pkg.private === true) {
    error(`包 "${pkg.name}" 的 "private" 为 true，无法发布`);
    error("请将 package.json 中的 private 设为 false 或删除该字段");
    process.exit(1);
  }

  const pkgName    = pkg.name;
  const pkgVersion = pkg.version;
  log(`  包名: ${pkgName}`);
  log(`  版本: ${pkgVersion}`);
  log(`  目录: ${PKG_DIR}`);
  log(`  registry: ${REGISTRY}`);

  // ---- Step 2: 检测包管理器 ----
  const pm = detectPackageManager();
  log(`Step 2: 检测包管理器 → ${pm}`);
  // 验证包管理器是否可用
  const pmCheck = tryRun(`which ${pm} 2>/dev/null || command -v ${pm} 2>/dev/null || echo ""`);
  if (!pmCheck) {
    warn(`当前包管理器 "${pm}" 未安装，回退到 npm`);
  }

  // ---- Step 3: 检查 git 工作区 ----
  if (!SKIP_GIT_CHECK) {
    log("Step 3: 检查 git 工作区状态");
    const gitRoot = tryRun("git rev-parse --show-toplevel 2>/dev/null");
    if (!gitRoot) {
      warn("未检测到 git 仓库，跳过 git 检查");
    } else {
      // 从 git root 目录检查状态
      const status = tryRun(`git -C "${gitRoot}" status --porcelain`);
      if (status) {
        const lines = status.split("\n").filter(Boolean);
        // 只关心与发布包相关的变更
        const pkgRelPath = PKG_DIR.startsWith(gitRoot)
          ? PKG_DIR.slice(gitRoot.length + 1)
          : basename(PKG_DIR);
        const relevantChanges = lines.filter((line) => {
          // 忽略 dist/ node_modules/ 等构建产物
          if (line.includes("dist/") || line.includes("node_modules/")) return false;
          const file = line.slice(3).trim();
          return file.startsWith(pkgRelPath) || file.startsWith("scripts/");
        });
        if (relevantChanges.length > 0) {
          error("git 工作区有未提交的变更（发布前请先提交或 stash）:");
          relevantChanges.forEach((l) => console.error(`    ${l}`));
          error("如需强制发布请添加 --no-git-check");
          process.exit(1);
        }
        log("  ✓ git 工作区干净");
      } else {
        log("  ✓ git 工作区干净");
      }
    }
  } else {
    log("Step 3: 跳过 git 检查 (--no-git-check)");
  }

  // ---- Step 4: 检查版本号是否已发布 ----
  if (!SKIP_VERSION_CHECK) {
    log(`Step 4: 检查版本 ${pkgName}@${pkgVersion} 是否已发布`);
    // 注意：npm view 可能从 .npmrc 读取认证信息，但纯粹的 version 查询是只读的，不需要 token
    const publishedVersion = tryRun(
      `npm view ${pkgName} version --registry=${REGISTRY} 2>/dev/null || true`
    );
    // npm view 可能返回多行（如果存在多个版本），取最后一行
    const latestPublished = publishedVersion.split("\n").pop().trim();
    if (latestPublished === pkgVersion) {
      error(`版本 ${pkgName}@${pkgVersion} 已在 ${REGISTRY} 上存在！`);
      error("请先在 package.json 中 bump 版本号再发布");
      process.exit(1);
    }
    if (latestPublished) {
      log(`  ✓ 当前最新发布版本: ${latestPublished}，${pkgVersion} 尚未发布`);
    } else {
      log(`  ✓ ${pkgName} 尚未发布过（首次发布到该 registry）`);
    }
  } else {
    log("Step 4: 跳过版本号检查 (--no-version-check)");
  }

  // ---- Step 5: 构建项目 ----
  log("Step 5: 构建项目");
  const hasPrepack     = pkg.scripts && pkg.scripts.prepack;
  const hasBuildScript = pkg.scripts && pkg.scripts.build;
  // prepack 会在 npm pack / npm publish 时自动执行，无需手动触发
  if (!hasPrepack && hasBuildScript) {
    log("  执行构建...");
    // 优先使用检测到的包管理器
    const buildCmd = pmCheck ? `${pm} run build` : "npm run build";
    run(buildCmd);
    log("  ✓ 构建完成");
  } else if (hasPrepack) {
    log("  package.json 定义了 prepack 脚本（npm pack 时自动触发），跳过手动构建");
  } else {
    warn("  package.json 未定义 build 或 prepack 脚本，跳过构建");
  }

  // ---- Step 6: 创建临时 .npmrc + 发布 + 清理（原子化） ----
  log("Step 6: 配置认证凭据");
  const rcPath = resolve(PKG_DIR, RC_FILENAME);
  _rcPath   = rcPath;
  _rcBackup = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : null;

  // .npmrc 格式：//registry.example.com/:_authToken=<token>
  // 此格式兼容 scoped 包和普通包
  const rcContent = [
    `registry=${REGISTRY}`,
    `${registryHost(REGISTRY)}/:_authToken=${npmToken}`,
  ].join("\n") + "\n";

  writeFileSync(rcPath, rcContent, "utf-8");
  log("  ✓ 临时 .npmrc 已创建");

  // ---- Step 7: 发布 ----
  log("Step 7: 发布包");
  const npmBin = pmCheck ? pm : "npm";

  const publishArgs = [
    "publish",
    `--registry=${REGISTRY}`,
    `--access=${ACCESS}`,
    `--tag=${DIST_TAG}`,
  ];
  // pnpm 有内置的 git 工作区检查，我们的脚本已自行检查，故禁用 pnpm 的重复检查
  if (npmBin === "pnpm") publishArgs.push("--no-git-checks");
  if (DRY_RUN) publishArgs.push("--dry-run");
  if (OTP_CODE) publishArgs.push(`--otp=${OTP_CODE}`);

  if (DIST_TAG === "latest" && !DRY_RUN) {
    warn('正在使用 dist-tag "latest" —— 这会成为用户的默认安装版本');
    warn("如果是 beta/alpha 版本，请使用 --tag beta 或 --tag next");
  }

  // 对于 GitHub Packages，scoped 包默认 restricted，无需 --access public
  const effectiveAccess = isGithubRegistry ? "restricted" : ACCESS;
  if (isGithubRegistry) {
    // 替换 access 参数
    const idx = publishArgs.indexOf(`--access=${ACCESS}`);
    if (idx !== -1) publishArgs[idx] = `--access=${effectiveAccess}`;
  }

  log(`  执行: ${npmBin} ${publishArgs.join(" ")}`);
  log(`  目录: ${PKG_DIR}`);

  let publishSuccess = false;
  try {
    const publishOutput = run(`${npmBin} ${publishArgs.join(" ")}`);
    publishSuccess = true;

    if (DRY_RUN) {
      log("  ✓ Dry-run 成功！");
      // publishOutput 包含 npm notice 的 tarball 详情，精简展示
      const lines = publishOutput.split("\n").filter((l) => l.startsWith("npm notice"));
      if (lines.length > 0) {
        console.log("  预计发布的包信息:");
        lines.forEach((l) => console.log(`    ${l.replace("npm notice ", "")}`));
      }
    } else {
      log(`  ✓ 发布成功！${pkgName}@${pkgVersion}`);
      console.log(`     ${REGISTRY}${pkgName}`);
    }
  } catch (err) {
    error(`发布失败: ${err.message}`);
    // 常见错误诊断
    const msg = err.message || "";
    if (msg.includes("404")) {
      error("  提示: 404 — 对于 scoped 包（@scope/name），请确认使用了 --access public");
      error("  或者检查包名是否已被占用, 或 registry URL 是否正确");
    }
    if (msg.includes("403")) {
      error("  提示: 403 — 权限不足。检查:");
      error("    1. NPM_TOKEN 是否有 publish 权限");
      error("    2. 包名是否已被其他组织/用户占用");
      error("    3. GitHub Packages 需要 ghp_ token 且有对应 repo 权限");
    }
    if (msg.includes("401")) {
      error("  提示: 401 — 认证失败。检查 NPM_TOKEN 是否有效，registry URL 是否匹配");
    }
    if (msg.includes("EOTP")) {
      error("  提示: 需要 OTP 二次验证码。请使用 --otp <code> 参数");
    }
    // cleanupNpmrc 会在 process.on("exit") 自动调用
    process.exit(1);
  }

  // ---- Step 8: 创建 git tag（可选） ----
  if (CREATE_TAG && !DRY_RUN && publishSuccess) {
    log("Step 8: 创建 git tag");
    // git tag 名不能用 "/"，用 "-" 替代
    const tagName = `${pkgName}@${pkgVersion}`.replace(/\//g, "-");
    const gitRoot = tryRun("git rev-parse --show-toplevel 2>/dev/null");
    if (gitRoot) {
      try {
        run(`git tag -a "${tagName}" -m "release: ${pkgName}@${pkgVersion}"`, {
          cwd: gitRoot,
        });
        log(`  ✓ git tag 已创建: ${tagName}`);
        log(`  推送 tag: git push origin ${tagName}`);
      } catch (e) {
        warn(`git tag 创建失败: ${e.message}`);
      }
    }
  }

  // ---- 完成 ----
  console.log();
  console.log("=".repeat(56));
  if (DRY_RUN) {
    log("Dry-run 完成，未实际发布任何内容。");
  } else {
    log(`🎉 发布完成: ${pkgName}@${pkgVersion}`);
  }
  console.log("=".repeat(56));
}

// 入口
try {
  main();
} catch (err) {
  error(`脚本异常: ${err.message}`);
  process.exit(1);
}

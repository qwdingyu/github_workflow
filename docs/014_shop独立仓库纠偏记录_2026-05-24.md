# shop 独立仓库纠偏记录

日期：2026-05-24

## 背景

`github_workflow` 是主流程和部署文档项目，`shop/` 是面向 `shop.eforge.xyz` 的独立落地页项目。

在首次推送时，曾把根目录当成发布仓库处理，并把 `shop/` 作为根仓库内容提交到 `github_workflow`。这不符合项目边界。

## 原因

根项目负责沉淀 GitHub、Cloudflare、Vercel、低成本主机等工作流文档；`shop/` 应当拥有自己的 Git 仓库、GitHub 远端和 Cloudflare Pages 项目。

如果把 `shop/` 长期放在根仓库跟踪，会造成：

- 主文档仓库和业务落地页发布节奏耦合。
- Cloudflare Pages 绑定 GitHub 时项目边界不清晰。
- 后续多个落地页复制时难以保持“一项目一仓库”。

## 解决方案

本次纠偏采用：

```text
根仓库 github_workflow：
  保留 docs/
  忽略 .omx/
  忽略 GPTSession2CPAandSub2API/
  忽略 shop/

shop 项目：
  在 shop/ 内部初始化独立 Git 仓库
  创建独立 GitHub 仓库
  单独推送
  单独绑定 Cloudflare Pages 和 shop.eforge.xyz
```

## 操作要点

1. 在根仓库执行 `git rm --cached -r shop`，只取消根仓库跟踪，不删除磁盘文件。
2. 根仓库 `.gitignore` 加入 `/shop/`，避免未来误提交。
3. 在 `shop/` 内部执行 `git init`。
4. `shop/` 使用独立远端，例如 `qwdingyu/vibox-shop`。
5. Cloudflare Pages 项目只指向 `shop` 独立仓库，而不是 `github_workflow` 根仓库。

## 建议

以后每个可独立上线的应用都按以下规则处理：

```text
一个可部署应用 = 一个独立 Git 仓库 = 一个独立 GitHub repo = 一个独立 Cloudflare Pages/Workers 项目
```

根目录 `github_workflow` 只保存流程、规范、复盘和跨项目部署经验，不作为具体业务应用的发布仓库。

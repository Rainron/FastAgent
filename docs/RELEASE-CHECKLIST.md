# Release checklist

用于维护者准备公开版本，不代表每次发布都必须完成全部平台分发工作。

## 发布前

- [ ] 确认工作区干净，未包含凭证、日志、构建产物或本机路径。
- [ ] 更新 `package.json` 版本号。
- [ ] 在 `CHANGELOG.md` 顶部记录用户可见的新增、修复和变更。
- [ ] 确认 README 的安装命令、系统要求和功能描述与当前版本一致。
- [ ] 运行 `npm run typecheck` 和 `npm test`。
- [ ] 如涉及原生模块、沙箱或内置工具链，完成对应 Windows 验证。

## GitHub Release

- [ ] 创建与 `package.json` 版本一致的 Git tag，例如 `v1.0.0`。
- [ ] 发布 GitHub Release，并粘贴对应的 CHANGELOG 条目。
- [ ] 如提供安装包，说明未签名安装包可能触发 Windows SmartScreen 提示。
- [ ] 发布后从干净目录验证 README 中的安装流程。

## 发布后

- [ ] 检查 CI 是否通过。
- [ ] 记录用户反馈、已知限制和下一步维护方向。
- [ ] 不要为了增加公开指标人为制造提交、Issue、下载量或 Star。

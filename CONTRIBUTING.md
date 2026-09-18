# 贡献指南

感谢你关注 FastAgent。项目目前主要面向 Windows，贡献优先围绕可复现、可验证和不削弱安全边界展开。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. 较大的功能或架构改动请先创建 Issue，说明动机、范围和验证方式。
3. 不要提交 API Key、凭证、用户数据、构建产物或本机路径。
4. 涉及权限、沙箱、密钥处理或命令执行的改动，请在 PR 描述中说明威胁边界和回归风险。

## 本地开发

环境要求：Node.js 22+、Windows 10/11。执行：

```bash
npm install
npm run typecheck
npm test
npm run dev
```

打包还需要 Rust 工具链：

```bash
npm run package:win
```

## 提交与 Pull Request

- 使用清晰的 Conventional Commits 风格提交信息。
- 一个 PR 尽量只解决一个问题。
- PR 描述请包含：变更动机、主要改动、验证命令、已知限制和截图（如涉及界面）。
- 新增或修改纯逻辑行为时，请同步补充测试。
- 不要为了通过检查删除断言、跳过测试或吞掉异常。

维护者会重点检查功能正确性、权限边界、敏感信息处理、Windows 兼容性和文档一致性。

## 许可

提交代码即表示你同意按本项目 [MIT License](LICENSE) 发布你的贡献。

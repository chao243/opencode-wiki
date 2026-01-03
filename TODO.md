# OpenCode Wiki Generator - TODO

基于 [DESIGN.md](./DESIGN.md) 第 8 节路线图的项目计划。

---

## Phase 1: 基础架构 (MVP) - 2 周

- [ ] 搭建插件脚手架，实现 `Plugin` 入口
  - [ ] 使用 `@opencode-ai/plugin` 创建主入口 `src/index.ts`
  - [ ] 配置 hooks: `event`, `tool`, `tool.execute.before/after`
- [ ] 注册 Slash Command `/wiki`
  - [ ] 创建 `.config/opencode/command/wiki.md`
- [ ] 定义 Wiki Orchestrator Agent Prompt
  - [ ] 创建 `src/agents/orchestrator.ts`
  - [ ] 实现 `WikiAgentConfig` 接口
- [ ] 实现 `wiki_scan_structure` 工具
  - [ ] 创建 `src/tools/scan-structure/`
  - [ ] 使用 `tool()` helper 定义工具
- [ ] 实现 TypeScript/JavaScript 语言适配器
  - [ ] 创建 `src/adapters/typescript.ts`
- [ ] 实现基础的串行生成流程

---

## Phase 2: Subagent 与并行化 - 3 周

- [ ] 实现 Wiki Analyzer Agent
  - [ ] 创建 `src/agents/analyzer.ts`
  - [ ] 定义只读分析 prompt 和工具权限
- [ ] 实现 Wiki Module Writer Agent
  - [ ] 创建 `src/agents/module-writer.ts`
  - [ ] 定义写入权限和模板
- [ ] 集成 `background_task` 调度逻辑
  - [ ] 实现 `BackgroundManager` 适配
- [ ] 实现 Analysis 和 Generation 两阶段工作流
- [ ] 实现 `wiki_init_structure` 工具
- [ ] 实现 `wiki_write_page` 工具
- [ ] 实现 `wiki_update_nav` 工具
- [ ] 实现 Global Knowledge Base 共享机制
- [ ] 实现基础错误处理和重试策略

---

## Phase 3: 多语言支持 - 3 周

- [ ] 定义语言适配器接口 (`LanguageAdapter`)
  - [ ] 创建 `src/adapters/types.ts`
- [ ] 实现 Go 语言适配器
  - [ ] 创建 `src/adapters/go.ts`
- [ ] 实现 Python 语言适配器
  - [ ] 创建 `src/adapters/python.ts`
- [ ] 实现 Rust 语言适配器
- [ ] 实现 C# 语言适配器
- [ ] 实现语言自动检测逻辑
  - [ ] 创建 `src/utils/language-detector.ts`

---

## Phase 4: 深度代码理解 - 4 周

- [ ] 实现调用图分析工具 (`wiki_analyze_call_graph`)
- [ ] 实现设计模式检测 (`wiki_detect_patterns`)
- [ ] 集成 LSP 客户端 (`wiki_lsp_query`)
  - [ ] 创建 `src/lsp/client.ts`
- [ ] 实现 LSP Server 生命周期管理
  - [ ] 创建 `src/lsp/server-manager.ts`
- [ ] 实现 Wiki Diagram Generator Agent
  - [ ] 创建 `src/agents/diagram-gen.ts`
- [ ] 实现 Wiki API Doc Generator Agent
  - [ ] 创建 `src/agents/api-doc-gen.ts`
- [ ] 实现模块边界识别和架构分析

---

## Phase 5: MCP 与高级功能 - 3 周

- [ ] 实现 MCP 服务器 (wiki-context-server)
  - [ ] 创建 `src/mcp/context-server.ts`
- [ ] 集成 Git 历史分析
- [ ] 集成外部依赖文档获取
- [ ] 实现增量更新模式
- [ ] 实现变更检测与文档同步

---

## Phase 6: 质量与稳定性 - 2 周

- [ ] 实现质量检查规则系统
- [ ] 实现 `wiki_validate_links` 工具
- [ ] 实现文档与源码一致性检查
- [ ] 实现质量报告生成
- [ ] 性能优化与资源管理
- [ ] 完善错误处理与降级策略

---

## Phase 7: 国际化支持 - 3 周

- [ ] 设计并实现翻译配置系统
- [ ] 实现 Wiki Translator Subagent
  - [ ] 创建 `src/agents/translator.ts`
- [ ] 实现术语表管理系统 (GlossaryManager)
- [ ] 实现多语言输出结构生成
- [ ] 实现翻译质量检查
- [ ] 实现增量翻译机制
- [ ] 集成语言切换导航生成

---

## Phase 8: 文档与发布 - 1 周

- [ ] 编写用户文档和配置指南
  - [ ] 创建 `docs/user-guide.md`
- [ ] 编写插件开发者指南
  - [ ] 创建 `docs/developer-guide.md`
- [ ] 创建示例项目和演示
- [ ] 发布 v1.0 版本
  - [ ] 更新 `package.json` 版本号
  - [ ] 运行 `bun run build` 验证构建
  - [ ] 发布到 npm

---

## 项目结构预览

```
opencode-wiki/
├── src/
│   ├── index.ts              # Plugin 入口
│   ├── agents/               # Agent 定义
│   │   ├── orchestrator.ts
│   │   ├── analyzer.ts
│   │   ├── module-writer.ts
│   │   ├── api-doc-gen.ts
│   │   ├── diagram-gen.ts
│   │   └── translator.ts
│   ├── tools/                # 工具定义
│   │   ├── scan-structure/
│   │   ├── extract-symbols/
│   │   ├── init-structure/
│   │   ├── write-page/
│   │   ├── update-nav/
│   │   └── validate-links/
│   ├── adapters/             # 语言适配器
│   │   ├── types.ts
│   │   ├── typescript.ts
│   │   ├── go.ts
│   │   ├── python.ts
│   │   └── rust.ts
│   ├── lsp/                  # LSP 集成
│   │   ├── client.ts
│   │   └── server-manager.ts
│   └── mcp/                  # MCP 服务器
│       └── context-server.ts
├── docs/                     # 文档
├── DESIGN.md
├── TODO.md
└── package.json
```

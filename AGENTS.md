# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-02T12:51:00+08:00
**Version:** 0.1.0
**Branch:** main

## OVERVIEW

OpenCode plugin: Multi-agent wiki generation system. Orchestrates 5 specialized AI agents (Orchestrator, Analyzer, Writer, API Doc Gen, Diagram Gen) to automatically generate comprehensive documentation for codebases. Uses `background_task` for parallel processing.

## STRUCTURE

```
opencode-wiki/
├── src/
│   ├── cli/           # CLI commands (generate, init)
│   └── index.ts       # Main plugin entry
├── script/            # build-schema.ts
├── dist/              # Build output (ESM + .d.ts + JSON schema)
└── DESIGN.md          # Full system design document
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin entry | `src/index.ts` | activate/deactivate functions |
| CLI commands | `src/cli/index.ts` | Commander-based CLI |
| Config schema | `script/build-schema.ts` | Run `bun run build:schema` after |
| System design | `DESIGN.md` | Full architecture documentation |
| Agent prompts | `DESIGN.md` Section 3 | All 5 agent system prompts |
| Tool definitions | `DESIGN.md` Section 5 | wiki_* tool specifications |
| Implementation roadmap | `DESIGN.md` Section 8 | 8-phase development plan |

## CONVENTIONS

- **Bun only**: `bun run`, `bun test`, `bunx` (NEVER npm/npx)
- **Types**: bun-types (not @types/node)
- **Build**: `bun build` (ESM) + `tsc --emitDeclarationOnly`
- **Exports**: Barrel pattern in index.ts
- **Naming**: kebab-case directories

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Package Manager | npm, yarn, npx |
| File Ops | Bash mkdir/touch/rm for code file creation |
| Agent Behavior | High temp (>0.3), broad tool access |
| Year | 2024/2025 in code/prompts (use current year 2026) |

## PLANNED AGENTS

| Agent | Role | Purpose |
|-------|------|---------|
| Wiki Orchestrator | system-orchestrator | Task decomposition, subagent coordination, quality gating |
| Wiki Analyzer | code-analyzer | Read-only code analysis, extract module metadata |
| Wiki Module Writer | technical-writer | Generate module-level Markdown docs |
| Wiki API Doc Gen | api-documenter | Generate precise API reference docs |
| Wiki Diagram Gen | diagram-architect | Generate Mermaid diagrams (C4, flowchart, sequence, class) |
| Wiki Translator | translator | Multi-language translation with glossary support |

## PLANNED TOOLS

| Tool | Purpose | User |
|------|---------|------|
| `wiki_scan_structure` | Quick project structure scan | Orchestrator |
| `wiki_extract_symbols` | Deep AST parsing for symbols | Analyzer, API Doc Gen |
| `wiki_init_structure` | Initialize wiki output directory | Orchestrator |
| `wiki_write_page` | Write markdown with frontmatter | Writers |
| `wiki_update_nav` | Update sidebar/navigation | Orchestrator |
| `wiki_validate_links` | Check internal link integrity | Orchestrator |

## COMMANDS

```bash
bun run typecheck      # Type check
bun run build          # ESM + declarations + schema
bun run clean          # Remove dist/
bun test               # Run tests
```

## DEPENDENCIES

| Package | Purpose |
|---------|---------|
| `@opencode-ai/plugin` | OpenCode plugin API |
| `@opencode-ai/sdk` | OpenCode SDK |
| `commander` | CLI framework |
| `picocolors` | Terminal colors |
| `zod` | Schema validation |

## IMPLEMENTATION STATUS

### Phase 1: 基础架构 (MVP) - 🚧 In Progress
- [x] 搭建插件脚手架
- [x] 注册 CLI commands
- [ ] 定义 Wiki Orchestrator Agent Prompt
- [ ] 实现 `wiki_scan_structure` 工具

### Phase 2-8: See DESIGN.md for full roadmap

## NOTES

- **Config File**: `wiki-generator.json` in project root
- **Output Dir**: Default `./wiki`
- **Multi-language**: Supports TypeScript, Go, Rust, C#, Python, Java, Kotlin via Language Adapters
- **Parallel Processing**: Uses `background_task` for concurrent agent execution
- **LSP Integration**: Planned for deep code understanding (Phase 4)

# opencode-wiki — MVP 执行计划（最小可用闭环）

> 目标：参考 `opencode-wiki/docs/SYSTEM-DESIGN.md`（v2.2）实现一个**最小可用**的 Wiki 生成器：
> - 三阶段：**全局分析 → 循环并发生成 → 最终验证**
> - 自包含：不依赖 `oh-my-opencode` 的 `background_task`（使用内置任务调度器）
> - 可恢复：支持中断后继续（state.json）
> - 可控：Top-N + limits，避免大仓库爆炸
>
> 当前仓库现状（已确认）：
> - `opencode-wiki/src/index.ts` 仅有 6 个占位符工具：`wiki_scan_structure` / `wiki_extract_symbols` / `wiki_init_structure` / `wiki_write_page` / `wiki_update_nav` / `wiki_validate_links`
> - 缺失关键工具：`wiki_start_task` / `wiki_get_result` / `wiki_cancel_task` / `wiki_load_state` / `wiki_save_state`
> - 缺失关键模块：Renderer（`toPageIR`/`render`/templates/`validate`）
> - `opencode-wiki/script/build-schema.ts` 配置 schema 与 v2.2 不匹配
>
---

## 0. MVP 范围（必须 / 不做）

### 必须交付（MVP）
- 入口：CLI `opencode-wiki generate`（当前已有 stub），或最小 `/wiki` slash command（二选一即可）
- Orchestrator：实现三阶段流程（全局分析一次 + 并发单元分析/生成 + 最终链接验证）
- 内置任务调度器：实现 `wiki_start_task` / `wiki_get_result` / `wiki_cancel_task`，并发受 `parallelism.max_concurrent_tasks` 控制
- Analyzer 工具：实现 `wiki_scan_structure` 与 `wiki_extract_symbols`（允许 MVP 使用 regex/AST-grep 降级，不引入 LSP）
- Renderer 模块：实现 `toPageIR()` / `render()` / `validate()`，提供至少 `standard` 模板（overview+module）
- 写入工具：`wiki_init_structure` / `wiki_write_page` / `wiki_update_nav`（并发时 overwrite；串行时 incremental）
- 状态工具：`wiki_load_state` / `wiki_save_state`，输出 `wiki/.opencode-wiki/state.json`，支持中断后继续
- 最终验证：`wiki_validate_links`（MVP 只校验相对路径目标文件存在性，不校验锚点）
- 配置系统：读取 `wiki-generator.json`（默认值 + 校验 + schema 更新到 v2.2）

### 明确不做（MVP 之外）
- LSP 集成、调用图分析、设计模式检测（SYSTEM-DESIGN Phase 4+）
- API docs/diagrams/guides 全量输出（可保留开关但默认关闭）

---

## 1. DoD（验收标准）

### 功能 DoD
- 在任意中等规模 repo 上运行成功：生成 `wiki/index.md`、`wiki/_sidebar.md`、`wiki/modules/*.md`、`wiki/.opencode-wiki/state.json`
- `max_concurrent_tasks > 1` 时：并发生成 + 导航 overwrite，最终 `_sidebar.md` 不重复、不竞争写
- 中断恢复：第一次生成中断后再次运行，已完成 item 会被跳过（或不重复写入/不重复导航）
- 最终报告包含：生成数量、失败项、链接验证摘要（总数/失败数/示例）、耗时统计

### 工程 DoD
- `wiki_write_page` 采用原子写入（临时文件 → rename），并做路径越界防护
- Renderer 为纯函数（可单测），至少覆盖 `toPageIR` + `render` 的 1–2 个用例

---

## 2. 关键路径（按依赖顺序）

> 下面是“最小闭环”的关键路径：先打通 end-to-end，再补可靠性。

### 2.1 类型与限制（一天内完成）
- [ ] 定义 v2.2 的共享类型（建议集中在 `opencode-wiki/src/core/types.ts`）
  - `GlobalAnalysisResult` / `UnitAnalysisResult` / `GenerationList` / `GenerationItem`
  - `PageIR` / `PageSection` / `PageContent` / `WikiRenderer`
  - `NavigationItem`
- [ ] 实现 size-limit 工具：Top-N 选择、文本截断、统计补足（遵守 `limits.*`）

### 2.2 Renderer（先做最小标准模板）
- [ ] `toPageIR()`：
  - Global → overview（项目类型/技术栈/入口点/关键模块清单）
  - Unit → module（目录/关键文件/关键符号/依赖/关键功能）
- [ ] `render()`：Handlebars/Mustache 任一；模板路径按 `SYSTEM-DESIGN.md` 的 `templates/standard/*.md.hbs`
- [ ] `validate()`：检查必备标题、sections 非空、链接格式基本合法
- [ ] 内置模板至少两张：`overview.md.hbs`、`module.md.hbs`

### 2.3 内置任务调度器 + Scheduler 工具
- [ ] Scheduler core：任务队列 + 任务状态（started/running/completed/failed/cancelled）+ 并发限制
- [ ] `wiki_start_task`：启动 analyzer 任务（global 或 unit）
- [ ] `wiki_get_result`：支持 block / non-block（non-block 返回 running + progress 可先简化为 last-known）
- [ ] `wiki_cancel_task`：best-effort 取消 + 清理

### 2.4 Analyzer 工具（只读）
- [ ] `wiki_scan_structure`：fs 遍历 + exclude_patterns + max_depth + max_files；输出统计（file_count/dirs/files_top/line_count 可先粗略）
- [ ] `wiki_extract_symbols`：
  - MVP：先做 TS/JS 的 export/function/class/interface/type/enum 识别（regex/AST-grep 任选），再扩展其它语言
  - 重要性评分：public/export 优先，签名/文档截断

### 2.5 写入/导航/状态/链接验证
- [ ] `wiki_init_structure`：创建 `wiki/`、`wiki/modules/`、`.nojekyll`；force 规则
- [ ] `wiki_write_page`：原子写入 + 自动 mkdir + traversal guard（禁止 `..` 逃逸 output_dir）
- [ ] `wiki_update_nav`：
  - 串行（max=1）→ incremental（追加/去重）
  - 并发（max>1）→ overwrite（内存收集，最后一次性写入）
- [ ] `wiki_load_state` / `wiki_save_state`：读写 `wiki/.opencode-wiki/state.json`（原子写入 + config_hash）
- [ ] `wiki_validate_links`：扫描 `.md`，解析 `](...)` 相对链接，校验目标文件存在

### 2.6 Orchestrator（把闭环跑起来）
- [ ] Phase 1：全局分析 → 生成 `GenerationList`（overview + modules，按 priority 排序）
- [ ] Phase 2：并发循环：为每个 item 调度 analyze → renderer → write_page → state 更新
- [ ] Phase 3：validate_links → 输出报告

### 2.7 配置与 schema（对齐 v2.2）
- [ ] 更新 `opencode-wiki/script/build-schema.ts`，覆盖：
  - `output_dir`, `overwrite_existing`, `exclude_patterns`
  - `agents`（最小保留 orchestrator/analyzer 模型配置）
  - `parallelism`（max_concurrent_tasks, task_timeout）
  - `generation`（include_overview/include_modules/enable_incremental 等）
  - `limits`, `validation`, `security`, `renderer`
- [ ] CLI 读取 `wiki-generator.json` 并传给 orchestrator

---

## 3. 2 周节奏建议（里程碑）

### Week 1：闭环优先
- [ ] Day 1：类型 + limits 工具 + Renderer skeleton + `wiki_write_page` 原子写入
- [ ] Day 2：`wiki_scan_structure` + 最小 `wiki_extract_symbols`
- [ ] Day 3：Scheduler core + `wiki_start_task`/`wiki_get_result`
- [ ] Day 4：Orchestrator Phase 1+2 打通（先串行也可），产出多页面
- [ ] Day 5：`wiki_update_nav`（overwrite）+ `wiki_validate_links` + 最终报告

### Week 2：可恢复与体验
- [ ] Day 6：`wiki_load_state`/`wiki_save_state` + enable_incremental
- [ ] Day 7：并发补位调度（dynamic queue）+ 导航 overwrite/ incremental 自动切换
- [ ] Day 8：schema 更新 + config 校验（最低可用）
- [ ] Day 9：Renderer 单测 + 写入/路径安全单测
- [ ] Day 10：端到端 smoke（选 1 个 fixture repo）+ 修复边界问题

---

## 4. MVP 自测脚本（建议固定下来）
- [ ] `max_concurrent_tasks=1` 运行一次 → 验证 incremental nav
- [ ] `max_concurrent_tasks=3` 运行一次 → 验证 overwrite nav
- [ ] 中断后再次运行 → 验证 state resume
- [ ] 人为制造坏链接 → 验证 `wiki_validate_links` 报告

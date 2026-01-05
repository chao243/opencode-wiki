# OpenCode Wiki Generator - 系统设计文档

 **版本**: 2.1
 **日期**: 2026-01-05
 **状态**: 架构修订版（基于 Oracle 审查）

---

## 目录

1. [架构概览](#1-架构概览)
2. [核心 Agent 设计](#2-核心-agent-设计)
3. [工作流程详解](#3-工作流程详解)
4. [数据结构定义](#4-数据结构定义)
5. [工具设计](#5-工具设计)
6. [配置系统](#6-配置系统)
7. [输出结构](#7-输出结构)
8. [关键设计决策](#8-关键设计决策)
9. [实现路线图](#9-实现路线图)
10. [与 oh-my-opencode 的对应关系](#10-与-oh-my-opencode-的对应关系)

---

## 1. 架构概览

 OpenCode Wiki Generator 是基于 OpenCode 插件系统的多 Agent 协同系统，采用**全局分析 → 循环并发生成**模式生成代码仓库的 DeepWiki（Markdown 格式）。

### 核心理念

```
用户请求
    ↓
[Wiki Orchestrator - 主编排 Agent]
    ↓
步骤1: 全局分析
    → 调用 [Wiki Analyzer] 一次（通过内置任务调度器）
    → 得到：项目类型、主要模块、主要功能
    → 输出：需要生成的内容列表 (总览, 系统1, 系统2, 系统3...)
    ↓
 步骤2: 循环并发生成 (可配置并发数)
     循环处理每个内容单元:
     ├── 调用 [Wiki Analyzer] 分析该内容（通过内置任务调度器）
     ├── 生成该内容的 Markdown
     └── 更新导航（最后一次性写入）
     (多个内容单元并发执行)
    ↓
步骤3: 最终检查
    → 检查整个系统的 wiki
    → 输出完成报告
```

### 设计原则

1. **自包含并发**：插件内部实现任务调度器，不依赖外部框架
2. **数据规模可控**：所有分析输出都包含大小限制，确保大型仓库稳定运行
3. **安全文件操作**：导航更新根据并发数自动选择策略，避免竞争条件
4. **可恢复性**：支持中断后继续生成，避免重复工作
5. **增量支持**：支持增量更新现有文档

 ### 系统架构图

 ```mermaid
 graph TB
     User[用户] --> |请求| Orchestrator[Wiki Orchestrator<br/>主编排 Agent]

     subgraph "Phase 1: 全局分析"
         Orchestrator --> |wiki_start_task| Scheduler1[内置任务调度器]
         Scheduler1 --> |调用| Analyzer1[Wiki Analyzer<br/>全局分析]
         Analyzer1 --> |返回| Scheduler1
         Scheduler1 --> |结果| Result1[Global Analysis Result<br/>项目类型 + 模块列表]
     end

     Result1 --> |生成清单| Orchestrator

     subgraph "Phase 2: 循环并发生成"
         Orchestrator --> |并发调度| Scheduler2[内置任务调度器<br/>max_concurrent_tasks限制]

         Scheduler2 --> |分析| Analyzer2[Wiki Analyzer<br/>单元分析 xN]
         Analyzer2 --> |分析结果| Scheduler2

         Scheduler2 --> |结果| Orchestrator

         Orchestrator --> |生成| Writer[Markdown Generation<br/>xN个并发任务]
         Writer --> |写入文件| Files[Wiki Files]

         Orchestrator --> |一次性写入| Nav[_sidebar.md<br/>Overwrite模式]
     end

     subgraph "Phase 3: 最终验证"
         Orchestrator --> |验证| Validator[Link Validator]
         Validator --> |报告| Report[完成报告]
         Report --> User
     end

     subgraph "插件内部工具"
         wiki_start_task["wiki_start_task<br/>启动分析任务"]
         wiki_get_result["wiki_get_result<br/>获取任务结果"]
         wiki_cancel_task["wiki_cancel_task<br/>取消任务"]
     end
 ```

---

## 2. 核心 Agent 设计

### 2.1 Wiki Orchestrator (主编排 Agent)

#### 角色
- **主编排器**：协调整个 wiki 生成流程
- **任务分发器**：管理并发任务的启动和调度
- **结果汇总器**：收集所有生成结果并输出报告

#### 职责

**Phase 1: 全局分析**
- 读取 `wiki-generator.json` 配置
- 调用 Wiki Analyzer 进行一次性全局分析
- 接收全局分析结果：项目类型、主要模块、关键功能
- 生成需要生成的内容清单（生成列表）

**Phase 2: 循环并发生成**
- 按照生成清单中的内容单元循环处理
- 为每个内容单元：
  1. 检查依赖是否满足（优先级排序）
  2. 启动 background_task 调用 Wiki Analyzer 分析该单元
  3. 等待分析完成，接收结构化数据
  4. 根据分析结果生成 Markdown 文档
  5. 使用 `wiki_write_page` 写入文件
  6. 使用 `wiki_update_nav` 增量更新导航
- 控制并发数量（不超过 `max_concurrent_tasks`）

**Phase 3: 最终验证**
- 调用 `wiki_validate_links` 检查所有内部链接
- 生成完成报告：
  - 生成的文档数量
  - 链接验证结果
  - 耗时统计
  - 失败项（如果有）

 #### 工具权限
 ```typescript
 {
   tool: {
     wiki_start_task: "allow",
     wiki_get_result: "allow",
     wiki_cancel_task: "allow",
     wiki_write_page: "allow",
     wiki_update_nav: "allow",
     wiki_validate_links: "allow",
     wiki_load_state: "allow",
     wiki_save_state: "allow"
   },
   event: "allow"
 }
 ```

#### 推荐配置
```json
{
  "model": "anthropic/claude-opus-4-5",
  "temperature": 0.1,
  "thinking": {
    "type": "enabled",
    "budgetTokens": 32000
  }
}
```

### 2.2 Wiki Analyzer (分析 Agent)

#### 角色
- **代码分析引擎**：执行只读代码分析
- **数据提取器**：从代码中提取结构化信息

#### 职责

**全局分析模式**（被调用一次）：
- 扫描项目根目录结构
- 识别项目类型：
  - Web Application / Library / CLI Tool / Mobile App
- 列出主要模块（通过目录结构、配置文件、入口点判断）
- 提取关键功能（从 `package.json`、`README.md`、代码注释）
- 返回 `GlobalAnalysisResult` 格式的结构化数据

**单元分析模式**（被调用多次）：
- 接收特定路径或模块的分析任务
- 扫描指定路径
- 提取所有导出的符号（类、函数、接口、类型）
- 分析依赖关系（内部和外部）
- 提取关键功能
- 返回 `UnitAnalysisResult` 格式的结构化数据

#### 工具权限
```typescript
{
  tool: {
    wiki_scan_structure: "allow",
    wiki_extract_symbols: "allow"
  },
  lsp: "read-only"  // Phase 4 实现
}
```

#### 推荐配置
 ```json
 {
   "$schema": "./opencode-wiki.schema.json",

   /** Wiki 输出目录 */
   "output_dir": "./wiki",

   /** 是否覆盖已存在的内容（谨慎使用） */
   "overwrite_existing": false,

   /** 排除模式 */
   "exclude_patterns": [
     "**/node_modules/**",
     "**/dist/**",
     "**/build/**",
     "**/*.test.ts",
     "**/*.spec.ts",
     "**/.env*",
     "**/*credentials*"
   ],

   /** Agent 模型配置 */
   "agents": {
     "orchestrator": {
       "model": "anthropic/claude-opus-4-5",
       "temperature": 0.1,
       "thinking": {
         "type": "enabled",
         "budgetTokens": 32000
       }
     },
     "analyzer": {
       "model": "google/gemini-3-flash",
       "temperature": 0.0
     }
   },

   /** 并发控制 */
   "parallelism": {
     "max_concurrent_tasks": 3,
     "strategy": "dynamic",
     /** 任务超时时间（毫秒） */
     "task_timeout": 120000
   },

   /** 生成选项 */
   "generation": {
     "include_overview": true,
     "include_modules": true,
     "include_api_docs": false,
     "include_diagrams": false,
     "include_guides": false,
     /** 是否支持增量生成（中断后继续） */
    "enable_incremental": true
   },

   /** 数据规模控制 */
  "limits": {
     /** 单次分析的最大文件数 */
    "max_files_per_analysis": 1000,
     /** 单元分析的最大符号数 */
    "max_symbols_per_unit": 50,
     /** 全局分析的最大模块数 */
    "max_modules_global": 20,
     /** 单个文件的最大行数（超过则摘要处理） */
    "max_lines_per_file": 1000
  },

   /** 验证选项 */
   "validation": {
     "check_links": true,
     "report_failures": true,
     /** 验证失败时是否继续 */
    "continue_on_failure": false
  },

   /** 安全选项 */
  "security": {
     /** 是否跳过包含敏感信息的文件 */
    "skip_sensitive_files": true,
     /** 敏感关键词列表 */
    "sensitive_keywords": ["password", "secret", "api_key", "token", "credential"]
  }
 }
 ```

---

## 3. 工作流程详解

 ### 3.1 完整流程图

 ```mermaid
 sequenceDiagram
     participant User
     participant Orch as Wiki Orchestrator
     participant Scheduler as 内置任务调度器
     participant Analyzer as Wiki Analyzer

     User->>Orch: 请求生成 wiki

     rect rgb(200, 200, 255)
         Note over Orch,Analyzer: Phase 1: 全局分析
         Orch->>Scheduler: wiki_start_task<br/>全局分析: 整个项目
         Scheduler->>Analyzer: 调用 Wiki Analyzer
         Analyzer-->>Scheduler: GlobalAnalysisResult<br/>{project_type, main_modules, key_features}
         Scheduler-->>Orch: 任务结果
         Note over Orch: 生成清单:<br/>[总览, 系统1, 系统2, 系统3]
     end

     rect rgb(200, 255, 200)
         Note over Orch,Analyzer: Phase 2: 循环并发生成<br/>max_concurrent=3

         Orch->>Orch: 并发启动3个分析任务

         par 并发分析
             Orch->>Scheduler: wiki_start_task<br/>分析总览
             Orch->>Scheduler: wiki_start_task<br/>分析系统1
             Orch->>Scheduler: wiki_start_task<br/>分析系统2
         end

         par 分析执行
             Scheduler->>Analyzer: 分析总览
             Scheduler->>Analyzer: 分析系统1
             Scheduler->>Analyzer: 分析系统2
         end

         par 生成文档
             Scheduler-->>Orch: 总览完成 (wiki_get_result)
             Orch->>Orch: 生成总览 Markdown
             Orch->>Orch: wiki_write_page(overview.md)

             Scheduler-->>Orch: 系统1完成 (wiki_get_result)
             Orch->>Orch: 生成系统1 Markdown
             Orch->>Orch: wiki_write_page(modules/auth.md)

             Scheduler-->>Orch: 系统2完成 (wiki_get_result)
             Orch->>Orch: 生成系统2 Markdown
             Orch->>Orch: wiki_write_page(modules/api.md)
         end

         Note over Orch: 继续处理剩余内容单元...

         Orch->>Orch: 所有文档生成完成
         Orch->>Orch: 在内存中构建完整导航结构
         Orch->>Orch: wiki_update_nav(overwrite)
     end

     rect rgb(255, 200, 200)
         Note over Orch,User: Phase 3: 最终验证
         Orch->>Orch: wiki_validate_links(整个 wiki)
         Orch->>User: 完成报告<br/>{生成数量, 链接状态, 耗时}
     end
 ```

 ### 3.2 并发控制策略

 #### 配置参数
 ```json
 {
   "parallelism": {
     "max_concurrent_tasks": 3,  // 最大并发任务数
     "strategy": "dynamic"         // 策略: fixed | dynamic
   }
 }
 ```

 #### 动态策略说明

 根据内容单元类型动态调整并发数：

 | 内容类型 | 并发数 | 说明 |
 |---------|--------|------|
 | 全局分析 | 1 | 串行，只有一个任务 |
 | 总览文档 | 1 | 串行，依赖全局分析结果 |
 | 模块文档 | max_concurrent_tasks | 并发，无依赖关系 |
 | API 文档 | max_concurrent_tasks | 并发，可同时生成 |

 #### 实现逻辑

 ```markdown
 1. 等待全局分析完成（阻塞）

 2. 立即启动总览文档生成（优先级最高）

 3. 同时启动 max_concurrent_tasks 个模块文档生成：
    - 使用 wiki_start_task 并发启动分析任务
    - 每个任务独立执行分析
    - 使用 wiki_get_result 获取结果
    - 生成 Markdown 并写入文件

 4. 当一个任务完成，立即启动下一个等待中的任务：
    - 从待处理队列取出下一个内容单元
    - 启动新的 wiki_start_task
    - 保持并发数恒定

 5. 所有内容单元处理完成后：
    - 在内存中构建完整导航结构
    - 一次性调用 wiki_update_nav(overwrite) 写入

 6. 进入最终验证阶段
 ```

 #### 导航更新策略（自动选择）

 根据并发数自动选择导航更新模式：

 | 并发数 | 更新模式 | 理由 |
 |--------|---------|------|
 | max_concurrent_tasks = 1 | incremental | 串行执行，安全地追加更新 |
 | max_concurrent_tasks > 1 | overwrite | 避免并发写入竞争，保证一致性 |

 **实现细节**：
- **Incremental 模式**：每生成一个文档立即读取 → 追加 → 写入 `_sidebar.md`
- **Overwrite 模式**：维护内存中的导航对象，所有文档生成完毕后一次性写入
- **自动切换**：Orchestrator 根据 `max_concurrent_tasks` 配置自动选择策略

 ### 3.3 导航更新策略

 **重要**：导航更新模式由系统根据并发数自动选择，无需手动配置。

 #### 自动选择逻辑

 ```typescript
 function getNavigationMode(config: Config): 'incremental' | 'overwrite' {
   return config.parallelism.max_concurrent_tasks > 1
     ? 'overwrite'  // 并发时使用覆盖模式，避免竞争
     : 'incremental'; // 串行时使用增量模式
 }
 ```

 #### Incremental（增量更新）

 **适用场景**：`max_concurrent_tasks = 1`

 **优点：**
 - 每生成一个文档，立即更新导航
 - 支持实时进度反馈
 - 支持增量生成（中断后可以继续）
 - 内存占用小

 **流程：**
 1. 读取现有 `_sidebar.md`
 2. 追加新生成的导航项
 3. 写回文件（使用原子操作：写临时文件 → rename）

 ```markdown
 <!-- 初始 _sidebar.md -->
 * [项目总览](index.md)

 <!-- 生成 auth-system.md 后追加 -->
 * [项目总览](index.md)
 * 模块文档
   * [认证系统](modules/auth-system.md)

 <!-- 生成 api-gateway.md 后追加 -->
 * [项目总览](index.md)
 * 模块文档
   * [认证系统](modules/auth-system.md)
   * [API 网关](modules/api-gateway.md)
 ```

 #### Overwrite（全量覆盖）

 **适用场景**：`max_concurrent_tasks > 1`

 **优点：**
 - 保证最终一致性
 - 避免并发写入竞争
 - 避免重复项
 - 导航结构可控

 **流程：**
 1. 在内存中维护导航对象（`NavigationItem[]`）
 2. 每生成一个文档，追加到导航对象
 3. 所有文档生成完成后，一次性写入 `_sidebar.md`
 4. 使用原子操作（写临时文件 → rename）

 **内存导航对象结构：**
 ```typescript
 interface NavigationItem {
   level: number;      // 缩进层级 (0, 1, 2, ...)
   title: string;      // 显示标题
   path: string;       // Markdown 文件路径
   position?: number;  // 排序位置（用于优先级）
 }
 ```

#### Incremental（增量更新）- 推荐

**优点：**
- 每生成一个文档，立即更新导航
- 避免覆盖其他导航项
- 支持增量生成（中断后可以继续）
- 适合长时间运行的生成任务

**流程：**
1. 读取现有 `_sidebar.md`
2. 追加新生成的导航项
3. 写回文件

```markdown
<!-- 初始 _sidebar.md -->
* [项目总览](index.md)

<!-- 生成 auth-system.md 后追加 -->
* [项目总览](index.md)
* 模块文档
  * [认证系统](modules/auth-system.md)

<!-- 生成 api-gateway.md 后追加 -->
* [项目总览](index.md)
* 模块文档
  * [认证系统](modules/auth-system.md)
  * [API 网关](modules/api-gateway.md)
```

#### Overwrite（全量覆盖）

**优点：**
- 保证最终一致性
- 避免重复项
- 适合完整重新生成

**流程：**
1. 等待所有文档生成完成
2. 一次性生成完整导航
3. 覆盖原文件

---

## 4. 数据结构定义

 ### 4.1 全局分析结果

 ```typescript
 /**
  * 全局分析结果 - Wiki Analyzer 返回
  *
  * 设计原则：输出大小受控，确保大型项目稳定运行
  */
 interface GlobalAnalysisResult {
   /** 项目类型 */
   project_type: "Web Application" | "Library" | "CLI Tool" | "Mobile App" | "Microservices";

   /** 主要编程语言 */
   primary_language: string;  // e.g., "TypeScript", "Python", "Go"

   /** 技术栈（最多 10 项） */
   tech_stack: string[];  // e.g., ["TypeScript", "React", "Node.js", "PostgreSQL"]

   /** 入口点列表（最多 5 项） */
   entry_points: string[];  // e.g., ["src/index.ts", "cli.ts", "main.go"]

   /** 主要模块列表（按重要性排序，最多 20 项） */
   main_modules: ModuleInfo[];

   /** 关键功能列表（最多 10 项） */
   key_features: string[];  // e.g., ["OAuth2", "RESTful API", "Transaction Processing"]

   /** 项目描述（从 README 提取，最多 200 字） */
   description?: string;

   /** 文件统计（用于评估项目规模） */
   stats: {
     total_files: number;
     file_counts_by_extension: Record<string, number>;  // e.g., {".ts": 150, ".tsx": 80}
   };
 }

 /**
  * 模块信息
  */
 interface ModuleInfo {
   /** 唯一标识 */
   id: string;  // e.g., "auth-system"

   /** 显示名称 */
   name: string;  // e.g., "认证系统"

   /** 代码路径 */
   path: string;  // e.g., "src/auth"

   /** 类型 */
   type: "module" | "feature" | "service" | "component";

   /** 简短描述（最多 100 字） */
   description?: string;

   /** 优先级（1-10，数字越小越优先） */
   priority?: number;

   /** 模块规模 */
   size?: {
     file_count: number;
     line_count: number;
   };
 }
 ```

 ### 4.2 单元分析结果

 ```typescript
 /**
  * 单元分析结果 - Wiki Analyzer 返回
  *
  * 设计原则：输出大小受控，支持大型项目
  */
 interface UnitAnalysisResult {
   /** 内容单元标识 */
   unit_id: string;  // e.g., "auth-system", "overview"

   /** 内容单元名称 */
   unit_name: string;  // e.g., "认证系统", "项目总览"

   /** 内容单元类型 */
   unit_type: "global" | "module" | "feature";

   /** 源代码路径（仅模块/功能） */
   unit_path?: string;  // e.g., "src/auth"

   /** 主要编程语言 */
   language: string;

   /** 结构信息（受控大小） */
   structure: {
     /** 关键文件列表（最多 30 项，按重要性排序） */
     files_top: string[];

     /** 文件总数 */
     file_count: number;

     /** 子目录列表（最多 20 项） */
     directories: string[];

     /** 行数统计 */
     line_count: number;
   };

   /** 关键导出符号（最多 50 项，按重要性排序） */
   exports_top: ExportedSymbol[];

   /** 导出符号总数 */
   exports_count: number;

   /** 依赖关系（受控大小） */
   dependencies: {
     /** 内部依赖（最多 20 项） */
     internal: string[];  // e.g., ["src/utils", "src/db"]

     /** 外部依赖（最多 20 项） */
     external: ExternalDependency[];
   };

   /** 关键功能（最多 10 项） */
   key_features: string[];  // e.g., ["密码哈希", "JWT Token", "会话管理"]

   /** 文件哈希（用于增量更新检测） */
   file_hash?: string;  // 基于关键文件的 SHA256 哈希
 }

 /**
  * 导出符号
  */
 interface ExportedSymbol {
   name: string;
   kind: "class" | "interface" | "function" | "type" | "enum" | "const";
   visibility: "public" | "protected" | "private";
   signature?: string;  // 函数签名或类定义（截断至 200 字）
   documentation?: string;  // JSDoc/Docstring（截断至 300 字）
   location: {
     file: string;
     line: number;
   };
   /** 关键程度（用于 Top N 选择） */
   importance: number;  // 0-100，越高越重要
   children?: ExportedSymbol[];  // 对于类，包含关键方法和属性（最多 10 项）
 }

 /**
  * 外部依赖
  */
 interface ExternalDependency {
   name: string;  // e.g., "bcrypt"
   version?: string;  // e.g., "^5.0.1"
   usage: string;  // e.g., "用于密码哈希"（最多 100 字）
   importance: number;  // 0-100，用于排序
 }
 ```

### 4.3 生成清单

```typescript
/**
 * 生成清单 - Wiki Orchestrator 生成
 */
interface GenerationList {
  items: GenerationItem[];
}

/**
 * 生成项
 */
interface GenerationItem {
  /** 唯一标识 */
  id: string;  // e.g., "overview", "auth-system"

  /** 显示标题 */
  title: string;  // e.g., "项目总览", "认证系统"

  /** 类型 */
  type: "global" | "module" | "feature";

  /** 源代码路径（仅模块/功能） */
  path?: string;  // e.g., "src/auth"

  /** Wiki 输出路径 */
  output_path: string;  // e.g., "overview.md", "modules/auth.md"

  /** 优先级（1-10） */
  priority: number;

  /** 依赖的其他内容单元 ID */
  dependencies?: string[];  // e.g., ["overview"]

  /** 状态 */
  status: "pending" | "analyzing" | "generating" | "completed" | "failed";
}
```

---

 ## 5. 工具设计

 ### 5.1 工具清单

 | 工具名 | 用途 | 使用者 | 实现优先级 | 当前状态 |
 |--------|------|--------|------------|----------|
 | **任务调度工具** |
 | `wiki_start_task` | 启动分析任务 | Wiki Orchestrator | 🔴 高 | ⏸️ 占位符 |
 | `wiki_get_result` | 获取任务结果 | Wiki Orchestrator | 🔴 高 | ⏸️ 占位符 |
 | `wiki_cancel_task` | 取消任务 | Wiki Orchestrator | 🟡 中 | ⏸️ 占位符 |
 | **分析工具** |
 | `wiki_scan_structure` | 扫描目录结构 | Wiki Analyzer | 🔴 高 | ⏸️ 占位符 |
 | `wiki_extract_symbols` | 提取符号 | Wiki Analyzer | 🔴 高 | ⏸️ 占位符 |
 | **生成工具** |
 | `wiki_init_structure` | 初始化 Wiki 目录结构 | Wiki Orchestrator | 🔴 高 | ⏸️ 占位符 |
 | `wiki_write_page` | 写入 Markdown 文件 | Wiki Orchestrator | 🔴 高 | ⏸️ 占位符 |
 | `wiki_update_nav` | 更新导航 | Wiki Orchestrator | 🟡 中 | ⏸️ 占位符 |
 | `wiki_validate_links` | 验证链接 | Wiki Orchestrator | 🟢 低 | ⏸️ 占位符 |
 | **状态管理** |
 | `wiki_load_state` | 加载生成状态 | Wiki Orchestrator | 🟡 中 | ⏸️ 占位符 |
 | `wiki_save_state` | 保存生成状态 | Wiki Orchestrator | 🟡 中 | ⏸️ 占位符 |

 ### 5.2 工具交互流程

 #### 全局分析阶段

 ```
 Wiki Orchestrator
     ↓ wiki_start_task(
          agent="wiki-analyzer",
          prompt="全局分析整个项目",
          task_id="global-analysis"
        )
 ↓ 内置任务调度器启动 Wiki Analyzer
 Wiki Analyzer (分析整个项目)
     ↓ wiki_scan_structure(target_path="项目根目录")
     ↓ wiki_extract_symbols(每个入口点)
     ↓ 返回: GlobalAnalysisResult
 ↓ 任务调度器保存结果
 Wiki Orchestrator
     ↓ wiki_get_result(task_id="global-analysis")
     ↓ 解析结果，生成 GenerationList
 ```

 #### 循环并发生成阶段

 ```
 初始化：
 Wiki Orchestrator
     ↓ wiki_init_structure(output_dir, navigation_mode)
     ↓ wiki_load_state(检查是否有未完成任务)

 对于 GenerationList 中的每个 pending item (最多并发 max_concurrent_tasks 个):
     Wiki Orchestrator
         ↓ wiki_start_task(
              agent="wiki-analyzer",
              prompt="分析 {item.path}",
              task_id="analyze-{item.id}"
            )
     ↓ 内置任务调度器启动 Wiki Analyzer
     Wiki Analyzer (分析单个单元)
         ↓ wiki_scan_structure(target_path={item.path})
         ↓ wiki_extract_symbols(该路径)
         ↓ 返回: UnitAnalysisResult
     ↓ 任务调度器保存结果
     Wiki Orchestrator
         ↓ wiki_get_result(task_id="analyze-{item.id}")
         ↓ 生成 Markdown (基于分析结果)
         ↓ wiki_write_page(
              rel_path={item.output_path},
              content={Markdown 内容},
              title={item.title}
          )
         ↓ wiki_save_state(item.status="completed")

 所有任务完成后：
 Wiki Orchestrator
     ↓ wiki_update_nav(
          mode="overwrite" (max_concurrent_tasks > 1) | "incremental" (max_concurrent_tasks = 1),
          navigation_items={内存中构建的导航对象}
      )
 ```

 #### 最终验证阶段

 ```
 Wiki Orchestrator
     ↓ wiki_validate_links(wiki_root="输出目录")
     ↓ 扫描所有 .md 文件
     ↓ 验证内部链接 [text](link)
     ↓ 返回: 链接验证报告
     ↓ wiki_save_state(final_status="completed")
     ↓ 输出完成报告
 ```

 ### 5.3 任务调度工具详细说明

 #### wiki_start_task

 启动一个分析任务。

 **参数**：
```typescript
{
  agent: string;        // "wiki-analyzer"
  prompt: string;       // 分析任务描述
  task_id?: string;     // 可选的任务 ID（默认自动生成）
  timeout?: number;     // 超时时间（毫秒，默认 120000）
}
```

 **返回值**：
```typescript
{
  task_id: string;      // 任务唯一标识
  status: "started";
}
```

 **实现说明**：
- 在插件内部维护任务队列
- 使用线程池或进程池执行分析任务
- 任务执行时调用 Wiki Analyzer Agent
- 支持并发任务限制（不超过 `max_concurrent_tasks`）

 #### wiki_get_result

 获取任务执行结果。

 **参数**：
```typescript
{
  task_id: string;
  block?: boolean;      // 是否阻塞等待（默认 true）
  timeout?: number;     // 阻塞超时时间（毫秒，默认 300000）
}
```

 **返回值**：
```typescript
// 任务成功完成
{
  task_id: string;
  status: "completed";
  result: GlobalAnalysisResult | UnitAnalysisResult;
  duration: number;    // 执行耗时（毫秒）
}

// 任务执行失败
{
  task_id: string;
  status: "failed";
  error: string;
}

// 任务仍在执行（block=false）
{
  task_id: string;
  status: "running";
  progress?: number;   // 进度百分比（0-100）
}
```

 #### wiki_cancel_task

 取消一个正在运行的任务。

 **参数**：
```typescript
{
  task_id: string;
}
```

 **返回值**：
```typescript
{
  task_id: string;
  status: "cancelled";
}
```

 **实现说明**：
- 尝试优雅停止任务
- 清理任务占用的资源
- 标记任务状态为 `cancelled`

 ### 5.4 分析工具详细说明

 #### wiki_scan_structure

 扫描目录结构。

 **参数**：
```typescript
{
  target_path: string;       // 目标路径
  exclude_patterns?: string[]; // 排除模式（glob 语法）
  max_depth?: number;         // 最大深度（默认 10）
  max_files?: number;         // 最大文件数（默认 1000）
}
```

 **返回值**：
```typescript
{
  path: string;
  directories: string[];
  files: string[];            // 前 30 个文件
  file_count: number;         // 总文件数
  line_count: number;         // 总行数
}
```

 #### wiki_extract_symbols

 从源代码中提取符号。

 **参数**：
```typescript
{
  file_paths: string[];       // 文件路径列表（支持批量）
  language: string;           // 编程语言
  max_symbols?: number;       // 最大符号数（默认 50）
}
```

 **返回值**：
```typescript
{
  symbols: ExportedSymbol[];
  symbol_count: number;       // 总符号数
  language: string;
}
```

 **实现说明**：
- 优先使用 LSP 工具（Phase 4）
- 降级使用 AST-grep 或正则表达式（Phase 1-3）
- 按符号重要性排序（public 优先，复杂度高优先）

 ### 5.5 生成工具详细说明

 #### wiki_init_structure

 初始化 Wiki 目录结构。

 **参数**：
```typescript
{
  output_dir: string;
  force?: boolean;            // 是否覆盖已存在目录（默认 false）
}
```

 **返回值**：
```typescript
{
  created: boolean;
  created_dirs: string[];
  existing: boolean;          // 目录是否已存在
}
```

 **实现说明**：
- 创建 `wiki/` 目录
- 创建 `wiki/modules/` 子目录
- 创建 `.nojekyll` 文件（GitHub Pages 兼容）
- 如果目录已存在且 `force=false`，检查是否为空目录

 #### wiki_write_page

 写入 Markdown 文件。

 **参数**：
```typescript
{
  rel_path: string;           // 相对于 output_dir 的路径
  content: string;
  title?: string;
  overwrite?: boolean;        // 是否覆盖已存在文件（默认 true）
}
```

 **返回值**：
```typescript
{
  path: string;
  created: boolean;
  updated: boolean;
}
```

 **实现说明**：
- 使用原子操作（写临时文件 → rename）
- 确保路径不超出 `output_dir`（安全检查）
- 自动创建必要的子目录

 #### wiki_update_nav

 更新导航文件（_sidebar.md）。

 **参数**：
```typescript
{
  mode: "incremental" | "overwrite";
  items?: NavigationItem[];   // 仅 overwrite 模式使用
  item?: {                    // 仅 incremental 模式使用
    title: string;
    path: string;
    level?: number;
  };
}
```

 **返回值**：
```typescript
{
  updated: boolean;
  path: string;
  total_items: number;
}
```

 **实现说明**：
- **Incremental 模式**：读取 → 追加 → 写入（原子操作）
- **Overwrite 模式**：直接写入完整的 Markdown 列表（原子操作）
- 自动排序（按 position，然后按 title）

 ### 5.6 状态管理工具详细说明

 #### wiki_load_state

 加载生成状态。

 **参数**：
```typescript
{
  output_dir: string;
}
```

 **返回值**：
```typescript
{
  loaded: boolean;
  state: {
    completed_items: string[];    // 已完成的 item.id 列表
    failed_items: string[];        // 失败的 item.id 列表
    start_time: string;
    last_update: string;
    config_hash: string;          // 配置文件哈希（用于检测配置变更）
  } | null;
}
```

 **实现说明**：
- 从 `wiki/.opencode-wiki/state.json` 读取
- 如果文件不存在，返回 `state: null`

 #### wiki_save_state

 保存生成状态。

 **参数**：
```typescript
{
  output_dir: string;
  state: {
    completed_items: string[];
    failed_items: string[];
    start_time?: string;
    config_hash: string;
  };
}
```

 **返回值**：
```typescript
{
  saved: boolean;
  path: string;
}
```

 **实现说明**：
- 写入 `wiki/.opencode-wiki/state.json`
- 使用原子操作（写临时文件 → rename）

 ### 5.7 工具实现优先级

  #### Phase 1: 基础工具（MVP）- 2 周

  **任务列表**：

  - [x] 工具定义（占位符已完成）

  - [ ] 实现内置任务调度器
    - [ ] 任务队列管理
    - [ ] 线程池/进程池执行
    - [ ] 并发控制（max_concurrent_tasks 限制）
    - [ ] `wiki_start_task` 工具实现
    - [ ] `wiki_get_result` 工具实现
    - [ ] `wiki_cancel_task` 工具实现

  - [ ] 实现分析工具
    - [ ] `wiki_scan_structure` 工具实现（基于文件系统遍历）
    - [ ] `wiki_extract_symbols` 工具实现（基于正则/AST）
    - [ ] 实现 Top N 选择逻辑
    - [ ] 添加统计信息计算

  - [ ] 实现生成工具
    - [ ] `wiki_init_structure` 工具实现
    - [ ] `wiki_write_page` 工具实现（原子写入）
    - [ ] `wiki_update_nav` 工具实现（自动选择模式）
    - [ ] 路径安全检查

  - [ ] 实现状态管理工具
    - [ ] `wiki_load_state` 工具实现
    - [ ] `wiki_save_state` 工具实现
    - [ ] 增量更新逻辑

  - [ ] 实现 `wiki_validate_links` 工具

  - [ ] 定义 Wiki Orchestrator Agent Prompt
    - [ ] 三阶段工作流指令
    - [ ] 内置任务调度器使用指南
    - [ ] 导航更新策略说明

  - [ ] 定义 Wiki Analyzer Agent Prompt
    - [ ] 全局分析模式指令
    - [ ] 单元分析模式指令
    - [ ] 输出结构限制说明

  - [ ] 实现基础的三阶段工作流
    - [ ] 全局分析 → 生成清单
    - [ ] 循环并发生成（使用内置任务调度器）
    - [ ] 最终验证

  - [ ] 实现并发控制逻辑
    - [ ] 动态并发数调整
    - [ ] 任务依赖检查
    - [ ] 超时处理

  - [ ] 实现 JSON 配置 schema
    - [ ] 配置验证
    - [ ] 默认值处理

 #### Phase 4: 深度代码理解（进阶）- 4 周
 - 🟡 集成 LSP 工具（`lsp_hover`, `lsp_document_symbols`）
 - 🟡 集成 AST-grep 工具（`ast_grep_search`）
 - 🟡 改进符号提取精度（基于 LSP）
 - 🟡 实现调用图分析
 - 🟡 实现设计模式检测
 ```

### 6.3 OpenCode 集成配置

```json
{
  "plugin": [
    "opencode-wiki"
  ],
  "wiki-generator": {
    "enabled": true,
    "slash_command": "/wiki"
  }
}
```

### 6.4 配置说明

#### output_dir
- **默认值**：`./wiki`
- **说明**：Wiki 文档的输出目录

 #### navigation_mode
 - **说明**：导航更新模式由系统自动选择，无需手动配置
   - 当 `max_concurrent_tasks = 1` 时，使用 `incremental` 模式
   - 当 `max_concurrent_tasks > 1` 时，使用 `overwrite` 模式

 #### exclude_patterns
 - **类型**：`string[]`
 - **默认值**：`["**/node_modules/**", "**/dist/**"]`
 - **说明**：使用 glob 模式排除不需要分析的目录

 #### overwrite_existing
 - **类型**：`boolean`
 - **默认值**：`false`
 - **说明**：是否覆盖已存在的内容（谨慎使用）

 #### generation.enable_incremental
 - **类型**：`boolean`
 - **默认值**：`true`
 - **说明**：是否支持增量生成（中断后可以继续）

#### agents.orchestrator
- **model**：主编排 Agent 使用的模型（推荐使用推理能力强的模型）
- **temperature**：建议 `0.0-0.2`（确保指令遵循）

#### agents.analyzer
- **model**：分析 Agent 使用的模型（推荐使用快速、上下文窗口大的模型）
- **temperature**：建议 `0.0`（确保分析准确性）

#### parallelism.max_concurrent_tasks
- **默认值**：`3`
- **范围**：`1-10`
- **说明**：最大并发任务数，建议根据项目大小调整

 #### generation.*
 - **include_overview**：是否生成项目总览
 - **include_modules**：是否生成模块文档
 - **include_api_docs**：是否生成 API 参考
 - **include_diagrams**：是否生成架构图
 - **include_guides**：是否生成使用指南
 - **enable_incremental**：是否支持增量生成（中断后可以继续）

 #### limits.*
 数据规模控制配置，确保大型项目稳定运行：

 - **max_files_per_analysis**：单次分析的最大文件数（默认 1000）
 - **max_symbols_per_unit**：单元分析的最大符号数（默认 50）
 - **max_modules_global**：全局分析的最大模块数（默认 20）
 - **max_lines_per_file**：单个文件的最大行数，超过则摘要处理（默认 1000）

 **设计原则**：
- 优先返回重要数据（Top N）
- 使用统计信息补充完整视图
- 避免超出 token/tool 限制

 #### security.*
 安全配置：

 - **skip_sensitive_files**：是否跳过包含敏感信息的文件（默认 true）
 - **sensitive_keywords**：敏感关键词列表（默认包含常见密钥相关词汇）

 **安全措施**：
- 路径遍历防护（确保输出路径不超出 output_dir）
- 敏感信息检测（生成文档时自动脱敏）
- 隐私文件排除（默认排除 .env, credentials 等）
 ```
wiki/
├── index.md                      # 项目总览 (由 Global Analysis + Generation 生成)
├── _sidebar.md                   # 侧边栏导航 (增量更新)
├── modules/                      # 模块文档
│   ├── auth-system.md            # 认证系统 (Unit Analysis + Generation)
│   ├── api-gateway.md            # API 网关
│   ├── database-service.md        # 数据库服务
│   └── payment-service.md        # 支付服务
├── api/                          # API 参考 (可选)
│   └── index.md                 # API 索引
└── guides/                       # 使用指南 (可选)
    ├── getting-started.md
    └── setup.md
```

### 7.2 导航文件示例 (_sidebar.md)

```markdown
<!-- Incremental 更新模式 - 每次追加 -->

* [项目总览](index.md)

* 模块文档
  * [认证系统](modules/auth-system.md)
  * [API 网关](modules/api-gateway.md)
  * [数据库服务](modules/database-service.md)
  * [支付服务](modules/payment-service.md)

* API 参考
  * [API 索引](api/index.md)

* 使用指南
  * [快速开始](guides/getting-started.md)
  * [配置指南](guides/setup.md)
```

### 7.3 文档内容示例 (modules/auth-system.md)

```markdown
---
title: 认证系统
sidebar_position: 10
---

# 认证系统

> 负责用户身份验证、授权和会话管理的核心模块

## 概述

认证系统是整个应用的安全入口，提供以下核心功能：

- **用户登录**：支持邮箱/用户名登录
- **密码哈希**：使用 bcrypt 进行安全哈希
- **JWT Token**：生成和验证 JSON Web Token
- **会话管理**：维护用户会话状态

## 架构

```
src/auth/
├── AuthService.ts          # 核心认证服务
├── middleware.ts           # 认证中间件
├── models/                # 数据模型
│   └── User.ts
├── controllers/           # 控制器
│   └── AuthController.ts
└── utils/
    ├── hash.ts
    └── jwt.ts
```

## 关键组件

### AuthService

核心认证服务类，负责：

- 用户认证
- 密码验证
- Token 生成
- Token 刷新

### AuthMiddleware

Express 中间件，用于：

- 验证请求头中的 Token
- 拦截未授权请求
- 注入用户信息到请求上下文

## 依赖关系

### 内部依赖
- `src/utils` - 工具函数
- `src/db` - 数据库访问层

### 外部依赖
- `bcrypt` (^5.0.1) - 密码哈希
- `jsonwebtoken` (^9.0.0) - JWT 处理

## 使用示例

### 用户登录

```typescript
import { AuthService } from '@/auth/AuthService';

const authService = new AuthService();

const result = await authService.login({
  email: 'user@example.com',
  password: 'secure_password'
});

if (result.success) {
  console.log('Token:', result.token);
}
```

### 验证 Token

```typescript
import { AuthMiddleware } from '@/auth/middleware';

app.use('/api', AuthMiddleware);
```

## 相关文档

- [API 网关](../api-gateway.md)
- [数据库服务](../database-service.md)
```

---

## 8. 关键设计决策

### 8.1 三阶段模式 vs 两阶段模式

| 模式 | 优点 | 缺点 |
|------|------|------|
| **三阶段（本设计）** | 灵活，支持增量生成，导航实时更新 | 实现复杂度较高 |
| **两阶段（原设计）** | 简单，批量生成效率高 | 不支持增量，导航需要一次性重写 |

**决策：采用三阶段模式**
- 理由：支持长时间运行的生成任务，中断后可以继续
- 适合大型项目的文档生成

### 8.2 并发控制策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **Fixed** | 固定并发数 | 小型项目，已知任务数 |
| **Dynamic** | 动态调整并发数 | 大型项目，任务数不确定 |

**决策：默认 Dynamic 策略**
- 全局分析：1 个任务
- 总览文档：1 个任务（串行）
- 模块文档：max_concurrent_tasks 个任务（并发）

 ### 8.3 Agent 模型选择

 | Agent | 推荐模型 | 理由 |
 |-------|-----------|------|
 | Wiki Orchestrator | Claude Opus 4.5 / GPT-5.2 | 需要强推理能力，处理复杂协调逻辑 |
 | Wiki Analyzer | Gemini 3 Flash / Claude Haiku 4.5 | 需要快速处理大量代码，大上下文窗口，低成本 |
 | 内置任务调度器 | 本地执行 | 不需要 AI 模型，使用插件内部逻辑 |

 **模型选择原则**：
- **Orchestrator**：推理能力强，温度低（0.1-0.2），确保指令遵循
- **Analyzer**：速度快，上下文窗口大，温度低（0.0），确保分析准确性
- **成本优化**：Analyzer 会被调用多次，应选择成本较低的模型
- **Token 限制**：所有输出都受配置限制，确保不超出模型上下文窗口

 ### 8.4 导航更新模式

 **决策：根据并发数自动选择**

 | 并发数 | 选择模式 | 理由 |
 |--------|---------|------|
 | max_concurrent_tasks = 1 | Incremental | 串行执行，安全地追加更新 |
 | max_concurrent_tasks > 1 | Overwrite | 避免并发写入竞争，保证一致性 |

 **实现细节**：
- 系统自动判断，无需用户配置
- **Incremental**：每次追加，支持实时进度反馈
- **Overwrite**：最后一次性写入，避免竞争

  **优势**：
 - 用户体验好（并发场景性能最佳）
 - 实现简单（无需手动选择模式）
 - 避免竞争条件（并发场景安全）

  **IMPORTANT**:
  - Orchestrator 使用内置任务调度器（`wiki_start_task`, `wiki_get_result`）
  - Analyzer 是只读 Agent，不执行任何写入操作
  - 导航更新模式根据并发数自动选择（`max_concurrent_tasks`）

 </Role>
```

### B. Wiki Analyzer System Prompt (核心指令)

```markdown
# WIKI ANALYZER SYSTEM PROMPT

<Role>
You are a Code Analysis Engine. Your sole purpose is to read code and extract structured metadata for documentation generation.
You DO NOT write documentation. You generate the *data* that writers use.
</Role>

 <Analysis_Modes>
 ## Global Analysis Mode
 When the task is "Analyze the entire project":
 1. **Scan Structure**: Use `wiki_scan_structure` to traverse project root.
 2. **Identify Type**: Determine project type (Web Application / Library / CLI Tool / Mobile App / Microservices).
 3. **List Modules**: Identify main modules by:
    - Directory structure (src/, lib/, cmd/, ...)
    - Configuration files (package.json, go.mod, Cargo.toml)
    - Entry points (main.go, index.ts, cli.ts)
 4. **Extract Features**: Identify key features from:
    - package.json (keywords, description)
    - README.md (feature lists)
    - Code comments
 5. **Return**: GlobalAnalysisResult format with:
    - project_type
    - primary_language
    - tech_stack (max 10 items)
    - entry_points (max 5 items)
    - main_modules (max 20 items, with id, name, path, description, priority, size)
    - key_features (max 10 items)
    - stats (file_counts_by_extension)

 **IMPORTANT**: Respect size limits. Return top-N most important items, not everything.
 Use statistics to provide context (e.g., "50 TypeScript files, 15 Python files").

 ## Unit Analysis Mode
 When the task is "Analyze {path}: {name}":
 1. **Scan Target**: Use `wiki_scan_structure` on the specific path.
 2. **Extract Symbols**: Use `wiki_extract_symbols` on all source files in that path.
 3. **Analyze Dependencies**: Identify:
    - Internal: Which other modules are imported? (max 20 items)
    - External: Which npm/pip packages are used? How are they used? (max 20 items)
 4. **Identify Features**: What does this module do? What are its key capabilities? (max 10 items)
 5. **Return**: UnitAnalysisResult format with:
    - unit_id, unit_name, unit_type, unit_path
    - language
    - structure (files_top: max 30 items, file_count, directories: max 20 items, line_count)
    - exports_top (max 50 items, with importance scores)
    - exports_count
    - dependencies (internal: max 20 items, external: max 20 items)
    - key_features (max 10 items)
    - file_hash (for incremental updates)

 **IMPORTANT**:
- Only return top-N files and symbols based on importance (public > private, complex > simple).
- Include counts (file_count, exports_count) for full context.
- Generate file_hash based on top files' content for change detection.

## Unit Analysis Mode
When the task is "Analyze {path}: {name}":
1. **Scan Target**: Use `wiki_scan_structure` on the specific path.
2. **Extract Symbols**: Use `wiki_extract_symbols` on all source files in that path.
3. **Analyze Dependencies**: Identify:
   - Internal: Which other modules are imported?
   - External: Which npm/pip packages are used? How are they used?
4. **Identify Features**: What does this module do? What are its key capabilities?
5. **Return**: UnitAnalysisResult format with:
   - unit_id, unit_name, unit_type
   - unit_path
   - structure (files, directories)
   - exports (classes, functions, interfaces with signatures)
   - dependencies (internal, external)
   - key_features

<Output_Format>
You MUST output your analysis in valid JSON format that matches the interface definitions.
Be precise and thorough. Do not hallucinate.
</Output_Format>
```
 ## 9. 实现路线图

 ### Phase 1: 基础架构（MVP）- 2 周

 #### 当前状态：🚧 进行中

 **任务列表**：

 - [x] 工具定义（占位符已完成）

 - [ ] 实现内置任务调度器
   - [ ] 任务队列管理
   - [ ] 线程池/进程池执行
   - [ ] 并发控制（max_concurrent_tasks 限制）
   - [ ] `wiki_start_task` 工具实现
   - [ ] `wiki_get_result` 工具实现
   - [ ] `wiki_cancel_task` 工具实现

 - [ ] 实现分析工具
   - [ ] `wiki_scan_structure` 工具实现（基于文件系统遍历）
   - [ ] `wiki_extract_symbols` 工具实现（基于正则/AST）
   - [ ] 实现 Top N 选择逻辑
   - [ ] 添加统计信息计算

 - [ ] 实现生成工具
   - [ ] `wiki_init_structure` 工具实现
   - [ ] `wiki_write_page` 工具实现（原子写入）
   - [ ] `wiki_update_nav` 工具实现（自动选择模式）
   - [ ] 路径安全检查

 - [ ] 实现状态管理工具
   - [ ] `wiki_load_state` 工具实现
   - [ ] `wiki_save_state` 工具实现
   - [ ] 增量更新逻辑

 - [ ] 实现 `wiki_validate_links` 工具

 - [ ] 定义 Wiki Orchestrator Agent Prompt
   - [ ] 三阶段工作流指令
   - [ ] 内置任务调度器使用指南
   - [ ] 导航更新策略说明

 - [ ] 定义 Wiki Analyzer Agent Prompt
   - [ ] 全局分析模式指令
   - [ ] 单元分析模式指令
   - [ ] 输出结构限制说明

 - [ ] 实现基础的三阶段工作流
   - [ ] 全局分析 → 生成清单
   - [ ] 循环并发生成（使用内置任务调度器）
   - [ ] 最终验证

 - [ ] 实现并发控制逻辑
   - [ ] 动态并发数调整
   - [ ] 任务依赖检查
   - [ ] 超时处理

 - [ ] 实现 JSON 配置 schema
   - [ ] 配置验证
   - [ ] 默认值处理

 ### Phase 2: 并行处理优化 - 1 周

 - [ ] 实现任务超时处理
 - [ ] 实现失败重试策略
 - [ ] 实现任务取消级联（取消主任务时取消所有子任务）
 - [ ] 实现进度报告机制
 - [ ] 实现日志记录和调试支持
 - [ ] 性能测试和优化

 ### Phase 3: 多语言支持 - 3 周

 - [ ] 定义语言适配器接口 `LanguageAdapter`
 - [ ] 实现 TypeScript/JavaScript 适配器
 - [ ] 实现 Go 语言适配器
 - [ ] 实现 Python 语言适配器
 - [ ] 实现语言自动检测逻辑
 - [ ] 测试不同语言项目的文档生成

 ### Phase 4: 深度代码理解 - 4 周

 - [ ] 集成 LSP 客户端
 - [ ] 实现 LSP 工具封装（`lsp_query`）
 - [ ] 实现 LSP Server 生命周期管理
 - [ ] 集成 AST-grep 工具
 - [ ] 改进符号提取精度（基于 LSP）
 - [ ] 实现调用图分析
 - [ ] 实现设计模式检测

 ### Phase 5: MCP 与高级功能 - 3 周

 - [ ] 实现 MCP 服务器（wiki-context-server）
 - [ ] 集成 Git 历史分析
 - [ ] 集成外部依赖文档获取
 - [ ] 实现增量更新模式（基于文件变更）
 - [ ] 实现文档与代码一致性检查

 ### Phase 6: 质量与稳定性 - 2 周

 - [ ] 实现质量检查规则系统
 - [ ] 实现链接验证与自动修复
 - [ ] 实现文档与源码一致性检查
 - [ ] 实现质量报告生成
 - [ ] 性能优化与资源管理
 - [ ] 错误处理和用户友好的错误消息

 ### Phase 7: 国际化支持 - 3 周

 - [ ] 设计并实现翻译配置系统
 - [ ] 实现 Wiki Translator Subagent
 - [ ] 实现术语表管理系统
 - [ ] 实现多语言输出结构生成
 - [ ] 实现翻译质量检查

 ### Phase 8: 文档与发布 - 1 周

 - [ ] 编写用户文档和配置指南
 - [ ] 编写插件开发者指南
 - [ ] 创建示例项目和演示
 - [ ] 发布 v1.0 版本

 ## 10. 与 oh-my-opencode 的对应关系

 ### 10.1 架构对应

 | oh-my-opencode | opencode-wiki (本设计) | 对应关系 |
 |--------------|---------------------|----------|
 | **Sisyphus** (主 Agent) | **Wiki Orchestrator** (主编排 Agent) | 相同的编排能力，但 opencode-wiki 使用内置任务调度器 |
 | **explore** (背景 Agent) | **Wiki Analyzer** (分析 Agent) | 相同的只读分析模式，都返回结构化数据 |
 | **document-writer** | **Wiki Orchestrator** (生成 Markdown) | 相同的文档生成逻辑，opencode-wiki 由 Orchestrator 直接生成 |
 | **oracle** (架构咨询) | N/A | opencode-wiki 不需要独立的架构咨询 Agent |
 | **frontend-ui-ux-engineer** | N/A | opencode-wiki 不涉及前端 UI |
 | **background_task** | **内置任务调度器** | 功能相似，但实现方式不同 |
 | **LSP 工具集成** | **LSP 工具集成** (Phase 4) | 相同的工具封装方式 |

 ### 10.2 工作流程对应

 | oh-my-opencode 模式 | opencode-wiki 模式 |
 |-----------------|-----------------|
 | 主 Agent 调度多个子 Agent 并行执行特定任务 | 主 Agent 循环调度内置任务调度器 + Analyzer + 自生成，并发处理多个内容单元 |
 | 子 Agent 独立完成特定类型任务 | Analyzer 独立完成分析，Orchestrator 负责生成和协调 |
 | 通过 Todo 列表跟踪进度 | 通过 GenerationList 跟踪进度 |
 | 全量并行启动所有任务 | 分阶段启动（全局分析 → 循环并发生成 → 验证） |

 ### 10.3 配置对应

 | oh-my-opencode | opencode-wiki |
 |--------------|--------------|
 | `agents.{agent_name}.model` | `agents.orchestrator.model`, `agents.analyzer.model` |
 | `sisyphus_agent` 配置 | 直接在插件配置中定义 |
 | Hooks 系统 | event hooks（OpenCode 标准） |

 ### 10.4 核心理念总结

 两个项目共享的核心设计理念：

 1. **多 Agent 协作**：通过专业化 Agent 提高效率
 2. **并行处理**：使用任务调度实现大规模并发
 3. **工具权限控制**：精细控制每个 Agent 的能力范围
 4. **事件驱动**：通过 hooks 集成到 OpenCode 生命周期
 5. **配置优先级**：项目级配置覆盖用户级配置

 ### 10.5 关键差异

 | 维度 | oh-my-opencode | opencode-wiki |
 |------|--------------|--------------|
 | **任务调度** | 使用 `background_task` (oh-my-opencode 提供) | 使用内置任务调度器 (插件自实现) |
 | **依赖关系** | 依赖 oh-my-opencode 框架 | 自包含，独立运行 |
 | **导航更新** | 手动选择模式 | 根据并发数自动选择 |
 | **数据规模** | 无限制 | 受控大小 (Top N + 统计) |
 | **可恢复性** | 通过 Todo 列表 | 通过状态文件 |

 ### 10.6 选用内置任务调度器的理由

 本设计选择实现内置任务调度器，而非依赖 oh-my-opencode 的 `background_task`，主要基于以下考虑：

 1. **自包含性**：插件可以独立运行，不需要外部依赖
 2. **可控性**：完全掌握任务调度的实现细节，易于调试和优化
 3. **特定优化**：针对文档生成场景进行优化（如任务优先级、依赖管理）
 4. **稳定性**：避免外部框架变更导致兼容性问题

 **权衡**：需要额外的开发工作来实现任务调度器，但换来更好的可控性和独立性。

 ### C. 实现检查清单

在实现每个阶段时，使用此清单验证：

- [ ] 工具返回值符合 TypeScript 接口定义
- [ ] LSP 诊断检查（lsp_diagnostics）
- [ ] JSON 配置 schema 验证
- [ ] 并发任务不超出配置上限
- [ ] 导航文件格式正确
- [ ] Markdown 语法正确
- [ ] 链接验证覆盖所有内部链接

---

 **文档版本**: 2.1
 **最后更新**: 2026-01-05
 **维护者**: chao243
 **修订说明**:
 - v2.0 → v2.1: 基于 Oracle 架构审查进行以下修订：
   1. 采用内置任务调度器替代 oh-my-opencode 的 background_task
   2. 导航更新模式改为自动选择（根据并发数）
   3. 为所有接口添加可扩展性限制（Top N + 统计）
   4. 补充状态管理工具，支持增量生成
   5. 添加详细实现路线图和与 oh-my-opencode 对应关系

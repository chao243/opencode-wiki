# OpenCode 插件开发测试指南

本指南介绍如何开发、测试和调试 OpenCode 插件。

## 目录

- [插件开发基础](#插件开发基础)
- [测试方法](#测试方法)
- [单元测试策略](#单元测试策略)
- [集成测试](#集成测试)
- [测试分层](#测试分层)
- [开发工作流](#开发工作流)
- [关键测试点](#关键测试点)
- [Mock 策略](#mock-策略)
- [最佳实践](#最佳实践)
- [参考资源](#参考资源)

---

## 插件开发基础

### 插件结构

OpenCode 插件是一个 TypeScript/JavaScript 模块，导出一个异步函数：

```typescript
import type { Plugin } from "@opencode-ai/plugin";

const myPlugin: Plugin = async (ctx) => {
  // ctx 包含:
  // - project: 项目信息
  // - client: OpenCode 客户端实例
  // - $: 工具函数集合
  // - directory: 工作目录
  // - worktree: Git worktree 信息

  return {
    // 返回插件配置
    hooks: {
      // Hooks 定义
    },
    tools: [
      // 工具列表
    ],
    agents: [
      // Agent 列表
    ],
    mcpServers: [
      // MCP 服务器列表
    ],
  };
};

export default myPlugin;
```

### 核心类型

```typescript
// 来自 @opencode-ai/plugin
import type {
  Plugin,
  Tool,
  AgentConfig,
  Hook,
} from "@opencode-ai/plugin";

// 来自 @opencode-ai/sdk
import {
  createOpencode,
  type OpencodeClient,
} from "@opencode-ai/sdk";
```

---

## 测试方法

### 1. 单元测试

使用 Bun Test 作为测试框架：

```bash
# 安装测试依赖（项目已包含）
bun install

# 运行所有测试
bun test

# 运行特定测试文件
bun test src/tools/session-manager/tools.test.ts
```

### 2. 本地加载测试

#### 方式 1: 本地文件路径（推荐用于开发）

```bash
# 1. 构建项目
bun run build

# 2. 修改 OpenCode 配置文件 (~/.config/opencode/opencode.json)
{
  "plugin": [
    "file:///absolute/path/to/your-plugin/dist/index.js"
  ]
}

# 例如:
{
  "plugin": [
    "file:///Users/yourname/projects/oh-my-opencode/dist/index.js"
  ]
}
```

#### 方式 2: 项目级插件目录

```
your-project/
├── opencode.json
└── .opencode/
    └── plugin/
        └── my-plugin.js  # 或 TypeScript 源文件
```

```
# 全局插件目录
~/.config/opencode/plugin/
└── my-plugin.js
```

### 3. NPM 包发布测试

```json
{
  "plugin": [
    "opencode-helicone-session",
    "opencode-wakatime",
    "@my-org/custom-plugin"
  ]
}
```

---

## 单元测试策略

### Mock 工具上下文

```typescript
import { test, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin/tool";

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
};

test("my tool executes correctly", async () => {
  const result = await myTool.execute({}, mockContext);
  expect(typeof result).toBe("string");
});
```

### Mock OpenCode Client

```typescript
import { mock } from "bun:test";

const mockClient = {
  session: {
    messages: mock(() => Promise.resolve({ data: [] })),
    summarize: mock(() => Promise.resolve()),
    prompt_async: mock(() => Promise.resolve()),
    create: mock(() => Promise.resolve({ data: { id: "test-session" } })),
  },
  tui: {
    showToast: mock(() => Promise.resolve()),
  },
};
```

### BDD 风格测试

```typescript
test("should prune tasks older than 30 minutes", () => {
  // #given
  const staleDate = new Date(Date.now() - 31 * 60 * 1000);
  const task = createMockTask({
    id: "task-stale",
    startedAt: staleDate,
  });

  // #when
  const result = manager.pruneStaleTasksAndNotifications();

  // #then
  expect(result.prunedTasks).toContain("task-stale");
  expect(manager.getTaskCount()).toBe(0);
});
```

---

## 集成测试

### 使用 createOpencode 启动会话

```typescript
import { createOpencode } from "@opencode-ai/sdk";
import { test, expect, beforeEach } from "bun:test";

describe("Plugin Integration Tests", () => {
  let client: any;
  let server: any;

  beforeEach(async () => {
    const abortController = new AbortController();

    const result = await createOpencode({
      signal: abortController.signal,
    });

    client = result.client;
    server = result.server;
  });

  test("creates session and sends message", async () => {
    // 创建会话
    const sessionRes = await client.session.create({
      body: { title: "test session" },
    });

    const sessionID = sessionRes.data?.id;
    expect(sessionID).toBeDefined();

    // 发送消息
    await client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: "Sisyphus",
        parts: [{ type: "text", text: "test message" }],
      },
      query: { directory: "/test/path" },
    });
  });

  afterEach(() => {
    server?.close();
  });
});
```

### 完整插件加载测试

```typescript
import type { Plugin } from "@opencode-ai/plugin";

test("plugin loads successfully", async () => {
  const ctx = {
    project: { name: "test-project" },
    client: mockClient,
    $: {},
    directory: "/test",
    worktree: null,
  };

  const plugin = await myPlugin(ctx);

  // 验证插件返回正确的结构
  expect(plugin).toHaveProperty("tools");
  expect(plugin).toHaveProperty("hooks");
  expect(Array.isArray(plugin.tools)).toBe(true);
});
```

---

## 测试分层

| 测试类型 | 测试内容 | 测试方法 | 速度 |
|---------|---------|---------|------|
| **单元测试** | 工具执行、Hook 逻辑、工具函数 | Mock Context, Mock Client | 快 |
| **集成测试** | 完整插件加载、模块交互 | `createOpencode` + 真实会话 | 中 |
| **手动测试** | 实际使用场景、端到端流程 | 本地文件路径 + OpenCode 启动 | 慢 |

### 推荐测试金字塔

```
         /\
        /E2E\     手动测试 (少量)
       /------\
      / 集成 \     集成测试 (中等)
     /----------\
    /   单元测试   \  单元测试 (大量)
   /______________\
```

---

## 开发工作流

### 1. 项目配置

确保 `package.json` 包含必要的脚本：

```json
{
  "name": "my-opencode-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm",
    "build:types": "tsc --emitDeclarationOnly",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "dev": "bun run build && bun test"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.7.3"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.0.162",
    "@opencode-ai/sdk": "^1.0.162"
  }
}
```

### 2. 开发步骤

```bash
# 1. 编写代码
vim src/my-feature.ts

# 2. 类型检查
bun run typecheck

# 3. 单元测试
bun test

# 4. 构建
bun run build

# 5. 本地测试（通过 opencode.json 加载）
# 编辑 ~/.config/opencode/opencode.json:
{
  "plugin": [
    "file:///absolute/path/to/your-plugin/dist/index.js"
  ]
}

# 6. 重启 OpenCode
opencode

# 7. 手动验证
# 在 OpenCode 中测试新功能
```

### 3. 快速迭代技巧

```bash
# 使用 watch 模式（如果支持）
bun --watch test

# 或者使用 nodemon
bunx nodemon --exec 'bun run build && bun test'

# 保存时自动重新加载插件
# 在开发时使用本地文件路径，OpenCode 会检测文件变化
```

---

## 关键测试点

### 工具测试示例

```typescript
describe("Session Manager Tools", () => {
  test("session_list executes without error", async () => {
    const result = await session_list.execute({}, mockContext);
    expect(typeof result).toBe("string");
  });

  test("session_list respects limit parameter", async () => {
    const result = await session_list.execute({ limit: 5 }, mockContext);
    expect(typeof result).toBe("string");
  });

  test("session_read handles non-existent session", async () => {
    const result = await session_read.execute(
      { session_id: "ses_nonexistent" },
      mockContext
    );
    expect(result).toContain("not found");
  });
});
```

### Hook 测试示例

```typescript
describe("Context Window Recovery Hook", () => {
  test("clears lock on successful summarize completion", async () => {
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    });

    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory);

    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false);
  });

  test("prevents concurrent compaction attempts", async () => {
    autoCompactState.compactionInProgress.add(sessionID);

    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory);

    expect(mockClient.tui.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: "Compact In Progress",
          variant: "warning",
        }),
      })
    );
  });
});
```

### 状态管理测试示例

```typescript
describe("Background Agent Manager", () => {
  test("should return all nested descendants (3 levels deep)", () => {
    // Session A -> Task B -> Task C -> Task D
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID: "session-a",
    });
    const taskC = createMockTask({
      id: "task-c",
      sessionID: "session-c",
      parentSessionID: "session-b",
    });
    const taskD = createMockTask({
      id: "task-d",
      sessionID: "session-d",
      parentSessionID: "session-c",
    });
    manager.addTask(taskB);
    manager.addTask(taskC);
    manager.addTask(taskD);

    const result = manager.getAllDescendantTasks("session-a");

    expect(result).toHaveLength(3);
    expect(result.map((t) => t.id)).toContain("task-b");
    expect(result.map((t) => t.id)).toContain("task-c");
    expect(result.map((t) => t.id)).toContain("task-d");
  });
});
```

### 重点测试场景

| 场景 | 测试内容 | 示例文件 |
|------|---------|---------|
| **参数验证** | 必需参数、类型检查、边界值 | `src/tools/session-manager/tools.test.ts` |
| **错误处理** | 异常情况、网络失败、无效输入 | `src/hooks/anthropic-context-window-limit-recovery/executor.test.ts` |
| **生命周期管理** | 初始化、清理、状态转换 | `src/features/background-agent/manager.test.ts` |
| **并发控制** | 锁机制、竞争条件、资源管理 | `src/hooks/anthropic-context-window-limit-recovery/executor.test.ts` |
| **边界情况** | 空数组、null/undefined、极限值 | 所有测试文件 |
| **递归操作** | 树形结构遍历、深度嵌套 | `src/features/background-agent/manager.test.ts` |
| **过期清理** | TTL 机制、定时任务、资源释放 | `src/features/background-agent/manager.test.ts` |

---

## Mock 策略

### 需要模拟的对象

| 对象 | Mock 方法 | 用途 |
|------|----------|------|
| `ToolContext` | 手动构建对象 | 工具测试的上下文 |
| `OpencodeClient` | `mock()` 函数 | SDK API 调用 |
| 文件系统 | `mock()` fs 操作 | 文件读写测试 |
| 网络请求 | `mock()` HTTP 调用 | API 交互测试 |
| 外部依赖 | 创建 test doubles | 隔离第三方库 |

### Mock 模式

```typescript
// 1. 简单 Mock
const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
};

// 2. 使用 Bun 的 mock 函数
import { mock, spyOn } from "bun:test";

const mockSummarize = mock(() => Promise.resolve());
const mockClient = {
  session: {
    summarize: mockSummarize,
  },
};

// 3. Spy 现有函数
const truncateSpy = spyOn(storage, "truncateUntilTargetTokens")
  .mockReturnValue({
    success: true,
    sufficient: true,
  });

// 测试后恢复
truncateSpy.mockRestore();

// 4. 验证调用
expect(mockSummarize).toHaveBeenCalledWith(
  expect.objectContaining({
    path: { id: "test-session" },
  })
);
```

### Mock 外部依赖示例

```typescript
// Mock 文件系统操作
import * as fs from "fs";
const fsMock = mock(fs);

test("reads config file", async () => {
  fsMock.readFileSync.mockReturnValue('{"key": "value"}');

  const config = loadConfig("/path/to/config.json");

  expect(config.key).toBe("value");
  expect(fsMock.readFileSync).toHaveBeenCalledWith(
    "/path/to/config.json",
    "utf-8"
  );
});

// Mock 网络请求
const fetchMock = mock(global.fetch);
fetchMock.mockResolvedValue({
  ok: true,
  json: async () => ({ data: "test" }),
});

test("fetches data from API", async () => {
  const result = await fetchData("https://api.example.com");

  expect(result).toEqual({ data: "test" });
});
```

---

## 最佳实践

### 1. 测试命名

```typescript
// ✅ 好的命名 - 描述性、清晰
test("should prune tasks older than 30 minutes", () => { });

test("clears lock on successful summarize completion", () => { });

// ❌ 不好的命名 - 模糊、无意义
test("test pruning", () => { });

test("it works", () => { });
```

### 2. 测试隔离

```typescript
// 每个测试都应该独立
describe("My Feature", () => {
  let manager: MyManager;

  beforeEach(() => {
    // #given: 每个 test 前重置状态
    manager = new MyManager();
  });

  afterEach(() => {
    // 清理资源
    manager.dispose();
  });

  test("test 1", () => { });
  test("test 2", () => { });
});
```

### 3. 测试覆盖

```typescript
// ✅ 测试所有分支
test("handles both success and failure", async () => {
  // Success path
  const result1 = await myFunction(true);
  expect(result1.success).toBe(true);

  // Failure path
  const result2 = await myFunction(false);
  expect(result2.success).toBe(false);
});

// ❌ 只测试成功路径
test("works", async () => {
  const result = await myFunction(true);
  expect(result.success).toBe(true);
});
```

### 4. 避免测试实现细节

```typescript
// ❌ 测试内部实现
test("sets _status to running", () => {
  expect(instance._status).toBe("running");
});

// ✅ 测试公共行为
test("emits started event", () => {
  const events = [];
  instance.on("started", (e) => events.push(e));
  instance.start();
  expect(events.length).toBe(1);
});
```

### 5. 使用测试辅助函数

```typescript
// 创建可重用的测试工具
function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: "test-task",
    sessionID: "test-session",
    status: "pending",
    startedAt: new Date(),
    ...overrides,
  };
}

describe("Task Manager", () => {
  test("handles task with custom status", () => {
    const task = createMockTask({ status: "completed" });
    expect(task.status).toBe("completed");
  });
});
```

### 6. 测试异步代码

```typescript
// ✅ 正确的异步测试
test("async operation completes", async () => {
  const result = await asyncOperation();
  expect(result).toBe("done");
});

// ✅ 使用 async/await
test("handles errors", async () => {
  await expect(asyncOperation())
    .rejects
    .toThrow("Expected error");
});

// ❌ 忘记 await
test("bad async test", () => {
  asyncOperation();  // 测试会在操作完成前结束
});
```

### 7. 快速失败

```typescript
// 检测长时间运行的测试
test("should complete quickly", async () => {
  const start = Date.now();

  await myOperation();

  const duration = Date.now() - start;
  expect(duration).toBeLessThan(1000);  // < 1秒
});
```

---

## 参考资源

### 官方文档

- **OpenCode 插件文档**: https://opencode.ai/docs/plugins/
- **OpenCode 生态系统**: https://opencode.ai/docs/ecosystem#plugins
- **GitHub Issues**: https://github.com/anomalyco/opencode/issues

### 社区资源

- **插件模板**: https://github.com/zenobi-us/opencode-plugin-template
- **社区插件集合**: https://github.com/ericc-ch/opencode-plugins
- **SDK 开发 Skill**: https://smithery.ai/skills/hhopkins95/opencode-sdk-development
- **插件开发 Skill**: https://claude-plugins.dev/skills/@pr-pm/prpm/creating-opencode-plugins

### 相关项目

- **Oh My OpenCode**: https://github.com/code-yeongyu/oh-my-opencode
  - 完整的插件实现示例
  - 47 个测试文件，涵盖各种测试模式
  - 参考其测试结构和最佳实践

### 学习资源

- **Bun Test 文档**: https://bun.sh/docs/test
- **TypeScript 测试**: https://www.typescriptlang.org/docs/handbook/intro-to-jsdoc.html
- **测试最佳实践**: https://testingjavascript.com/

---

## 常见问题

### Q: 如何调试插件？

**A**: 使用 `console.log` 或 Bun 的调试器：

```typescript
// 在代码中添加调试信息
console.log("Plugin loaded", ctx.project);

// 使用 Bun 调试器
bun --inspect-brk test
```

### Q: 测试失败怎么办？

**A**:
1. 检查 Mock 是否正确
2. 确认异步操作正确处理
3. 查看错误堆栈信息
4. 逐步缩小问题范围

### Q: 如何测试与 OpenCode 集成的功能？

**A**:
1. 使用 `createOpencode` 创建测试客户端
2. Mock 外部依赖（网络、文件等）
3. 测试完整的工作流

### Q: 插件加载失败怎么办？

**A**:
1. 检查 `package.json` 依赖
2. 确认构建输出正确
3. 查看 OpenCode 日志
4. 验证导出格式

---

## 总结

OpenCode 插件测试采用 **分层策略**：

1. **单元测试**：快速验证核心逻辑
2. **集成测试**：验证模块交互
3. **手动测试**：端到端验证

关键原则：

- **测试可预测的逻辑**，而非 AI 模型本身
- **使用 Mock 隔离外部依赖**
- **遵循 BDD 风格**（Given-When-Then）
- **快速反馈**：单元测试 < 100ms，集成测试 < 1s

通过这套测试体系，你可以构建稳定、可靠的 OpenCode 插件！

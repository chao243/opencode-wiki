# OpenCode AI 函数调用机制

OpenCode 使用 **Vercel AI SDK** 的 `streamText` 函数和工具调用功能来实现 AI 与具体函数的交互。

## 目录

- [1. 工具注册](#1-工具注册)
- [2. 工具定义](#2-工具定义)
- [3. 传递给 AI](#3-传递给-ai)
- [4. AI 流式响应处理](#4-ai-流式响应处理)
- [5. 工具执行流程](#5-工具执行流程)
- [6. 工具修复机制](#6-工具修复机制)
- [核心组件](#核心组件)

---

## 1. 工具注册

工具通过 `ToolRegistry` 注册，支持两种方式：

### 内置工具

预定义的工具，如 BashTool、ReadTool、EditTool 等。

```typescript
export async function tools(providerID: string, agent?: Agent.Info) {
  const tools = await all()

  return [
    InvalidTool,
    BashTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    TodoReadTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
    ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
    ...custom, // 自定义工具
  ]
}
```

### 自定义工具

通过插件或项目目录中的 `tool/*.ts` 文件加载。

```typescript
// 从项目目录加载自定义工具
const glob = new Bun.Glob("tool/*.{js,ts}")

for (const dir of await Config.directories()) {
  for await (const match of glob.scan({ cwd: dir, ... })) {
    const namespace = path.basename(match, path.extname(match))
    const mod = await import(match)
    for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
      custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
    }
  }
}

// 从插件加载
const plugins = await Plugin.list()
for (const plugin of plugins) {
  for (const [id, def] of Object.entries(plugin.tool ?? {})) {
    custom.push(fromPlugin(id, def))
  }
}
```

---

## 2. 工具定义

每个工具实现 `Tool.Info` 接口，定义工具的元信息和执行逻辑。

### 接口定义

```typescript
export interface Info<Parameters extends z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<{
    description: string // AI 看到的工具描述
    parameters: Parameters // Zod schema 用于参数验证
    execute(
      args: z.infer<Parameters>,
      ctx: Context,
    ): Promise<{
      title: string // 工具调用标题
      metadata: M // 自定义元数据
      output: string // 返回给 AI 的输出
      attachments?: MessageV2.FilePart[]
    }>
  }>
}
```

### BashTool 示例

```typescript
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(`The working directory to run the command in. Defaults to ${Instance.directory}`)
        .optional(),
      description: z.string().describe("Clear, concise description of what this command does in 5-10 words"),
    }),

    async execute(params, ctx) {
      // 执行实际的命令
      const cwd = params.workdir || Instance.directory
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const proc = spawn(params.command, {
        shell,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      })

      let output = ""
      const append = (chunk: Buffer) => {
        if (output.length <= MAX_OUTPUT_LENGTH) {
          output += chunk.toString()
          ctx.metadata({ metadata: { output, description: params.description } })
        }
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      await new Promise<void>((resolve) => {
        proc.once("exit", () => resolve())
      })

      return {
        title: params.description,
        metadata: { output, exit: proc.exitCode, description: params.description },
        output,
      }
    },
  }
})
```

---

## 3. 传递给 AI

工具被转换为 Vercel AI SDK 的格式，并通过 `streamText` 函数传递给 AI 模型。

```typescript
export async function stream(input: StreamInput) {
  // 解析并过滤工具
  const tools = await resolveTools(input)

  return streamText({
    onError(error) { ... },

    // 工具修复机制
    async experimental_repairToolCall(failed) {
      const lower = failed.toolCall.toolName.toLowerCase()
      if (lower !== failed.toolCall.toolName && tools[lower]) {
        return { ...failed.toolCall, toolName: lower }
      }
      return { ...failed.toolCall, toolName: "invalid" }
    },

    tools,                                    // AI SDK 接受的工具格式
    activeTools: Object.keys(tools).filter(x => x !== "invalid"),
    model: wrapLanguageModel({ model: language, ... }),
    // ...
  })
}
```

### 工具权限过滤

```typescript
async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
  const disabled = PermissionNext.disabled(Object.keys(input.tools), agent.permission)

  for (const tool of Object.keys(input.tools)) {
    // 用户禁用或权限不允许的工具会被移除
    if (user.tools?.[tool] === false || disabled.has(tool)) {
      delete input.tools[tool]
    }
  }

  return input.tools
}
```

---

## 4. AI 流式响应处理

通过 `SessionProcessor` 处理 AI 的流式响应，管理工具调用的生命周期。

### 工具调用事件处理

```typescript
for await (const value of stream.fullStream) {
  switch (value.type) {
    // 1. AI 决定调用工具
    case "tool-call": {
      const part = await Session.updatePart({
        id: toolcalls[value.toolCallId]?.id ?? Identifier.ascending("part"),
        messageID: assistantMessage.id,
        sessionID: sessionID,
        type: "tool",
        tool: value.toolName, // 工具名称
        callID: value.toolCallId, // 调用 ID
        state: {
          status: "running",
          input: value.input, // 工具参数
          time: { start: Date.now() },
        },
        metadata: value.providerMetadata,
      })
      toolcalls[value.toolCallId] = part as MessageV2.ToolPart
      break
    }

    // 2. 工具执行完成，返回结果
    case "tool-result": {
      const match = toolcalls[value.toolCallId]
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            status: "completed",
            input: value.input,
            output: value.output.output, // 工具输出
            metadata: value.output.metadata,
            title: value.output.title,
            time: {
              start: match.state.time.start,
              end: Date.now(),
            },
            attachments: value.output.attachments,
          },
        })
        delete toolcalls[value.toolCallId]
      }
      break
    }

    // 3. 工具执行失败
    case "tool-error": {
      const match = toolcalls[value.toolCallId]
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            status: "error",
            input: value.input,
            error: value.error.toString(),
            time: { start: match.state.time.start, end: Date.now() },
          },
        })
        delete toolcalls[value.toolCallId]
      }
      break
    }
  }
}
```

---

## 5. 工具执行流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. AI 决定调用工具                                              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Vercel AI SDK 发送 tool-call 事件                          │
│    - 工具名称 (toolName)                                       │
│    - 工具参数 (input)                                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. OpenCode 更新 tool part 状态为 "running"                  │
│    - 保存到 Storage                                           │
│    - 发送 Bus 事件                                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Vercel AI SDK 自动调用工具的 execute 函数                   │
│    - 传递参数 (args)                                           │
│    - 传递上下文 (ctx)                                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. 工具执行具体逻辑                                            │
│    - 执行 bash 命令                                           │
│    - 读取/写入文件                                            │
│    - 调用 API                                                 │
│    - 或其他操作                                               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. execute 函数返回结果                                        │
│    - output: 返回给 AI 的输出                                 │
│    - metadata: 自定义元数据                                   │
│    - title: 工具调用标题                                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Vercel AI SDK 发送 tool-result 事件                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. OpenCode 更新 tool part 状态为 "completed"                 │
│    - 保存工具输出                                              │
│    - 保存元数据                                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. AI 看到工具结果，继续生成响应或调用下一个工具                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 工具修复机制

如果 AI 调用了不存在的工具（例如大小写不匹配），`experimental_repairToolCall` 会尝试自动修复。

```typescript
async experimental_repairToolCall(failed) {
  const lower = failed.toolCall.toolName.toLowerCase()

  // 尝试小写版本
  if (lower !== failed.toolCall.toolName && tools[lower]) {
    log.info("repairing tool call", {
      tool: failed.toolCall.toolName,
      repaired: lower,
    })
    return {
      ...failed.toolCall,
      toolName: lower,
    }
  }

  // 失败则调用 invalid 工具
  return {
    ...failed.toolCall,
    input: JSON.stringify({
      tool: failed.toolCall.toolName,
      error: failed.error.message,
    }),
    toolName: "invalid",
  }
}
```

### InvalidTool

InvalidTool 用于向 AI 反馈工具调用失败的信息：

```typescript
export const InvalidTool = Tool.define("invalid", () => ({
  description: "This tool should never be called",
  parameters: z.object({
    tool: z.string(),
    error: z.string(),
  }),
  async execute(args) {
    return {
      title: "Invalid tool",
      output: `Tool ${args.tool} is not available: ${args.error}`,
      metadata: {},
    }
  },
}))
```

---

## 核心组件

| 组件                        | 文件路径                                     | 作用                           |
| --------------------------- | -------------------------------------------- | ------------------------------ |
| `ToolRegistry`              | `packages/opencode/src/tool/registry.ts`     | 工具注册、加载和管理           |
| `Tool.define()`             | `packages/opencode/src/tool/tool.ts`         | 定义工具接口和类型             |
| `LLM.stream()`              | `packages/opencode/src/session/llm.ts`       | 调用 AI 并传递工具定义         |
| `SessionProcessor.create()` | `packages/opencode/src/session/processor.ts` | 处理 AI 流式响应和工具调用事件 |
| 具体工具实现                | `packages/opencode/src/tool/*.ts`            | 各个工具的 execute 函数实现    |

### 常见工具列表

- `BashTool` - 执行 shell 命令
- `ReadTool` - 读取文件内容
- `WriteTool` - 写入文件
- `EditTool` - 编辑文件
- `GrepTool` - 搜索文件内容
- `GlobTool` - 文件模式匹配
- `TaskTool` - 创建子 agent 任务
- `TodoWriteTool` / `TodoReadTool` - 任务列表管理
- `WebFetchTool` - 获取网页内容
- `SkillTool` - 加载并执行技能
- `WebSearchTool` - 网页搜索
- `CodeSearchTool` - 代码搜索
- `LspTool` - LSP 功能（实验性）

---

## 总结

OpenCode 的 AI 函数调用机制基于以下设计原则：

1. **声明式定义** - 工具通过接口和 Zod schema 声明式定义
2. **类型安全** - 所有参数都经过 Zod 验证
3. **权限控制** - 工具调用基于 agent 和用户权限进行过滤
4. **流式处理** - 工具调用状态通过流式事件实时更新
5. **错误恢复** - 自动修复常见的工具调用错误（如大小写问题）

这种机制让 AI 可以通过标准化的工具调用协议安全地执行代码操作，同时保持灵活性和可扩展性。

# devin2api 客户端思考强度

Manifold 的 `0.18.0-effort.1` 镜像在上游 v0.18.0 上增加按请求选择模型档位的能力。客户端保留固定模型名，通过参数切换强度。

| 请求协议 | 参数 | 示例 |
| --- | --- | --- |
| Anthropic Messages | `output_config.effort` | `"output_config":{"effort":"high"}` |
| OpenAI Responses | `reasoning.effort` | `"reasoning":{"effort":"high"}` |
| OpenAI Chat Completions | `reasoning_effort` | `"reasoning_effort":"high"` |

例如，sub2api 账号仍把 `claude-opus-5-5` 映射到 `claude-opus-5-5-medium`。请求带 `output_config.effort=high` 时，devin2api 实际调用 `claude-opus-5-5-high`；带 `max` 时调用 `claude-opus-5-5-max`。

- 显式 effort 优先于已有模型后缀、sub2api 映射和 devin2api 别名的默认档位。不传或传 `null` 时保留原有行为。
- 只选择当前上游目录中同系列的准确档位；保留 `-fast`、`-priority`、`-lightning` 等服务后缀。不会跨系列替换、静默降低强度或编造模型 ID。
- 档位不存在返回 HTTP 400，并列出该系列支持的档位。模型目录暂时不可用且没有缓存时返回 HTTP 503。
- `thinking.budget_tokens` 是 token 预算，不自动换算成 effort；仅传 `thinking.type` 也不会选择档位。客户端必须发送上表中的参数。
- 此功能选择上游模型档位，不保证返回可见的思考文本。

## sub2api 协议选择

Claude Code 使用现有 Anthropic 分组和 `/v1/messages`，客户端的 `output_config.effort` 会直接决定 Devin 模型档位。

在 Claude Code 中先选固定模型：`/model claude-opus-5-5`（或 `/model claude-fable-5-1`），之后用 `/effort high`、`/effort xhigh` 或 `/effort max` 调整强度。也可以运行 `/effort` 打开滑块，或在 `/model` 中用左右方向键调整。新强度从下一条用户消息开始生效；无需把模型名改成带强度后缀的版本。详见 [Claude Code 官方说明](https://code.claude.com/docs/en/model-config#set-the-effort-level)。

sub2api 仍使用原版 0.2.18。其 Anthropic 分组在转换 OpenAI 请求时可能把 `xhigh` 改为 `max`（当前账号的 Chat Completions 路径已实测出现），这不影响 Claude Code 的 Messages 请求。OpenAI 客户端若要逐字保留所有档位，应使用 OpenAI 平台账号和分组，连接 devin2api 的原生接口。模型访问权限、API Key 分组限制仍由 sub2api 管理。

## 构建与回滚

源码构建请在本机或内存充足的构建机完成，**不要在 4 GB 的生产服务器上编译**：SQLite 依赖的 Go 编译器可能占用数 GB 内存，限制 Go 并发或软堆上限不足以保证生产服务不受影响。

`deploy/devin2api/Dockerfile` 固定上游提交 `989c80ce6dc9ffb46b23d7eac98c34fc98f3a2eb`、源码归档 SHA-256、Go 1.27.3 构建镜像和原运行时镜像。构建时应用 `reasoning-effort.patch`，运行相关 Go 测试，再替换运行时中的可执行文件。`.dockerignore` 仅允许补丁进入上下文，不包含配置和凭据。

小内存服务器可用 `Dockerfile.prebuilt` 打包在构建机上测试过的 Linux 二进制：用 Go 1.27.3、`CGO_ENABLED=0 GOOS=linux GOARCH=amd64` 和主 Dockerfile 中相同的版本参数编译，计算 SHA-256，将二进制和 `Dockerfile.prebuilt`（改名为 `Dockerfile`）放入单独的临时构建目录，再执行 `docker build --build-arg BINARY_SHA256=<计算出的哈希> -t manifold/devin2api:0.18.0-effort.1 <临时目录>`。该路径只打包和校验文件，不在生产机器运行 Go 编译器。部署前应记录上游提交、补丁哈希、二进制哈希和测试结果。

升级先构建镜像并保留旧镜像，备份配置和 SQLite 一致性快照，再只重建 devin2api 服务。遵守现有 660 秒停止宽限，不强杀在途请求。该增量没有数据库迁移；回滚时恢复原 compose 镜像标记与构建文件，并仅重建 devin2api。详细步骤见 [升级说明](upgrade.md#devin2api-升级)。

验证应同时检查响应正文和 devin2api 日志中的实际模型，不能只凭 HTTP 200 或 sub2api 的静态映射名判断。补丁测试覆盖三种参数解析、真实 RPC 模型选择、别名覆盖、服务后缀保留、缺失档位拒绝和缓存隔离。

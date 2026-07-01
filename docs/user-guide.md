# Manifold 用户指南

> 文档初稿，截图待服务器上线后补。
> 例子里出现的域名 `zstuacm.xyz` 是我们的生产入口；若你看到 IP 地址说明在内测白名单期。

---

## 1. 注册账号

1. 打开 https://zstuacm.xyz
2. 点 "注册" → 输入邮箱 + 设置密码
3. 收邮箱验证邮件（看不到检查垃圾箱）→ 点链接激活
4. 登录后系统会弹出 4 份法律文档（服务条款 / 隐私 / 免责 / 退款）
5. **请逐份滚到底**（不滚到底无法勾选同意）→ 勾选 → 提交

> 灰名单期不接受公开注册。如你拿到邀请码，注册页会有"邀请码"输入框。

---

## 2. 充值

> 灰名单期不开放充值，**测试余额由我们手动加**。下面是上线后的流程。

1. 登录 → 右上角头像 → "充值"
2. 选支付方式：
   - 支付宝 / 微信（国内）
   - Stripe（境外）
3. 输入充值金额（最低 1 元 / 1 USD，最高 1000 元 / 100 USD）
4. 完成支付 → 余额到账通常 < 1 分钟

> ⚠ 退款规则见退款政策（文档待补）。**单次充值不要超过 1 个月预估消耗**。

---

## 3. 创建 API key

每条 key 绑定一个**平台 group**（决定能调哪些上游模型）。我们目前给每个用户默认发：

- `manifold-anthropic`：调 Claude
- `manifold-openai`：调 GPT / Codex
- （如已挂）`manifold-gemini`、`manifold-antigravity`

流程：

1. 登录 → 左侧菜单 "API Keys"
2. 点 "新建 Key"
3. 填名字（任意，建议带项目识别如 `claude-side-project`）
4. 选 group（如 anthropic）
5. **保存当前页弹出的明文 key**：形如 `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. 关掉页面后**不会再次显示明文**。丢了只能撤销重发，不能找回。

---

## 4. 用 key 调模型

### 4.1 Anthropic 兼容（Claude）

**curl**：

```bash
curl https://zstuacm.xyz/v1/messages \
  -H "Authorization: Bearer sk-<你的-anthropic-key>" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

**Python (官方 SDK)**：

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="sk-<你的-anthropic-key>",
    base_url="https://zstuacm.xyz",
)
resp = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.content[0].text)
```

**Claude Code**：

```bash
export ANTHROPIC_BASE_URL=https://zstuacm.xyz
export ANTHROPIC_API_KEY=sk-<你的-anthropic-key>
claude
```

### 4.2 OpenAI 兼容（GPT / Codex）

**curl**：

```bash
curl https://zstuacm.xyz/v1/chat/completions \
  -H "Authorization: Bearer sk-<你的-openai-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

**Python (官方 SDK)**：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-<你的-openai-key>",
    base_url="https://zstuacm.xyz/v1",
)
resp = client.chat.completions.create(
    model="gpt-5.4-mini",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

### 4.3 支持的模型清单

完整列表见控制台首页 → "模型" tab，**以那里为准**（我们会随上游可用性更新）。

调用前可以打 `GET /v1/models`：

```bash
curl https://zstuacm.xyz/v1/models -H "Authorization: Bearer sk-<key>"
```

---

## 5. 错误码字典

请求失败时响应里会含 `error.type` 和 `error.message`。下面是常见情况：

| HTTP | 含义 | 典型原因 | 你该做的 |
|---|---|---|---|
| 401 | 未认证 | key 拼错 / 已撤销 | 控制台检查 key 状态 |
| 402 | 余额不足 | 账户余额 ≤ 0 | 充值 |
| 403 | 拒绝 | 内容违规、key 没绑该 group、IP 黑名单 | 检查 prompt / 控制台 key 设置 |
| 404 | 模型不存在 | 模型名拼错 / 已下线 | 查 `/v1/models` |
| 408 | 超时 | 请求或响应阶段超时 | 减少 max_tokens / 简化 prompt / 重试 |
| 413 | 请求过大 | 消息体超模型上下文 | 减少历史消息 / 换更大模型 |
| 429 | 限流 | 触发账户 RPM / TPM | 重试时退避，或升 group 套餐 |
| 500 | 服务端错误 | 我们这边异常 | 30 秒后重试，持续报错联系我们 |
| 502 | 上游异常 | 原厂瞬时故障 | 重试。持续 5 分钟以上联系我们 |
| 503 | 全平台拥塞 | 多账号同时被原厂限流 | 等几分钟重试 |

> ⚠ 429 别死循环重试，**指数退避** 1s → 2s → 4s → 8s 上限 60s。这是行业标准。

---

## 6. FAQ

### Q: Manifold 是什么？跟原厂订阅有啥不一样？

A: Manifold 把多家原厂（Anthropic / OpenAI / Google 等）的官方 API 整合到一个入口，**按用量付费**，不需要为每家单独绑定信用卡 / 商务号。我们持有上游订阅，把你的请求中转过去。**我们不是原厂的代理商或合作伙伴**。

### Q: 我的请求内容会被保存吗？

A: 我们**不持久化**请求体 / 响应体的明文。只记录元数据（时间、token 数、状态码）用于计费和故障排查。**但上游原厂会按其自身政策记录请求**（详见隐私政策第 4 节，文档待补）。

### Q: 一个 key 能调所有模型吗？

A: 不能。每条 key 绑一个 group。要调 Claude 用 `anthropic` group 的 key，调 GPT 用 `openai` group 的 key。多平台想统一管理，自己在客户端按需切 key。

### Q: key 泄露了怎么办？

A: 控制台立刻 "撤销"。撤销后 key 永久失效，未用完的额度回到账户余额。**及时撤销，避免被人刷光余额**。

### Q: 上游模型几号更新？

A: 模型可用性跟原厂。原厂宣布上线后，我们一般 1-3 天内开放（要先确认上游成本和稳定性）。原厂下线的模型我们会公告 14 天后从清单移除。

### Q: 调用失败但我看到扣费了？

A: 仅对**成功响应（HTTP 2xx）**收费。如确认 4xx/5xx 也扣了费，邮箱我们 `support@zstuacm.xyz` 附上请求 ID（响应头 `X-Request-Id`），3 个工作日内补回。

### Q: 能开发票吗？

A: 上线后可开。控制台 → "财务" → "开票"，电子普票，邮件发送。海外用户开 invoice，PDF 形式。

### Q: SLA 是多少？

A: **没有 SLA**。本服务为 best-effort，不承诺任何可用性百分比。详见服务条款第 6 条与免责声明第 5 条（文档待补）。

### Q: 我能用 Manifold 做生产业务吗？

A: **强烈不建议把关键业务、SLA 承诺、合规合约绑在 Manifold 上**。我们的上游订阅依赖原厂的容忍度，原厂随时可能封停（详见免责声明第 2 条，文档待补）。生产业务请直接订阅原厂。

### Q: 客服在哪？

A: 邮箱 `support@zstuacm.xyz`，工作日 24 小时内回复。紧急故障可在 Telegram 群 `<待填：群链接>` 喊。

---

## 7. 联系

- 文档错误 / 改进建议：`<待填：docs@zstuacm.xyz>`
- 支持：`<待填：support@zstuacm.xyz>`
- 退款 / 争议：`<待填：dispute@zstuacm.xyz>`

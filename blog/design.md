# Clestiana Research Journal Design Specification

## Design Read

这是一个面向技术同行与未来自己的中文私人研究期刊。视觉语言属于深色实验室档案、工程出版物与非对称杂志排版，而不是常规博客、产品文档或 SaaS 落地页。

设计参数：

- `DESIGN_VARIANCE: 7`
- `MOTION_INTENSITY: 4`
- `VISUAL_DENSITY: 4`
- 实现基础：现有 React / vinext / Tailwind v4 技术栈，加原生 CSS 设计系统

## 1. Design Principles

### A research journal, not a blog template

页面以研究命题、档案索引、文章摘要和真实工作材料组织内容。避免博客卡片墙、营销型 CTA、数据看板和伪终端界面。

### The cover is the thesis

首页首屏采用杂志封面构图：左侧超大中文标题，右侧真实感研究桌静物。视觉资产必须像作者工作环境中的证据，而不是装饰性科技插画。

### Structure carries identity

使用非对称网格、明确栏宽、稀疏分隔线和克制的表面层级。边界只用于组织真实内容，不绘制无意义的装饰网格。

### Technical, never cyberpunk

未来感来自材料、精度、排版和信息架构。禁止霓虹、蓝紫光、全息界面、发光描边、渐变和玻璃拟态。

### One locked dark theme

整站固定深色主题。页面不提供局部反色，也不在章节间切换浅色背景。

## 2. Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#181815` | 主背景 |
| `--surface` | `#22211D` | 搜索、代码标签、少量分组区域 |
| `--surface-raised` | `#292823` | 罕见的高层级内容 |
| `--text-primary` | `#E8E3D8` | 标题和主要文字 |
| `--text-secondary` | `#B4AEA3` | 长文正文和摘要 |
| `--text-muted` | `#8A857C` | 日期、说明、次级导航 |
| `--accent` | `#E8794F` | 链接、活动状态、阅读进度 |
| `--border` | `#34312B` | 分隔线 |
| `--border-strong` | `#4A463E` | 关键结构边界 |
| `--code` | `#121311` | 代码块 |

规则：

- 只使用一个强调色。
- 不使用纯黑、纯白和渐变。
- 长文正文对比度至少满足 WCAG AA。
- 表面色只表达信息层级，不能演变成卡片系统。

## 3. Typography Scale

字体角色：

- Display / body：`MiSans VF`, `HarmonyOS Sans SC`, `Microsoft YaHei UI`, `PingFang SC`, sans-serif。
- Editorial secondary：`Source Han Serif SC`, `Noto Serif CJK SC`, `Songti SC`, serif。只用于少量二级标题和引语。
- Utility / code：`IBM Plex Mono`, `Fira Code`, `Cascadia Code`, monospace。

| Role | Desktop | Mobile | Weight |
| --- | --- | --- | --- |
| Cover headline | `72/74` | `46/52` | 700 |
| Article title | `52/58` | `38/44` | 700 |
| Section title | `38/46` | `30/38` | 650 |
| Secondary heading | `26/34` | `22/30` | 600 |
| Intro | `18/31` | `17/29` | 400 |
| Body | `16/29` | `16/28` | 400 |
| Meta | `11/18` | `11/18` | 550 |
| Code | `13/22` | `12/20` | 400 |

规则：

- 首页中文标题最多两行。
- 正文理想行宽 `680-740px`。
- 数字、日期和复杂度使用等宽字体与等宽数字。
- 不在每个章节标题上方重复英文 eyebrow。

## 4. Layout Rules

### Global grid

- 首页最大宽度 `1400px`；文章页最大宽度 `1480px`，桌面边距至少 `36px`，移动端边距 `20px`。
- 首页采用 12 栏非对称网格，栏间距 `24px`。
- 首屏文字占 1-7 栏，封面视觉占 9-12 栏，第 8 栏作为呼吸空间。
- 首屏必须在常见桌面视口内完整显示标题、简介和主要路径。

### Homepage sections

- 近期文章使用杂志索引行，不使用卡片。
- 主题导航使用共享边界的分类目录，不使用独立圆角容器。
- 关于区域使用大号编辑式命题和窄行宽说明。
- 主要章节间距 `96-120px`，移动端 `72-84px`。

### Article layout

- 宽桌面：`252px` 左侧档案栏 + `740px` 正文 + `224px` 右侧目录；侧栏正文不小于 `13px`。
- 栏间距 `48px`。
- 低于 `1280px` 隐藏右栏，低于 `900px` 收起左栏。
- 代码、表格和公式只能在正文内部横向滚动。

### Shape system

- 内容区、文章行、主题目录：`0px`。
- 搜索与按钮：`2px`。
- 图片和代码块：`4px`。
- 禁止 pill 和大面积圆角卡片。

## 5. Component Guidelines

### Header

- 高度 `68px`，单行排列。
- 左侧保留 Clestiana 标识，右侧保留现有四个导航标签。
- 背景为半透明画布色，轻微模糊不超过 `8px`。
- 无主题切换，整站锁定深色。

### Hero cover

- 一个功能性 journal label、一个两行标题、一段简介、一组阅读路径。
- 右侧使用项目专属的实验室研究桌静物。
- 图片无文字覆盖、无标签、无渐变遮罩。
- 进入动画只使用 `opacity` 与 `translateY(8px)`。

### Article index

- 一条共享分隔线组织日期、类别、标题、摘要和阅读信息。
- Hover 只改变标题色与方向符号位置，不抬升整行。

### Topic directory

- 展示技术实践、项目复盘、算法竞赛、阅读收藏、生活记录。
- 使用共享边界和不等宽栏位，保持研究目录感。
- 每个条目仅包含主题名称和简短说明。

### Article page

- 左侧栏提供真实章节搜索，右侧栏提供当前章节目录。
- H1 使用强力中文无衬线，H2 可使用中文衬线作为出版物层级。
- 代码块为冷静石墨表面，不使用终端窗口装饰。
- 引用使用 `3px` 锈橙边线，不使用圆角卡片。

### Image treatment

- 使用真实或生成的项目专属研究材料。
- `1px` 中性边框，`4px` 圆角，无重阴影。
- 图片说明必须是功能性描述，不添加伪档案编号或摄影署名。

### Motion

- 动效只用于建立阅读顺序、反馈 hover 和表达阅读进度。
- 动画仅改变 `transform` 与 `opacity`。
- 禁止视差、跑马灯、光标特效和滚动劫持。
- 完整支持 `prefers-reduced-motion`。

## 6. Do / Don't

### Do

- 像编辑一本私人 AI 工程研究期刊一样组织首页。
- 使用真实文章标题、章节、日期和工作材料。
- 让超大中文标题成为封面核心。
- 通过非对称构图和精确行宽建立高级感。
- 把主题目录做成策展式阅读入口。
- 保持长文正文舒适、稳定、可搜索。

### Don't

- 不使用 SaaS hero、指标卡、logo wall 或营销证明。
- 不使用默认 Tailwind 卡片和三等分卡片阵列。
- 不使用渐变、玻璃、光晕、霓虹和赛博朋克视觉。
- 不构建假终端、假仪表盘或伪研究数据。
- 不用圆角容器包裹每个内容块。
- 不添加装饰性版本号、状态点、滚动提示或地点时间。
- 不改变文章数据、URL、Markdown 渲染与现有导航标签。

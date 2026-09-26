# Live2DPet Workspace — AI 桌面宠物伴侣
> 注：本项目的宣传名为 **Live2DPet Workspace**，可执行文件与用户数据目录仍沿用原名称 `Live2DPet` / `live2dpet`，不影响使用。
**[English](README.en.md)** | **[日本語](README.ja.md)** | **中文**

> 本项目基于 [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet) 二次开发，遵循 MIT 许可证。

一款把 AI 对话、日程管理、复习卡片和任务 Agent 全部塞进 Live2D 桌宠的开源桌面应用。

---

## 核心功能

### 1. 会聊天、有记忆的桌宠
- **自然对话** — 支持所有 OpenAI 兼容 API（DeepSeek、OpenRouter、Grok、Ollama 本地模型等）
- **角色扮演** — 通过角色卡定义名字、身份、性格、称呼习惯、场景和硬性规则
- **记住你** — 自动提取「用户画像」（名字、身份、目标、偏好），跨对话保留
- **观察环境** — 可读取当前窗口标题、截图，让 AI 知道你在做什么
- **语音合成** — 集成 VOICEVOX，日语声线朗读（中文自动翻译成日语）
- **陪伴天数** — 从第一次启动开始计算，AI 可以自然提及「我们认识多久了」

### 2. 三种对话模式
切换按钮在聊天框左侧，图标循环变化：

| 图标 | 模式 | 行为 |
| :--- | :--- | :--- |
| 💬 | 普通对话 | 日常闲聊，AI 会主动说话 |
| 🤖 | Agent 模式 | 调用工具完成任务（读写文件、管理待办、加复习卡等） |
| 📋 | 规划模式 | 先让 AI 列执行计划，你批准后才动手 |

### 3. Agent 内置工具
用自然语言说话即可调用：

**文件类（默认允许）**
- 读文件、列目录、递归列目录
- 按文件名搜索（支持 `*.js` 通配符）
- 按内容搜索（支持正则）

**任务类（默认允许）**
- 待办：添加、列出、完成、修改、删除
- 日程：添加、列出、修改、删除
- 提醒：添加、列出、删除（支持每天/每周重复）
- 复习卡片：添加、修改、列出、评分、删除、统计

**敏感类（默认询问）**
- 写文件、打开 URL

每个工具的权限可在 **设置 → Agent 工具权限** 里改成 `allow`（直接执行）、`ask`（每次询问）或 `deny`（禁止）。

### 4. MCP 工具扩展
除内置工具外，可接入任何 MCP Server：
- **设置 → MCP → 点「+ 添加 Server」**
- 常见例子：`@modelcontextprotocol/server-filesystem`、`mcp-server-git`
- 支持多个 Server，同名工具自动加前缀

### 5. 日历 + 待办可视化
右键桌宠 →「日历」：
- 月视图，有日程的日期会显示标记
- 点某天看当天日程和待办
- 在日历里直接新建/编辑/删除日程

### 6. 复习卡片（SM-2 算法）
右键桌宠 →「复习卡片」：
- 卡片有正面（问题）和背面（答案），支持科目和标签
- 使用 Anki 同款 SM-2 间隔重复算法
- 评分四档：忘了 / 勉强 / 记得 / 太简单
- 根据评分自动安排下次复习时间（EF 越高，间隔越长）
- 「📋 全部卡片」可浏览、搜索、编辑、删除、新建
- 独立窗口，支持键盘快捷键：空格 翻面、1/2/3/4 评分、ESC 关闭

### 7. 每日简报 + 周报/月报
**早报（默认 7:30 触发）**
- 天气、温度、紫外线指数
- 根据气温给穿衣建议，根据紫外线给防晒建议
- 今日日程、提醒、到期待办摘要

**晚报（默认 22:00 触发）**
- 今天完成了什么
- 还有哪些没做
- 明天的日程和提醒

**周报 / 月报**
- 周日 21:00 出周报，月末 21:00 出月报
- 统计待办完成率、日程数、复习次数、按科目错题率

所有简报都用角色口吻生成，不机械朗读数据。

### 8. 观察数据可视化
右键桌宠 →「查看观察数据」：
- 常联系的人（按次数排序，带话题标签）
- 最近聊天记录（仅记录窗口标题，不记录聊天内容）

---

## 使用指南

### 1. 配置 API
打开设置面板，在「API 设置」标签页填入 API 地址、密钥和模型名称。本应用兼容所有 OpenAI 格式的 API 接口。

推荐使用支持 Vision 的模型以获得截屏感知能力：
- 性价比推荐：Grok 系列 / DeepSeek
- 中端推荐：GPT-o3 / GPT-5.1
- 高质量推荐：Gemini 3 Pro Preview

翻译 API（用于 TTS 日语翻译）推荐：
- OpenRouter `x-ai/grok-4-fast`

### 2. 导入 Live2D 模型
在「模型」标签页点击「选择模型文件夹」，选择包含 `.model.json` 或 `.model3.json` 的目录。系统会自动扫描模型参数并映射眼球/头部追踪、表情文件和动作组。

也支持使用图片文件夹作为角色形象。

没有 Live2D 模型？可以从 Live2D 官方示例下载免费模型体验。

### 3. 配置 VOICEVOX 语音合成（可选）
1. 在「TTS」标签页安装 VOICEVOX 组件（Core + ONNX Runtime + Open JTalk 辞書）
2. 选择并下载 VVM 语音模型
3. 点击「保存并重启」
4. 设置角色（Speaker）、风格（Style）及其他语音参数

<details>
<summary>手动安装 VOICEVOX 组件</summary>

安装位置：`C:\Users\你的用户名\AppData\Roaming\live2dpet\voicevox_core`

| 组件 | 必须 | 下载链接 |
| :--- | :--- | :--- |
| VOICEVOX Core | 是 | `voicevox_core-windows-x64-0.16.3.zip` |
| ONNX Runtime (CPU) | 是 | `voicevox_onnxruntime-win-x64-1.17.3.tgz` |
| ONNX Runtime (GPU) | 否 | `voicevox_onnxruntime-win-x64-dml-1.17.3.tgz` |
| Open JTalk 辞書 | 是 | `open_jtalk_dic_utf_8-1.11.tar.gz` |
| 默认语音模型 | 是 | `0.vvm` |
| 其他语音模型 | 否 | `*.vvm` |

</details>

### 4. 自定义角色人设
在「角色」标签页新增角色卡，编辑角色的名称、性格、行为规则等。支持模板变量 `{{petName}}`、`{{userIdentity}}`。

### 5. 启动宠物
在设置界面底部点击「启动宠物」，角色会以透明窗口出现在桌面右下角。
- 拖拽角色可移动位置
- 角色眼睛会跟随鼠标（Live2D 模式）
- AI 会定时截屏并通过气泡对话
- 右键桌宠可打开菜单：切换大小/位置、开始对话、查看历史、复习卡片、日历、设置等

---

## 常用对话示例

**日常**
```text
今天有点累
帮我想个选题
我最近和谁聊天比较多？
```

**待办日程**
```text
提醒我明天买牛奶
明天下午 3 点和导师开会
这周有什么安排
牛奶买了
把"买牛奶"改到后天
```

**提醒**
```text
每天 23:30 提醒我上床睡觉
10 分钟后提醒我看锅
```

**复习卡片**
```text
把"康德三大批判"加卡，科目是西方哲学史
今天要复习什么
开始复习
（AI 出题后你回答）……忘了
我有多少卡
```

**Agent 任务（🤖 模式）**
```text
列出 src 目录的所有文件
在项目里搜索包含 "TODO" 的代码
读一下 package.json
```

**规划模式（📋）**
```text
重构一下这个项目的日志系统
（AI 先给出计划，你点"批准"才开始执行）
```

---

## 数据存储

所有数据本地存储，不上传任何服务器：

```text
C:\Users\你的用户名\AppData\Roaming\live2dpet\
├── config.json         配置（API Key、TTS 参数等）
├── data/               结构化数据
│   ├── todos.json       待办
│   ├── schedules.json   日程
│   ├── reminders.json   提醒
│   ├── flashcards.json  复习卡片
│   ├── companion.json   陪伴天数
│   ├── daily-brief.json 简报状态
│   ├── report-state.json 报告状态
│   └── reports/         历史周报/月报
└── voicevox_core/      VOICEVOX 组件和模型
```

可以直接用记事本打开编辑。

---

## 功能特性

- **Live2D 桌面角色** — 透明无边框窗口，始终置顶，眼睛跟随鼠标
- **图片模型** — 支持图片文件夹作为角色，按待机/说话/表情分类
- **AI 视觉感知** — 定时截屏 + 活动窗口检测
- **互动系统** — 点击/触摸/拖拽/划过/缩放，互动事件注入 AI 上下文
- **关键帧视觉记忆** — VLM 挑选代表性关键帧
- **VOICEVOX 语音** — 本地日语 TTS，自动翻译，一键安装
- **情绪系统** — AI 驱动表情/动作选择
- **Agent 模式** — 三种对话模式 + 20+ 内置工具 + MCP 扩展
- **日程待办** — 自然语言管理 + 日历可视化
- **复习卡片** — SM-2 算法 + 独立复习窗口
- **每日简报** — 天气、穿衣、防晒建议
- **周报/月报** — 学习进度统计
- **多角色** — JSON 模板定义，支持切换

---

## 注意事项

- **隐私**：截屏数据仅发送给你配置的 API，不存储到磁盘
- **API 费用**：视觉模型调用会产生费用，合理设置检测间隔
- **VOICEVOX**：使用语音时需标注 `VOICEVOX:キャラ名`
- **不要同时开多个实例**：会互相抢占文件锁，导致数据异常

---

## 第三方许可与合规声明

### Live2D Cubism Core
由于 Live2D 官方许可限制，本项目**不包含** `live2dcubismcore.min.js` 和 `cubism4.min.js`。
首次从源码运行或重新克隆项目后，请自行从 [Live2D 官网](https://www.live2d.com/) 下载 SDK，并将 `live2dcubismcore.min.js` 放入 `libs/` 目录中。

### VOICEVOX
本项目集成 VOICEVOX，使用时请遵守 [VOICEVOX 利用规约](https://voicevox.hiroshiba.jp/term/)，并标注 `VOICEVOX: 角色名`。

### 其他依赖
各依赖项的许可证详见 `THIRD_PARTY_LICENSES.md`。

---

## 问题排查

遇到问题时，打开命令提示符（cmd），通过以下命令启动程序以开启控制台日志：

```bash
"你的文件夹地址\Live2DPet.exe" --enable-logging 2>&1
```

请记录出现问题时的日志输出，提交 Issue 时附上相关信息。

---

## 已知问题

- 关于截屏错误的 warning 请忽视，不影响正常使用
- VVM 语音模型读取错误：前往 `voicevox_core` 目录，删除损坏的文件后重新下载
- 开启 GPU 加速会导致读取 TTS 失败，仅使用 CPU 即可
- 长文本（>60 字）跳过 TTS：VOICEVOX CPU 模式下长文本不稳定，只显示气泡不朗读

---

## 环境要求

- Windows 10/11
- Node.js >= 18（从源码运行时）
- OpenAI 兼容 API Key
- VOICEVOX Core（可选，用于语音合成）
**注意**：出于许可合规考虑，本仓库不包含 VOICEVOX Core 的预编译二进制文件。
请根据以下步骤自行获取：
1. 前往 [VOICEVOX 官网](https://voicevox.hiroshiba.jp/) 下载 Core 组件。
2. 将解压后的文件放入项目根目录的 `voicevox_core/` 文件夹中。
3. 具体文件列表请参考该目录下的 `README.md`。
---

## 测试

```bash
npm test
```

---

## License

MIT — 详见 [LICENSE](LICENSE)。

---

## 贡献者

<a href="https://github.com/x380kkm/Live2DPet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=x380kkm/Live2DPet" />
</a>

## Star History

https://api.star-history.com/svg?repos=x380kkm/Live2DPet&type=Date
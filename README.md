# AI Algorithm Case Builder

一个本地算法竞赛测试数据生成工具。你可以上传或粘贴 Markdown 题面，选择 GPT / Claude / DeepSeek / NewAPI / OpenAI-compatible 接口，让 AI 直接修改现有的 `makedata.cpp` 和 `std.cpp`，随后自动编译并生成测试点到 `捏数据/cases/`。

## 功能

- 本地网页界面，默认运行在 `http://localhost:5173`
- 支持 Markdown 题面、样例代码块、表格和 LaTeX 公式
- 支持 OpenAI、DeepSeek、Claude、NewAPI 和自定义兼容接口
- NewAPI 配置 JSON 可直接粘贴到 API Key 输入框
- 自动获取兼容接口可用模型
- 直接修改原有 `makedata.cpp` 和 `std.cpp`
- 生成完成后可一键复制 `std.cpp`
- 生成 `cases/*.in` 和 `cases/*.out`

## 启动

macOS 可以双击：

```text
启动AI界面.command
```

或在终端运行：

```bash
npm start
```

然后打开：

```text
http://localhost:5173
```

## API 配置

可以在网页里直接填写 API Key，也可以创建 `.env.local`：

```bash
export AI_PROVIDER="openai"
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-4.1"
```

NewAPI / OpenAI-compatible 示例：

```bash
export AI_PROVIDER="newapi"
export NEWAPI_BASE_URL="https://your-newapi-host/v1"
export NEWAPI_API_KEY="your_api_key"
export NEWAPI_MODEL="your_model"
```

`.env.local` 已加入 `.gitignore`，不要提交真实 API Key。

## 数据目录

```text
捏数据/
├── makedata.cpp
├── std.cpp
├── loop.sh
├── loop.bat
├── loop.command
└── cases/
```

`cases/` 是生成目录，仓库只保留空目录标记，不提交生成数据。

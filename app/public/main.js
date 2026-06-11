const statusEl = document.querySelector("#status");
const fileInput = document.querySelector("#statementFile");
const fileName = document.querySelector("#fileName");
const textarea = document.querySelector("#problemStatement");
const countInput = document.querySelector("#count");
const providerInput = document.querySelector("#provider");
const modelInput = document.querySelector("#model");
const apiKeyInput = document.querySelector("#apiKey");
const baseUrlInput = document.querySelector("#baseUrl");
const copyStdButton = document.querySelector("#copyStdButton");
const testButton = document.querySelector("#testButton");
const generateButton = document.querySelector("#generateButton");
const clearButton = document.querySelector("#clearButton");
const resultLog = document.querySelector("#resultLog");
const badge = document.querySelector("#badge");

const providerDefaults = {
  auto: { model: "gpt-4.1", baseUrl: "https://api.openai.com/v1" },
  openai: { model: "gpt-4.1", baseUrl: "https://api.openai.com/v1" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  anthropic: { model: "claude-3-5-sonnet-latest", baseUrl: "https://api.anthropic.com/v1" },
  newapi: { model: "gpt-4.1", baseUrl: "" },
  custom: { model: "", baseUrl: "" }
};

const providerNames = {
  openai: "GPT / OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Claude / Anthropic",
  newapi: "NewAPI 中转",
  custom: "自定义兼容接口"
};

let autoModelTimer = null;
let lastAutoModelKey = "";

function withOpenAIPath(url) {
  const normalized = String(url || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/(v1|api\/v1)$/i.test(normalized)) return normalized;
  return `${normalized}/v1`;
}

function parseConnectionConfig(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (parsed._type === "newapi_channel_conn" || parsed.key || parsed.url) {
      return {
        provider: "newapi",
        apiKey: parsed.key || "",
        baseUrl: withOpenAIPath(parsed.url || ""),
        model: "gpt-4.1"
      };
    }
  } catch (_) {
    return null;
  }
  return null;
}

function applyConnectionConfig(config) {
  providerInput.value = config.provider || "newapi";
  if (config.model) modelInput.value = config.model;
  if (config.apiKey) apiKeyInput.value = config.apiKey;
  if (config.baseUrl) baseUrlInput.value = config.baseUrl;
  setBadge("已识别", "ok");
  resultLog.textContent = `已识别 NewAPI 配置。\n模型服务：NewAPI 中转\nBase URL：${baseUrlInput.value}\n正在自动获取可用模型...`;
  scheduleAutoModelFetch(100);
}

function setBadge(text, state) {
  badge.textContent = text;
  badge.className = `badge ${state}`;
}

function guessProviderFromInputs() {
  const key = apiKeyInput.value.trim();
  const model = modelInput.value.trim().toLowerCase();
  const baseUrl = baseUrlInput.value.trim().toLowerCase();

  if (key.startsWith("sk-ant-") || model.includes("claude") || baseUrl.includes("anthropic")) return "anthropic";
  if (providerInput.value === "newapi") return "newapi";
  if (key.startsWith("sk-or-") || baseUrl.includes("openrouter.ai")) return "custom";
  if (model.includes("deepseek") || baseUrl.includes("deepseek")) return "deepseek";
  if (key.startsWith("sk-")) return "openai";
  return "auto";
}

function applyProviderDefaults(provider) {
  const defaults = providerDefaults[provider] || providerDefaults.openai;
  modelInput.value = defaults.model;
  baseUrlInput.value = defaults.baseUrl;
}

function formatLogs(logs = []) {
  return logs
    .map((item) => {
      const header = `$ ${item.command}\nexit ${item.code}`;
      const stdout = item.stdout ? `\nstdout:\n${item.stdout.trim()}` : "";
      const stderr = item.stderr ? `\nstderr:\n${item.stderr.trim()}` : "";
      return `${header}${stdout}${stderr}`;
    })
    .join("\n\n");
}

function formatPreview(preview = []) {
  if (!preview.length) return "暂无预览。";
  return preview
    .map((item) => {
      return [
        `# ${item.inputName}`,
        item.input || "(空)",
        "",
        `# ${item.outputName}`,
        item.output || "(空)"
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function friendlyError(message) {
  const text = String(message || "未知错误");
  if (text.includes("Incorrect API key") || text.includes("invalid_api_key")) {
    return [
      "API Key 无效。",
      "",
      "如果这是 OpenAI 官方 Key：请在 OpenAI 后台重新创建一个新的 Key。",
      "如果这是第三方中转平台 Key：模型服务请选择“自定义兼容接口”，Base URL 填该平台给你的地址。",
      "",
      `原始错误：${text}`
    ].join("\n");
  }
  if (text.includes("fetch failed") || text.includes("无法连接到")) {
    return [
      "接口连接失败。",
      "",
      "请优先检查：模型服务是否选对、Base URL 是否正确、当前网络是否能访问这个平台。",
      "",
      `原始错误：${text}`
    ].join("\n");
  }
  if (text.includes("No available channel for model")) {
    return [
      "这个模型在当前中转分组里不可用。",
      "",
      "系统会在粘贴 API 配置后自动拉取可用模型；如果仍然出现这个错误，请在模型名里换用自动获取列表中的其它模型。",
      "",
      `原始错误：${text}`
    ].join("\n");
  }
  return text;
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    statusEl.textContent = data.hasAnyApiKey
      ? `已连接本地服务，默认：${data.providerName} / ${data.model}`
      : "本地服务已启动，可以在下方选择模型服务并填写 API Key";
    providerInput.value = data.provider || "auto";
    modelInput.value = data.model || providerDefaults[providerInput.value]?.model || "";
    baseUrlInput.value = data.baseUrl || providerDefaults[providerInput.value]?.baseUrl || "";
  } catch (error) {
    statusEl.textContent = `服务未连接：${error.message}`;
  }
}

providerInput.addEventListener("change", () => {
  applyProviderDefaults(providerInput.value);
  scheduleAutoModelFetch(400);
});

apiKeyInput.addEventListener("input", () => {
  const config = parseConnectionConfig(apiKeyInput.value);
  if (config) {
    applyConnectionConfig(config);
    return;
  }
  if (providerInput.value !== "auto") {
    scheduleAutoModelFetch(800);
    return;
  }
  const guessed = guessProviderFromInputs();
  if (guessed === "auto") return;
  applyProviderDefaults(guessed);
  resultLog.textContent = guessed === "openai"
    ? "已根据 Key 前缀暂按 GPT / OpenAI 配置。DeepSeek 的 Key 可能也是 sk- 开头，如果你用的是 DeepSeek，请手动选择 DeepSeek。"
    : `已根据输入自动匹配到：${providerNames[guessed] || guessed}`;
  scheduleAutoModelFetch(800);
});

apiKeyInput.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text") || "";
  const config = parseConnectionConfig(text);
  if (!config) return;
  event.preventDefault();
  applyConnectionConfig(config);
});

baseUrlInput.addEventListener("input", () => {
  scheduleAutoModelFetch(800);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileName.textContent = file.name;
  textarea.value = await file.text();
  setBadge("Markdown", "idle");
});

function currentAiConfig() {
  const config = parseConnectionConfig(apiKeyInput.value);
  if (config) return config;
  return {
    provider: providerInput.value,
    model: modelInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    baseUrl: baseUrlInput.value.trim()
  };
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.style.position = "fixed";
  scratch.style.opacity = "0";
  document.body.appendChild(scratch);
  scratch.select();
  document.execCommand("copy");
  document.body.removeChild(scratch);
}

copyStdButton.addEventListener("click", async () => {
  copyStdButton.disabled = true;
  setBadge("复制中", "running");
  try {
    const res = await fetch("/api/std-code");
    const data = await res.json();
    if (!res.ok || !data.ok) throw data;
    await copyText(data.code);
    setBadge("已复制", "ok");
    resultLog.textContent = `${resultLog.textContent}\n\nstd.cpp 已复制到剪贴板。`;
  } catch (error) {
    setBadge("失败", "error");
    resultLog.textContent = `${resultLog.textContent}\n\n复制 std.cpp 失败：${friendlyError(error.error || error.message)}`;
  } finally {
    copyStdButton.disabled = false;
  }
});

function canAutoFetchModels(ai) {
  if (!ai.apiKey || !ai.baseUrl) return false;
  if (providerInput.value === "anthropic") return false;
  return /^https?:\/\//i.test(ai.baseUrl);
}

function scheduleAutoModelFetch(delay = 700) {
  clearTimeout(autoModelTimer);
  autoModelTimer = setTimeout(() => {
    autoFetchModels();
  }, delay);
}

async function autoFetchModels() {
  const ai = currentAiConfig();
  if (!canAutoFetchModels(ai)) return;

  const requestKey = `${ai.provider}|${ai.baseUrl}|${ai.apiKey.slice(0, 8)}|${ai.apiKey.slice(-6)}`;
  if (requestKey === lastAutoModelKey) return;
  lastAutoModelKey = requestKey;

  testButton.disabled = true;
  generateButton.disabled = true;
  setBadge("模型中", "running");
  resultLog.textContent = "正在自动获取当前 API 可用模型...";
  try {
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ai: currentAiConfig() })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw data;
    const models = data.models || [];
    if (!models.length) throw new Error("接口没有返回可用模型。");
    modelInput.value = models[0];
    setBadge("已匹配", "ok");
    resultLog.textContent = [
      `已自动匹配 ${data.provider} 的可用模型：${models[0]}`,
      "",
      models.slice(0, 80).join("\n")
    ].join("\n");
  } catch (error) {
    lastAutoModelKey = "";
    setBadge("失败", "error");
    resultLog.textContent = `自动获取模型失败：\n${friendlyError(error.error || error.message)}`;
  } finally {
    testButton.disabled = false;
    generateButton.disabled = false;
  }
}

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  generateButton.disabled = true;
  setBadge("测试中", "running");
  resultLog.textContent = "正在测试模型接口连接...";
  try {
    const res = await fetch("/api/test-ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ai: currentAiConfig() })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw data;
    setBadge("可用", "ok");
    resultLog.textContent = `连接成功：${data.provider} / ${data.model}\n返回：${data.reply || "OK"}`;
  } catch (error) {
    setBadge("失败", "error");
    resultLog.textContent = `连接失败：\n${friendlyError(error.error || error.message)}`;
  } finally {
    testButton.disabled = false;
    generateButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  textarea.value = "";
  fileInput.value = "";
  fileName.textContent = "也可以直接粘贴 Markdown 原文";
  copyStdButton.disabled = true;
  setBadge("待提交", "idle");
  resultLog.textContent = "提交后会在这里显示 AI 说明、编译日志和生成的 cases 文件。";
});

generateButton.addEventListener("click", async () => {
  const problemStatement = textarea.value.trim();
  const count = Number(countInput.value || 15);
  if (problemStatement.length < 30) {
    setBadge("需题面", "error");
    resultLog.textContent = "请先粘贴或上传完整 Markdown 题面，至少包含输入输出格式和数据范围。";
    return;
  }

  generateButton.disabled = true;
  clearButton.disabled = true;
  setBadge("运行中", "running");
  resultLog.textContent = "正在按 Markdown 题面解析并请求 AI 生成 C++ 代码，随后会自动编译并生成 cases...";

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        problemStatement,
        count,
        ai: {
          provider: providerInput.value,
          ...currentAiConfig()
        }
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw data;

    setBadge("完成", "ok");
    copyStdButton.disabled = false;
    resultLog.textContent = [
      "生成好了，可以上传 cases 文件夹。",
      `模型服务：${data.provider} / ${data.model}`,
      `编译器：${data.compiler}`,
      `生成数量：${Math.floor((data.files || []).length / 2)} 组 (${(data.files || []).length} 个文件)`,
      data.notes ? `AI 说明：\n${data.notes}` : "",
      "部分数据预览：",
      formatPreview(data.preview)
    ].join("\n\n");
  } catch (error) {
    setBadge("失败", "error");
    copyStdButton.disabled = true;
    resultLog.textContent = [`错误：\n${friendlyError(error.error || error.message)}`, formatLogs(error.logs)].filter(Boolean).join("\n\n");
  } finally {
    generateButton.disabled = false;
    clearButton.disabled = false;
  }
});

loadStatus();

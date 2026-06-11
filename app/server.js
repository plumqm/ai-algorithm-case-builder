const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { execFile, spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "捏数据");
const CASES_DIR = path.join(DATA_DIR, "cases");
const PUBLIC_DIR = path.join(__dirname, "public");
const START_PORT = Number(process.env.PORT || 5173);
const MAX_PORT = START_PORT + 20;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function spawnWithInput(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || ROOT, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.on("error", reject);
    child.stdin.end(input);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("题面太大，请压缩到 2MB 以内。"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      shell: false,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, command: [command, ...args].join(" ") });
    });
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}`, command });
    });
  });
}

async function findCompiler() {
  const candidates = ["/opt/homebrew/bin/g++-14", "g++", "clang++"];
  for (const candidate of candidates) {
    const result = await run(candidate, ["--version"], { cwd: ROOT });
    if (result.code === 0) return candidate;
  }
  throw new Error("没有找到 C++ 编译器。请先安装 Xcode Command Line Tools 或 g++。");
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|javascript|js|text)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseAiJson(text) {
  const raw = stripCodeFence(text);
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("AI 返回的内容不是合法 JSON。");
  }
}

function validateCpp(name, code) {
  if (typeof code !== "string" || code.trim().length < 80) {
    throw new Error(`${name} 内容过短，AI 可能没有生成完整代码。`);
  }
  if (!code.includes("int main") && !code.includes("signed main")) {
    throw new Error(`${name} 里没有 main 函数。`);
  }
  if (code.includes("```")) {
    throw new Error(`${name} 里包含 Markdown 代码围栏，请重新生成。`);
  }
}

function markdownProblemBlock(problemStatement) {
  return `<problem_statement format="markdown">
${problemStatement}
</problem_statement>`;
}

function existingCodeBlock(name, code) {
  return `<existing_file path="${name}">
${code}
</existing_file>`;
}

function aiMessages(problemStatement, count, currentCode) {
  return [
    {
      role: "system",
      content:
        "你是算法竞赛出题助理。题面会以 Markdown 原文提供，请保留并理解标题、列表、表格、代码块、LaTeX 公式和样例块的语义。请在用户现有的 makedata.cpp 和 std.cpp 基础上修改代码，使两个原文件适配新题面。只输出严格 JSON，不要 Markdown。"
    },
    {
      role: "user",
      content: `请根据下面的 Markdown 算法题题面，直接修改现有的 makedata.cpp 和 std.cpp 内容。

要求：
1. 返回严格 JSON：{"makedata_cpp":"修改后的 makedata.cpp 完整内容","std_cpp":"修改后的 std.cpp 完整内容","notes":"..."}。
2. makedata.cpp 必须接收命令行参数 idx，输出第 idx 组输入到 stdout。
3. std.cpp 必须从 stdin 读取并把正确答案输出到 stdout，不要写文件重定向。
4. makedata.cpp 要覆盖样例、最小边界、最大边界、特殊结构、随机数据，默认生成 ${count} 组。
5. 生成的数据必须满足题面约束；如果题面里没有完整约束，采用保守约束并在 notes 里说明。
6. 代码必须是 C++17，允许 #include <bits/stdc++.h>，不能依赖第三方库。
7. 不要输出解释，不要输出 Markdown 代码块，只输出 JSON。
8. 题面中的 Markdown 表格通常包含约束或输入字段说明，必须纳入理解。
9. 题面中的 fenced code block 通常是输入/输出样例，必须保留精确空格和换行语义。
10. 题面中的 LaTeX 公式是数学定义或约束，不要忽略。
11. 不要创建新文件名，不要建议新增文件；返回内容会直接覆盖原来的两个文件。

现有代码：
${existingCodeBlock("makedata.cpp", currentCode.makedata)}

${existingCodeBlock("std.cpp", currentCode.std)}

${markdownProblemBlock(problemStatement)}`
    }
  ];
}

function withOpenAIPath(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/(v1|api\/v1)$/i.test(normalized)) return normalized;
  return `${normalized}/v1`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function expandConnectionConfig(ai = {}) {
  const expanded = { ...ai };
  const candidates = [ai.connection, ai.apiKey, ai.key].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = extractJsonObject(candidate);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed._type === "newapi_channel_conn" || parsed.key || parsed.url) {
        expanded.provider = "custom";
        expanded.apiKey = parsed.key || expanded.apiKey;
        expanded.baseUrl = withOpenAIPath(parsed.url || expanded.baseUrl);
        expanded.model = expanded.model || "gpt-4.1";
      }
    } catch (_) {
      // Ignore ordinary API keys that are not JSON connection payloads.
    }
  }
  return expanded;
}

function detectProvider(ai = {}) {
  ai = expandConnectionConfig(ai);
  const explicit = String(ai.provider || process.env.AI_PROVIDER || "auto").toLowerCase();
  if (explicit !== "auto") return explicit;

  const apiKey = String(ai.apiKey || "").trim();
  const model = String(ai.model || "").toLowerCase();
  const baseUrl = String(ai.baseUrl || "").toLowerCase();

  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("sk-or-") || baseUrl.includes("openrouter.ai")) return "custom";
  if (baseUrl.includes("deepseek") || model.includes("deepseek")) return "deepseek";
  if (baseUrl.includes("anthropic") || model.includes("claude")) return "anthropic";
  return "openai";
}

function providerConfig(ai = {}) {
  ai = expandConnectionConfig(ai);
  const provider = detectProvider(ai);
  const configs = {
    openai: {
      name: "GPT / OpenAI",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      apiKey: process.env.OPENAI_API_KEY
    },
    deepseek: {
      name: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY
    },
    anthropic: {
      name: "Claude / Anthropic",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      apiKey: process.env.ANTHROPIC_API_KEY
    },
    custom: {
      name: "自定义兼容接口",
      kind: "openai-compatible",
      baseUrl: process.env.CUSTOM_BASE_URL || "",
      model: process.env.CUSTOM_MODEL || "",
      apiKey: process.env.CUSTOM_API_KEY
    },
    newapi: {
      name: "NewAPI 中转",
      kind: "openai-compatible",
      baseUrl: process.env.NEWAPI_BASE_URL || "",
      model: process.env.NEWAPI_MODEL || "gpt-4.1",
      apiKey: process.env.NEWAPI_API_KEY
    }
  };

  const config = configs[provider] || configs.openai;
  return {
    provider,
    name: config.name,
    kind: config.kind,
    baseUrl: config.kind === "openai-compatible"
      ? withOpenAIPath(ai.baseUrl || config.baseUrl)
      : normalizeBaseUrl(ai.baseUrl || config.baseUrl),
    model: String(ai.model || config.model || "").trim(),
    apiKey: String(ai.apiKey || config.apiKey || "").trim()
  };
}

function fetchErrorMessage(config, url, error) {
  return [
    `无法连接到 ${config.name} 接口：${url}`,
    `底层错误：${error.message}`,
    "已尝试 Node fetch 和系统 curl。请检查模型服务是否选对、Base URL 是否以 https:// 开头，以及当前网络/代理是否能访问该服务。"
  ].join("\n");
}

async function postJson(url, headers, body, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    return await response.json().catch(() => ({})).then((payload) => ({
      ok: response.ok,
      status: response.status,
      payload,
      transport: "fetch"
    }));
  } catch (fetchError) {
    clearTimeout(timer);
    const curlArgs = [
      "-sS",
      "--connect-timeout",
      "30",
      "--max-time",
      "240",
      "-X",
      "POST",
      "-w",
      "\n__HTTP_STATUS__:%{http_code}",
      ...Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]),
      "--data-binary",
      "@-",
      url
    ];

    try {
      const { stdout } = await spawnWithInput("curl", curlArgs, JSON.stringify(body), { cwd: ROOT });
      const marker = "\n__HTTP_STATUS__:";
      const markerIndex = stdout.lastIndexOf(marker);
      const rawBody = markerIndex === -1 ? stdout : stdout.slice(0, markerIndex);
      const status = markerIndex === -1 ? 0 : Number(stdout.slice(markerIndex + marker.length).trim());
      const payload = JSON.parse(rawBody || "{}");
      return { ok: status >= 200 && status < 300, status, payload, transport: "curl" };
    } catch (curlError) {
      throw new Error(fetchErrorMessage(config, url, curlError.stderr ? new Error(curlError.stderr.trim()) : fetchError));
    }
  }
}

async function getJson(url, headers, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    clearTimeout(timer);
    return await response.json().catch(() => ({})).then((payload) => ({
      ok: response.ok,
      status: response.status,
      payload,
      transport: "fetch"
    }));
  } catch (fetchError) {
    clearTimeout(timer);
    const curlArgs = [
      "-sS",
      "--connect-timeout",
      "30",
      "--max-time",
      "90",
      "-w",
      "\n__HTTP_STATUS__:%{http_code}",
      ...Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]),
      url
    ];
    try {
      const { stdout } = await spawnWithInput("curl", curlArgs, "", { cwd: ROOT });
      const marker = "\n__HTTP_STATUS__:";
      const markerIndex = stdout.lastIndexOf(marker);
      const rawBody = markerIndex === -1 ? stdout : stdout.slice(0, markerIndex);
      const status = markerIndex === -1 ? 0 : Number(stdout.slice(markerIndex + marker.length).trim());
      const payload = JSON.parse(rawBody || "{}");
      return { ok: status >= 200 && status < 300, status, payload, transport: "curl" };
    } catch (curlError) {
      throw new Error(fetchErrorMessage(config, url, curlError.stderr ? new Error(curlError.stderr.trim()) : fetchError));
    }
  }
}

async function callOpenAICompatible(config, messages) {
  if (!config.baseUrl) {
    throw new Error("缺少 Base URL。自定义兼容接口需要填写 Base URL。");
  }
  if (!config.model) {
    throw new Error("缺少模型名。");
  }
  if (!config.apiKey) {
    throw new Error(`缺少 ${config.name} API Key。请在界面里填写，或在 .env.local 里配置。`);
  }

  const url = `${config.baseUrl}/chat/completions`;
  const result = await postJson(url, {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    }, {
      model: config.model,
      messages,
      temperature: 0.2
    }, config);

  if (!result.ok) {
    const message = result.payload.error?.message || `${config.name} API 请求失败：HTTP ${result.status}`;
    throw new Error(message);
  }

  return result.payload.choices?.[0]?.message?.content || "";
}

async function callAnthropic(config, messages) {
  if (!config.model) {
    throw new Error("缺少模型名。");
  }
  if (!config.apiKey) {
    throw new Error("缺少 Claude / Anthropic API Key。请在界面里填写，或在 .env.local 里配置。");
  }

  const system = messages.find((message) => message.role === "system")?.content || "";
  const userMessages = messages.filter((message) => message.role !== "system");
  const url = `${config.baseUrl}/messages`;
  const result = await postJson(url, {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    }, {
      model: config.model,
      max_tokens: 16000,
      temperature: 0.2,
      system,
      messages: userMessages
    }, config);

  if (!result.ok) {
    const message = result.payload.error?.message || `${config.name} API 请求失败：HTTP ${result.status}`;
    throw new Error(message);
  }

  return (result.payload.content || []).map((part) => part.text || "").join("");
}

async function callAI(problemStatement, count, ai, currentCode) {
  const config = providerConfig(ai);
  const messages = aiMessages(problemStatement, count, currentCode);
  const text = config.kind === "anthropic"
    ? await callAnthropic(config, messages)
    : await callOpenAICompatible(config, messages);

  if (!text.trim()) throw new Error("AI 没有返回可用内容。");
  const result = parseAiJson(text);
  validateCpp("makedata.cpp", result.makedata_cpp);
  validateCpp("std.cpp", result.std_cpp);
  return { ...result, provider: config.name, model: config.model };
}

async function writeExistingFiles(result) {
  const makedataPath = path.join(DATA_DIR, "makedata.cpp");
  const stdPath = path.join(DATA_DIR, "std.cpp");
  await fs.access(makedataPath);
  await fs.access(stdPath);
  await fs.writeFile(makedataPath, result.makedata_cpp.trim() + "\n", "utf8");
  await fs.writeFile(stdPath, result.std_cpp.trim() + "\n", "utf8");
}

async function readCurrentSourceFiles() {
  const makedataPath = path.join(DATA_DIR, "makedata.cpp");
  const stdPath = path.join(DATA_DIR, "std.cpp");
  await fs.access(makedataPath);
  await fs.access(stdPath);
  return {
    makedata: await fs.readFile(makedataPath, "utf8"),
    std: await fs.readFile(stdPath, "utf8")
  };
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function writeFileSynced(filePath, content) {
  const handle = await fs.open(filePath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishCases(stagedDir) {
  await fs.mkdir(CASES_DIR, { recursive: true });
  const existing = await fs.readdir(CASES_DIR, { withFileTypes: true });
  await Promise.all(
    existing
      .filter((entry) => entry.isFile())
      .map((entry) => fs.unlink(path.join(CASES_DIR, entry.name)))
  );

  const stagedFiles = (await fs.readdir(stagedDir))
    .filter((name) => /\.(in|out)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));

  for (const name of stagedFiles) {
    const content = await fs.readFile(path.join(stagedDir, name), "utf8");
    await writeFileSynced(path.join(CASES_DIR, name), content);
  }

  await run("sync", [], { cwd: DATA_DIR });
}

async function buildCasesPreview(files, limit = 3) {
  const inputFiles = files
    .filter((name) => /\.in$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }))
    .slice(0, limit);

  const preview = [];
  for (const inputName of inputFiles) {
    const stem = inputName.replace(/\.in$/i, "");
    const outputName = `${stem}.out`;
    const input = await fs.readFile(path.join(CASES_DIR, inputName), "utf8").catch(() => "");
    const output = await fs.readFile(path.join(CASES_DIR, outputName), "utf8").catch(() => "");
    preview.push({
      inputName,
      outputName,
      input: input.split(/\r?\n/).slice(0, 20).join("\n"),
      output: output.split(/\r?\n/).slice(0, 20).join("\n")
    });
  }
  return preview;
}

async function compileAndGenerate(count) {
  const compiler = await findCompiler();
  const logs = [];
  const buildMakedata = await run(compiler, ["-std=gnu++17", "-O2", "-o", "makedata", "makedata.cpp"], {
    cwd: DATA_DIR
  });
  logs.push(buildMakedata);
  if (buildMakedata.code !== 0) throw Object.assign(new Error("makedata.cpp 编译失败。"), { logs });

  const buildStd = await run(compiler, ["-std=gnu++17", "-O2", "-o", "std", "std.cpp"], { cwd: DATA_DIR });
  logs.push(buildStd);
  if (buildStd.code !== 0) throw Object.assign(new Error("std.cpp 编译失败。"), { logs });

  const stagedCasesDir = path.join(DATA_DIR, `.cases.tmp-${Date.now()}`);
  await fs.rm(stagedCasesDir, { recursive: true, force: true });
  await fs.mkdir(stagedCasesDir, { recursive: true });

  try {
    for (let i = 1; i <= count; i += 1) {
      const inputFile = path.join(stagedCasesDir, `${i}.in`);
      const outputFile = path.join(stagedCasesDir, `${i}.out`);
      const gen = await run("./makedata", [String(i)], { cwd: DATA_DIR });
      logs.push({ ...gen, command: `./makedata ${i} > cases/${i}.in` });
      if (gen.code !== 0) throw Object.assign(new Error(`第 ${i} 组输入生成失败。`), { logs });
      await writeFileSynced(inputFile, ensureTrailingNewline(gen.stdout));

      const answer = await new Promise((resolve) => {
        const child = spawn("./std", [], { cwd: DATA_DIR, shell: false });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("close", (code) => resolve({ code, stdout, stderr, command: `./std < cases/${i}.in > cases/${i}.out` }));
        child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message, command: "./std" }));
        fs.readFile(inputFile).then((data) => {
          child.stdin.end(data);
        });
      });
      logs.push(answer);
      if (answer.code !== 0) throw Object.assign(new Error(`第 ${i} 组答案生成失败。`), { logs });
      await writeFileSynced(outputFile, ensureTrailingNewline(answer.stdout));
    }

    await publishCases(stagedCasesDir);
    await fs.rm(stagedCasesDir, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(stagedCasesDir, { recursive: true, force: true });
    throw error;
  }

  const files = (await fs.readdir(CASES_DIR))
    .filter((name) => /\.(in|out)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  const preview = await buildCasesPreview(files);
  return { compiler, logs, files, preview };
}

async function handleGenerate(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const problemStatement = String(data.problemStatement || "").trim();
    const count = Math.min(Math.max(Number(data.count || 15), 1), 50);
    if (problemStatement.length < 30) {
      throw new Error("题面太短，请至少提供输入输出格式和约束。");
    }

    const currentCode = await readCurrentSourceFiles();
    const aiResult = await callAI(problemStatement, count, data.ai || {}, currentCode);
    await writeExistingFiles(aiResult);
    const generated = await compileAndGenerate(count);
    sendJson(res, 200, {
      ok: true,
      provider: aiResult.provider,
      model: aiResult.model,
      notes: aiResult.notes || "",
      compiler: generated.compiler,
      files: generated.files,
      preview: generated.preview,
      logs: generated.logs
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
      logs: error.logs || []
    });
  }
}

async function handleStdCode(_req, res) {
  try {
    const stdPath = path.join(DATA_DIR, "std.cpp");
    const code = await fs.readFile(stdPath, "utf8");
    sendJson(res, 200, { ok: true, code });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleTestAI(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const config = providerConfig(data.ai || {});
    const messages = [
      { role: "system", content: "只回复 OK。" },
      { role: "user", content: "连接测试。" }
    ];
    const text = config.kind === "anthropic"
      ? await callAnthropic(config, messages)
      : await callOpenAICompatible(config, messages);
    sendJson(res, 200, {
      ok: true,
      provider: config.name,
      model: config.model,
      reply: text.trim().slice(0, 200)
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
}

async function handleModels(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const config = providerConfig(data.ai || {});
    if (config.kind !== "openai-compatible") {
      throw new Error("当前服务商不支持通过 /v1/models 获取模型列表。");
    }
    if (!config.apiKey) {
      throw new Error("缺少 API Key。");
    }
    const result = await getJson(`${config.baseUrl}/models`, {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    }, config);
    if (!result.ok) {
      const message = result.payload.error?.message || `${config.name} 获取模型失败：HTTP ${result.status}`;
      throw new Error(message);
    }
    const models = (result.payload.data || [])
      .map((item) => item.id || item.model || item.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    sendJson(res, 200, { ok: true, provider: config.name, models });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function serveStatic(req, res) {
  const rawPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relative = rawPath === "/" ? "index.html" : rawPath.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch (_) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function createServer() {
  return http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/status") {
    const defaults = providerConfig();
    sendJson(res, 200, {
      ok: true,
      provider: process.env.AI_PROVIDER || "auto",
      providerName: defaults.name,
      model: defaults.model,
      baseUrl: defaults.baseUrl,
      hasAnyApiKey: Boolean(process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CUSTOM_API_KEY),
      dataDir: DATA_DIR
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/generate") {
    handleGenerate(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/api/std-code") {
    handleStdCode(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/test-ai") {
    handleTestAI(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/models") {
    handleModels(req, res);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
  });
}

function listen(port) {
  const server = createServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < MAX_PORT) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1}...`);
      server.close();
      listen(port + 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`AI 数据生成界面已启动：${url}`);
    console.log(`数据目录：${DATA_DIR}`);
    if (process.env.AUTO_OPEN === "1") {
      execFile("open", [url], () => {});
    }
  });
}

listen(START_PORT);

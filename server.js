import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "300kb" }));
app.use(express.static(path.join(__dirname, "public")));

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const client = new Anthropic();

if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: generation will fail.");

const LANGUAGES = {
  python: { label: "Python", ext: "py" },
  javascript: { label: "JavaScript", ext: "js" },
  typescript: { label: "TypeScript", ext: "ts" },
  java: { label: "Java", ext: "java" },
  cpp: { label: "C++", ext: "cpp" },
  c: { label: "C", ext: "c" },
  csharp: { label: "C#", ext: "cs" },
  go: { label: "Go", ext: "go" },
  rust: { label: "Rust", ext: "rs" },
  php: { label: "PHP", ext: "php" },
  ruby: { label: "Ruby", ext: "rb" },
  kotlin: { label: "Kotlin", ext: "kt" },
  swift: { label: "Swift", ext: "swift" },
  r: { label: "R", ext: "R" },
  sql: { label: "SQL", ext: "sql" },
  bash: { label: "Bash", ext: "sh" },
  html: { label: "HTML", ext: "html" },
  css: { label: "CSS", ext: "css" },
};

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return res.status(429).json({ error: "Too many requests. Wait a minute and retry." });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

const systemPrompt = (label) =>
  `You are a code generator for a research lab. Write complete, correct, runnable ${label} code for the user's task. ` +
  `Include brief comments, sensible error handling, and a usage example where it makes sense. ` +
  `If the language requires a class or entry point, name the main class "Main". ` +
  `Reply with exactly one fenced code block and nothing outside it.`;

function extractCode(text) {
  const m = text.match(/```[\w+#.-]*\r?\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim() + "\n";
}

function makeFilename(language, prompt) {
  const { ext } = LANGUAGES[language];
  if (language === "java") return "Main.java";
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "script";
  return `${slug}.${ext}`;
}

app.get("/api/config", (_req, res) => {
  res.json({
    languages: Object.entries(LANGUAGES).map(([id, v]) => ({ id, label: v.label })),
    githubEnabled: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
    repo: process.env.GITHUB_REPO || null,
  });
});

app.post("/api/generate", rateLimit, async (req, res) => {
  const { language, prompt } = req.body || {};
  if (!LANGUAGES[language]) return res.status(400).json({ error: "Choose a supported language." });
  if (typeof prompt !== "string" || prompt.trim().length < 5 || prompt.length > 4000) {
    return res.status(400).json({ error: "Describe the task in 5 to 4000 characters." });
  }
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt(LANGUAGES[language].label),
      messages: [{ role: "user", content: prompt.trim() }],
    });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    res.json({ code: extractCode(text), filename: makeFilename(language, prompt), language });
  } catch (err) {
    console.error("generate failed:", err?.message || err);
    res.status(502).json({ error: "Generation failed. Check ANTHROPIC_API_KEY and the server logs." });
  }
});

app.post("/api/commit", rateLimit, async (req, res) => {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(503).json({ error: "GitHub is not configured. Set GITHUB_TOKEN and GITHUB_REPO." });
  }
  const { language, filename, code, message } = req.body || {};
  if (!LANGUAGES[language]) return res.status(400).json({ error: "Unsupported language." });
  if (typeof filename !== "string" || !/^[\w.-]{1,80}$/.test(filename) || filename.startsWith(".")) {
    return res.status(400).json({ error: "Use a filename with letters, numbers, dots, dashes or underscores." });
  }
  if (typeof code !== "string" || !code.length || code.length > 200_000) {
    return res.status(400).json({ error: "Nothing to commit, or the file is too large." });
  }

  const filePath = `generated/${language}/${filename}`;
  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "labcoder",
  };
  try {
    let existingSha;
    const existing = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
    if (existing.ok) existingSha = (await existing.json()).sha;

    const put = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(message || `Add ${filePath}`).slice(0, 200),
        content: Buffer.from(code, "utf8").toString("base64"),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    const data = await put.json();
    if (!put.ok) return res.status(502).json({ error: `GitHub said: ${data.message || put.status}` });
    res.json({ url: data.content.html_url, path: filePath });
  } catch (err) {
    console.error("commit failed:", err?.message || err);
    res.status(502).json({ error: "Could not reach GitHub." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Labcoder listening on ${port}`));

#!/usr/bin/env node
/* ============================================================
   ai-organize.mjs — AI 笔记整理（MVP 第一步）
   原则（见 可行性分析.md 第三节）：
   1. 只写「建议稿」，绝不改写原笔记；
   2. 只依据原文，不允许补充外部知识；
   3. 全量处理前先备份，改动可回滚；
   4. API 凭据只从环境变量读取，不落盘、不进仓库。
   用法：
     node scripts/ai-organize.mjs --vault ./my-vault --dry-run
     COMMAND_CODE_API_KEY=xxx node scripts/ai-organize.mjs --vault ./my-vault --limit 5
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const opts = {
  vault: arg('vault', arg('v', path.join(ROOT, 'vault-example'))),
  outDir: arg('out', '_ai-建议稿'),
  limit: Number(arg('limit', 0)) || 0,
  dryRun: Boolean(arg('dry-run', false)),
  model: process.env.AI_MODEL || 'deepseek-chat',
  baseUrl: (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  apiKey: process.env.COMMAND_CODE_API_KEY || process.env.AI_API_KEY || '',
  timeoutMs: Number(arg('timeout', 60000))
};

const SYSTEM_PROMPT = [
  '你是一个严格的笔记整理助手。',
  '规则：',
  '1. 只能依据用户给出的原文，不得引入任何外部知识或推测。',
  '2. 不确定的信息留空，不要编造。',
  '3. 只输出一个 JSON 对象，不要输出解释、不要包裹 Markdown 代码块。',
  'JSON 结构：{"summary": "不超过 120 字的摘要", "tags": ["最多5个标签，不加#"], "links": ["建议关联的已有笔记标题"]}'
].join('\n');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(md|markdown)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function extractLinks(body) {
  const out = new Set();
  const re = /\[\[([^\[\]|#]{1,200})/g;
  let m;
  while ((m = re.exec(body))) out.add(m[1].trim());
  return [...out];
}

function titleOf(file, body) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
  const t = fm && /^title:\s*(.+)$/m.exec(fm[0]);
  if (t) return t[1].trim().replace(/^["']|["']$/g, '');
  return path.basename(file, path.extname(file));
}

async function callModel(content, titles) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(opts.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + opts.apiKey
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: '我已经有的笔记标题（只能从这里挑选关联）：\n' +
              titles.join('、') + '\n\n需要整理的原文：\n' + content
          }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    return parseModelJson(text);
  } finally {
    clearTimeout(timer);
  }
}

function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    const data = JSON.parse(raw);
    return {
      summary: typeof data.summary === 'string' ? data.summary.slice(0, 200) : '',
      tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, 5) : [],
      links: Array.isArray(data.links) ? data.links.map(String).slice(0, 8) : []
    };
  } catch (_) {
    return { summary: '', tags: [], links: [], error: '模型输出不是合法 JSON' };
  }
}

function renderSuggestion(title, relPath, result) {
  const lines = [
    '---',
    'title: ' + title + '（AI 建议稿）',
    'source: ' + relPath,
    'generated_by: ai-organize.mjs',
    'status: 待人工确认',
    '---',
    '',
    '# ' + title + ' · AI 建议稿',
    '',
    '> 本文件只是建议，不会改动原笔记。确认后再手工合并。',
    '',
    '## 摘要',
    result.summary || '（模型未给出，建议人工补写）',
    '',
    '## 建议标签',
    result.tags.length ? result.tags.map(t => '- #' + t.replace(/^#/, '')).join('\n') : '（无）',
    '',
    '## 建议双链',
    result.links.length ? result.links.map(t => '- [[' + t.replace(/^\[\[|\]\]$/g, '') + ']]').join('\n') : '（无）',
    ''
  ];
  return lines.join('\n');
}

async function main() {
  const vaultDir = path.resolve(opts.vault);
  if (!fs.existsSync(vaultDir)) {
    console.error('找不到库目录：' + vaultDir);
    process.exit(1);
  }
  const files = walk(vaultDir);
  const targets = opts.limit > 0 ? files.slice(0, opts.limit) : files;
  const titles = files.map(f => titleOf(f));
  const outRoot = path.join(vaultDir, opts.outDir);

  console.log('库目录: ' + vaultDir);
  console.log('待处理: ' + targets.length + ' / ' + files.length + ' 篇');
  console.log('输出到: ' + outRoot);
  console.log('模式: ' + (opts.dryRun ? '试运行（不调用 API、不写文件）' : '正式运行'));

  if (!opts.dryRun && !opts.apiKey) {
    console.error('\n缺少 API 密钥。请先设置环境变量，例如：');
    console.error('  Windows PowerShell:  $env:COMMAND_CODE_API_KEY="你的key"');
    console.error('  Git Bash / Linux:    export COMMAND_CODE_API_KEY=你的key');
    console.error('密钥只从环境变量读取，不要写进代码或提交到仓库。');
    process.exit(2);
  }

  let ok = 0;
  let failed = 0;
  const log = [];

  for (const file of targets) {
    const rel = path.relative(vaultDir, file);
    const title = titleOf(file);
    if (opts.dryRun) {
      console.log('[dry-run] 将整理: ' + rel);
      log.push({ file: rel, status: 'dry-run' });
      ok += 1;
      continue;
    }
    const content = stripFrontmatter(fs.readFileSync(file, 'utf8')).slice(0, 6000);
    try {
      const result = await callModel(content, titles);
      const outPath = path.join(outRoot, rel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, renderSuggestion(title, rel, result), 'utf8');
      console.log('✓ ' + rel + (result.error ? '  ⚠ ' + result.error : ''));
      log.push({ file: rel, status: 'ok', tags: result.tags.length, links: result.links.length, error: result.error || null });
      ok += 1;
    } catch (err) {
      console.error('✗ ' + rel + '  ' + (err && err.message ? err.message : err));
      log.push({ file: rel, status: 'failed', error: String(err && err.message ? err.message : err) });
      failed += 1;
    }
  }

  if (!opts.dryRun) {
    fs.mkdirSync(outRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outRoot, '_run-' + stamp + '.json'), JSON.stringify({ opts: { ...opts, apiKey: '***' }, log }, null, 2), 'utf8');
  }

  console.log('\n完成: 成功 ' + ok + '，失败 ' + failed);
  console.log('提醒：建议稿必须人工确认后再合并；原笔记未被修改。');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('运行失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});

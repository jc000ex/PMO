/**
 * Vercel Serverless Function — PMO 项目数据持久化
 *
 * 接收前端提交的项目变更，写入 GitHub 仓库的 data/projects.json。
 *
 * POST /api/save    body: { projects: [...] }   — 写入完整项目列表
 * POST /api/delete  body: { projectId: "..." }  — 删除单个项目（也可以走 save 传不含该项目的列表）
 *
 * 环境变量（在 Vercel 后台配置）：
 *   GITHUB_TOKEN  — GitHub Personal Access Token (repo 权限)
 *   GITHUB_OWNER  — GitHub 用户名 (默认 jc000ex)
 *   GITHUB_REPO   — 仓库名 (默认 PMO)
 */

const OWNER = process.env.GITHUB_OWNER || 'jc000ex';
const REPO = process.env.GITHUB_REPO || 'PMO';
const FILE_PATH = 'data/projects.json';
const BRANCH = 'main';

function gh(path, opts = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PMO-Dashboard/1.0',
      ...(opts.headers || {}),
    },
  });
}

async function readProjects() {
  const res = await gh(`/contents/${FILE_PATH}?ref=${BRANCH}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub read failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { projects: JSON.parse(content), sha: data.sha };
}

async function writeProjects(projects, sha, message) {
  const json = JSON.stringify(projects, null, 2) + '\n';
  const content = Buffer.from(json).toString('base64');
  const res = await gh(`/contents/${FILE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content, sha, branch: BRANCH }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed (${res.status}): ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'Server not configured: GITHUB_TOKEN missing' });
  }

  try {
    const { projects: incomingProjects } = req.body || {};

    if (!incomingProjects || !Array.isArray(incomingProjects)) {
      return res.status(400).json({ error: 'Missing "projects" array in body' });
    }

    // 读取 → 写入 → 重试（处理并发冲突）
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha } = await readProjects();
      try {
        await writeProjects(incomingProjects, sha, 'Update projects.json via PMO dashboard');
        break;
      } catch (err) {
        if (attempt === 2 || !err.message.includes('409')) throw err;
        // 409 conflict: SHA 变了，重读再写
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

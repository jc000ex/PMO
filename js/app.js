// ===== 全局状态 =====
let originalProjects = [];   // 从JSON加载的原始数据
let projects = [];           // 合并localStorage后的数据
let currentView = 'list';    // 'list' | 'card'
let currentDetailIdx = -1;   // 当前打开详情的项目索引
let sortDir = 0;              // 编号排序：0=默认，1=升序，-1=降序
let sortPriorityDir = -1;     // 优先级排序：默认紧急→低，1=低→高，-1=高→低

// ===== localStorage 键 =====
const STORAGE_KEY = 'pmo_project_edits';

// ===== GitHub API 直接持久化 =====
var APP_VERSION = '20260603-edit-sync-fix';
var GITHUB_API_URL = 'https://api.github.com/repos/jc000ex/PMO/contents/data/projects.json';
var _syncTimer = null;

function getToken() {
  // 优先用 config.js 的变量，其次用 localStorage 的
  if (typeof GITHUB_TOKEN !== 'undefined' && GITHUB_TOKEN) return GITHUB_TOKEN;
  return localStorage.getItem('pmo_github_token') || '';
}

function normalizeProjectId(id) {
  var val = String(id || '').trim();
  return val && val !== '-' && val !== '--' ? val : '';
}

function getProjectKey(p, idx) {
  return normalizeProjectId(p && p.id) || '_idx_' + idx;
}

function getEditStorageKey(p, idx, edits) {
  var currentKey = getProjectKey(p, idx);
  if (!edits || edits[currentKey]) return currentKey;

  var currentId = normalizeProjectId(p && p.id);
  if (!currentId) return currentKey;

  for (var key in edits) {
    if (key.charAt(0) === '_') continue;
    if (edits[key] && normalizeProjectId(edits[key].id) === currentId) {
      return key;
    }
  }
  return currentKey;
}

function hasDuplicateProjectId(id, exceptIdx) {
  var normalized = normalizeProjectId(id);
  if (!normalized) return false;
  return projects.some(function(p, i) {
    return i !== exceptIdx && normalizeProjectId(p.id) === normalized;
  });
}

function getContractStatus(p) {
  return (p && p.contractStatus) === '有' ? '有' : '无';
}

function syncToServer() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(doSync, 2000);
}

function isStaticSaveHost() {
  var host = window.location.hostname;
  return window.location.protocol === 'file:' ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host.endsWith('.github.io');
}

function getPersistableProjects() {
  return projects.map(function(p) {
    var c = { ...p };
    delete c._localUpdates;
    delete c._deletedOA;
    delete c._editedOA;
    delete c._isLocal;
    return c;
  });
}

async function saveViaServer(cleanProjects) {
  var res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects: cleanProjects })
  });
  if (!res.ok) {
    var err = await res.json().catch(function() { return {}; });
    throw new Error(err.error || '服务端保存失败: HTTP ' + res.status);
  }
}

async function saveViaGitHub(cleanProjects, token) {
  var json = JSON.stringify(cleanProjects, null, 2) + '\n';
  var content = btoa(unescape(encodeURIComponent(json)));

  // 先获取当前文件的 sha
  var getRes = await fetch(GITHUB_API_URL + '?ref=main', {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    }
  });
  if (!getRes.ok) throw new Error('读取文件失败: ' + getRes.status);
  var fileInfo = await getRes.json();
  var sha = fileInfo.sha;

  // 提交更新
  var putRes = await fetch(GITHUB_API_URL, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json'
    },
    body: JSON.stringify({
      message: 'Update projects.json via PMO dashboard',
      content: content,
      sha: sha,
      branch: 'main'
    })
  });
  if (!putRes.ok) {
    var err = await putRes.json().catch(function() { return {}; });
    throw new Error(err.message || 'HTTP ' + putRes.status);
  }
}

async function doSync() {
  _syncTimer = null;
  var clean = getPersistableProjects();
  var token = getToken();
  var serverError = null;

  if (token) {
    try {
      await saveViaGitHub(clean, token);
      originalProjects = clean;
      showToast('数据已同步到 GitHub ✓');
      return;
    } catch (fallbackErr) {
      console.error('浏览器 Token 同步失败:', fallbackErr);
      showToast('⚠ GitHub 同步失败，已暂存本地');
      return;
    }
  }

  if (isStaticSaveHost()) {
    console.log('静态页面未配置 GitHub Token，数据暂存在 localStorage');
    showToast('⚠ 已保存到当前浏览器，未同步线上');
    return;
  }

  try {
    await saveViaServer(clean);
  } catch (err) {
    serverError = err;
    console.warn('服务端同步不可用，尝试浏览器 Token 同步:', err);

    console.log('GitHub Token 未配置，数据暂存在 localStorage');
    showToast('⚠ 服务器同步不可用，已暂存本地');
    return;
  }

  // 同步成功后更新 originalProjects 为最新数据，作为内存基准
  // 不再清空 localStorage，避免 Pages 部署延迟期间数据丢失
  originalProjects = clean;
  showToast(serverError ? '数据已通过浏览器 Token 同步 ✓' : '数据已同步到服务器 ✓');
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  // 主题初始化
  initTheme();
  loadProjects();
  initTokenUI();

  // 视图切换
  document.querySelectorAll('.vt-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  initSearchInput();

  // 下拉筛选
  ['filterPhase', 'filterStatus', 'filterPriority', 'filterPm', 'filterCustomer'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderAll);
  });

  // 弹窗关闭
  document.getElementById('modalClose').addEventListener('click', closeDetail);
  document.getElementById('modalDetail').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetail();
  });
  document.getElementById('editClose').addEventListener('click', requestCloseEdit);
  document.getElementById('modalEdit').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.stopPropagation();
  });
  document.getElementById('btnEditCancel').addEventListener('click', requestCloseEdit);
  document.getElementById('btnEditSave').addEventListener('click', saveEdit);
  document.getElementById('btnEditDetail').addEventListener('click', () => {
    if (currentDetailIdx >= 0) openEdit(currentDetailIdx);
  });
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnLogout').addEventListener('click', () => {
    sessionStorage.removeItem('pmo_auth');
    window.location.replace('login.html');
  });
  // 编号排序
  document.querySelector('.project-table th:nth-child(3)').addEventListener('click', () => {
    sortDir = sortDir === 1 ? -1 : sortDir === -1 ? 0 : 1;
    sortPriorityDir = 0;
    updateSortIcon();
    renderList();
    if (currentView === 'card') renderCards();
  });
  // 优先级排序
  var thPriority = document.getElementById('thPriority');
  if (thPriority) {
    thPriority.addEventListener('click', function() {
      sortPriorityDir = sortPriorityDir === 1 ? -1 : sortPriorityDir === -1 ? 0 : 1;
      sortDir = 0;
      updateSortIcon();
      renderList();
      if (currentView === 'card') renderCards();
    });
  }
  updateSortIcon();
  // 新增项目
  document.getElementById('btnNewProject').addEventListener('click', openNewProject);
  document.getElementById('newClose').addEventListener('click', closeNewProject);
  document.getElementById('btnNewCancel').addEventListener('click', closeNewProject);
  document.getElementById('btnNewSave').addEventListener('click', saveNewProject);
  document.getElementById('modalNew').addEventListener('click', e => { if (e.target === e.currentTarget) closeNewProject(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      var mt = document.getElementById('modalToken');
      if (mt && mt.classList.contains('open')) { mt.classList.remove('open'); document.body.style.overflow = ''; return; }
      if (document.getElementById('modalEdit').classList.contains('open')) { requestCloseEdit(); return; }
      if (document.getElementById('modalNew').classList.contains('open')) { closeNewProject(); return; }
      if (document.getElementById('modalDetail').classList.contains('open')) closeDetail();
    }
  });
});

// ===== 加载数据 =====
function loadProjects() {
  fetch('data/projects.json?v=' + encodeURIComponent(APP_VERSION), { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      originalProjects = data;
      mergeLocalEdits();
      document.getElementById('updateTime').textContent =
        new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      renderAll();
    })
    .catch(err => {
      document.getElementById('listTbody').innerHTML =
        '<tr><td colspan="10" class="empty-state">数据加载失败，请检查 data/projects.json 文件</td></tr>';
      console.error(err);
    });
}

// ===== localStorage 编辑合并 =====
function getLocalEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function saveLocalEdits(edits) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function parseUpdateDate(u) {
  var m = (u.date || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '0000-00-00';
}

function sortUpdates(updates) {
  return updates.sort(function(a, b) {
    return parseUpdateDate(b).localeCompare(parseUpdateDate(a));
  });
}

// 将本地更新合并到已有更新列表，按内容去重（避免同步后重复）
function mergeUpdates(baseUpdates, localUpdates) {
  if (!localUpdates || localUpdates.length === 0) return (baseUpdates || []).slice();
  var existingContents = new Set((baseUpdates || []).map(function(u) { return u.content; }));
  var all = (baseUpdates || []).slice();
  for (var i = 0; i < localUpdates.length; i++) {
    if (!existingContents.has(localUpdates[i].content)) {
      all.push(localUpdates[i]);
    }
  }
  return sortUpdates(all);
}

function mergeLocalEdits() {
  var edits = getLocalEdits();
  migrateLegacyPlaceholderIdEdits(edits);
  projects = originalProjects.map(function(p, i) {
    var key = getProjectKey(p, i);
    if (edits[key]) {
      var merged = { ...p, ...edits[key] };
      // 构建完整 updates 列表：JSON原始 + 本地添加（内容去重）
      var allUpdates = mergeUpdates(p.updates, edits[key]._localUpdates);
      // 应用 OA 条目的编辑/删除（存储在 localStorage 中）
      if (edits[key]._deletedOA) {
        allUpdates = allUpdates.filter(function(u) {
          return edits[key]._deletedOA.indexOf(u.content) === -1;
        });
      }
      if (edits[key]._editedOA) {
        allUpdates = allUpdates.map(function(u) {
          var edit = edits[key]._editedOA[u.content];
          return edit ? { date: edit.date, content: edit.content, author: u.author } : u;
        });
      }
      merged.updates = allUpdates;
      delete merged._localUpdates;
      delete merged._deletedOA;
      delete merged._editedOA;
      return merged;
    }
    var cloned = { ...p };
    if (cloned.updates) cloned.updates = sortUpdates(cloned.updates.slice());
    return cloned;
  });

  // 追加仅存在于本地的项目（用户在网页新建的），去重：排除已存在于原始数据的
  if (edits._localProjects && edits._localProjects.length > 0) {
    var existingIds = new Set(projects.map(function(p) { return normalizeProjectId(p.id); }).filter(Boolean));
    var uniqueLocals = edits._localProjects.filter(function(lp) {
      var id = normalizeProjectId(lp.id);
      return !id || !existingIds.has(id);
    });
    projects = projects.concat(uniqueLocals.map(function(lp) {
      var key = normalizeProjectId(lp.id) || '_local_' + lp.name;
      var merged = { ...lp };
      // 应用用户对该项目的编辑（如果有）
      if (edits[key]) {
        merged = { ...merged, ...edits[key] };
        var allU = mergeUpdates(lp.updates, edits[key]._localUpdates);
        if (edits[key]._deletedOA) {
          allU = allU.filter(function(u) { return edits[key]._deletedOA.indexOf(u.content) === -1; });
        }
        if (edits[key]._editedOA) {
          allU = allU.map(function(u) {
            var edit = edits[key]._editedOA[u.content];
            return edit ? { date: edit.date, content: edit.content, author: u.author } : u;
          });
        }
        merged.updates = sortUpdates(allU);
        delete merged._localUpdates;
        delete merged._deletedOA;
        delete merged._editedOA;
      } else {
        if (merged.updates) merged.updates = sortUpdates(merged.updates.slice());
      }
      return merged;
    }));
  }

  // 清理 _localProjects 中已在原始数据存在的项目（Pages 已部署，备份不再需要）
  if (edits._localProjects && edits._localProjects.length > 0) {
    var origIds = new Set(originalProjects.map(function(p) { return normalizeProjectId(p.id); }).filter(Boolean));
    var cleaned = edits._localProjects.filter(function(lp) {
      var id = normalizeProjectId(lp.id);
      return !id || !origIds.has(id);
    });
    if (cleaned.length !== edits._localProjects.length) {
      edits._localProjects = cleaned.length > 0 ? cleaned : undefined;
      if (cleaned.length === 0) delete edits._localProjects;
      saveLocalEdits(edits);
    }
  }
}

function migrateLegacyPlaceholderIdEdits(edits) {
  ['-', '--'].forEach(function(legacyKey) {
    var legacy = edits[legacyKey];
    if (!legacy) return;

    var targetIdx = -1;
    if (legacy.name) {
      targetIdx = originalProjects.findIndex(function(p) {
        return !normalizeProjectId(p.id) && p.name === legacy.name;
      });
    }

    if (targetIdx >= 0) {
      var targetKey = getProjectKey(originalProjects[targetIdx], targetIdx);
      edits[targetKey] = { ...(edits[targetKey] || {}), ...legacy };
    }

    delete edits[legacyKey];
    saveLocalEdits(edits);
  });
}

// ===== 视图切换 =====
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.vt-btn[data-view="${view}"]`).classList.add('active');
  document.getElementById('listView').style.display = view === 'list' ? '' : 'none';
  document.getElementById('projectGrid').style.display = view === 'card' ? '' : 'none';
  renderAll();
}

// ===== 筛选 =====
function getFilteredProjects() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const fp = document.getElementById('filterPhase').value;
  const fs = document.getElementById('filterStatus').value;
  const fpr = document.getElementById('filterPriority').value;
  const fpm = document.getElementById('filterPm').value;
  const fcu = document.getElementById('filterCustomer').value;

  return projects.filter(p => {
    if (fp && p.phase !== fp) return false;
    if (fs && p.status !== fs) return false;
    if (fpr && p.priority !== fpr) return false;
    if (fpm && p.pm !== fpm) return false;
    if (fcu && p.customer !== fcu) return false;
    if (search) {
      const hay = [p.name, p.id, p.customer, p.pm, p.background].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function initSearchInput() {
  var searchEl = document.getElementById('searchInput');
  if (!searchEl) return;

  var userHasInteracted = false;
  var renderSearch = debounce(renderAll, 200);

  function unlockSearch() {
    userHasInteracted = true;
    searchEl.removeAttribute('readonly');
  }

  function clearAutofilledSearch() {
    if (userHasInteracted || !searchEl.value) return;
    searchEl.value = '';
    renderAll();
  }

  ['pointerdown', 'mousedown', 'click', 'focus', 'keydown'].forEach(function(eventName) {
    searchEl.addEventListener(eventName, unlockSearch, { once: true });
  });
  searchEl.addEventListener('input', function() {
    userHasInteracted = true;
    renderSearch();
  });

  clearAutofilledSearch();
  setTimeout(clearAutofilledSearch, 200);
  setTimeout(clearAutofilledSearch, 600);
  setTimeout(clearAutofilledSearch, 1200);
  setTimeout(function() {
    if (!userHasInteracted) searchEl.removeAttribute('readonly');
  }, 1500);
}

function getSortedFilteredProjects() {
  let filtered = getFilteredProjects();

  if (sortDir !== 0) {
    filtered = filtered.slice().sort((a, b) => {
      const na = parseInt((a.id || '-').replace(/[^0-9]/g, '')) || 0;
      const nb = parseInt((b.id || '-').replace(/[^0-9]/g, '')) || 0;
      return sortDir === 1 ? na - nb : nb - na;
    });
  }

  if (sortPriorityDir !== 0) {
    var priorityOrder = { '紧急': 3, '高': 2, '中': 1, '低': 0 };
    var dir = sortPriorityDir;
    filtered = filtered.slice().sort(function(a, b) {
      var pa = Object.prototype.hasOwnProperty.call(priorityOrder, a.priority) ? priorityOrder[a.priority] : -1;
      var pb = Object.prototype.hasOwnProperty.call(priorityOrder, b.priority) ? priorityOrder[b.priority] : -1;
      return dir === 1 ? pa - pb : pb - pa;
    });
  }

  return filtered;
}

// ===== 渲染全部 =====
function renderAll() {
  updateStats();
  updateFilterDropdowns();
  renderList();
  if (currentView === 'card') renderCards();
}

// ===== 统计 =====
function updateStats() {
  const active = projects.filter(p => p.status === '进行中').length;
  const done = projects.filter(p => p.status === '已完成').length;
  const risk = projects.filter(p => p.priority === '高' && p.status === '进行中').length;
  document.getElementById('statTotal').textContent = projects.length;
  document.getElementById('statActive').textContent = active;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statRisk').textContent = risk;
}

// ===== 下拉框选项 =====
function updateFilterDropdowns() {
  fillSelect('filterPhase', [...new Set(projects.map(p => p.phase).filter(Boolean))].sort());
  fillSelect('filterStatus', [...new Set(projects.map(p => p.status).filter(Boolean))].sort());
  const priOrder = { '高': 0, '中': 1, '低': 2 };
  const pris = [...new Set(projects.map(p => p.priority).filter(Boolean))];
  pris.sort((a, b) => (priOrder[a] ?? 9) - (priOrder[b] ?? 9));
  fillSelect('filterPriority', pris);
  fillSelect('filterPm', [...new Set(projects.map(p => p.pm).filter(Boolean))].sort());
  fillSelect('filterCustomer', [...new Set(projects.map(p => p.customer).filter(Boolean))].sort());
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  // 保持之前的选择
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

// ===== 列表视图 =====
function renderList() {
  const tbody = document.getElementById('listTbody');
  let filtered = getSortedFilteredProjects();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">没有匹配的项目</td></tr>';
    document.querySelector('.list-empty').style.display = '';
    return;
  }
  document.querySelector('.list-empty').style.display = 'none';

  tbody.innerHTML = filtered.map((p, fi) => {
    const idx = projects.indexOf(p);
    return `
    <tr onclick="openDetail(${idx})" title="点击查看详情">
      <td class="td-no">${fi + 1}</td>
      <td class="td-name">${esc(p.name)}</td>
      <td>${esc(p.id) || '--'}</td>
      <td>${phaseBadge(p.phase)}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${priorityBadge(p.priority)}</td>
      <td>${esc(p.customer) || '--'}</td>
      <td>${esc(p.pm) || '未指定'}</td>
      <td>${esc(p.endDate) || '待定'}</td>
      <td class="td-actions" onclick="event.stopPropagation()">
        <button class="btn-row-edit" onclick="openEdit(${idx})">✎ 编辑</button>
      </td>
    </tr>`;
  }).join('');
}

// ===== 卡片视图 =====
function renderCards() {
  const grid = document.getElementById('projectGrid');
  const filtered = getSortedFilteredProjects();

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">没有匹配的项目</div>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const idx = projects.indexOf(p);
    return `
    <div class="project-card" onclick="openDetail(${idx})">
      <button class="card-edit-btn" onclick="event.stopPropagation(); openEdit(${idx})" title="编辑">✎</button>
      <div class="card-top">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-badges">
          ${phaseBadge(p.phase)} ${statusBadge(p.status)} ${priorityBadge(p.priority)}
        </div>
      </div>
      <div class="card-info">
        <div class="card-info-item"><span class="card-info-label">编号</span><span class="card-info-value">${esc(p.id) || '--'}</span></div>
        <div class="card-info-item"><span class="card-info-label">客户</span><span class="card-info-value">${esc(p.customer) || '--'}</span></div>
        <div class="card-info-item"><span class="card-info-label">负责人</span><span class="card-info-value">${esc(p.pm) || '未指定'}</span></div>
        <div class="card-info-item"><span class="card-info-label">计划交付</span><span class="card-info-value">${esc(p.endDate) || '待定'}</span></div>
      </div>
      ${p.background ? `<div class="card-desc">${esc(p.background)}</div>` : ''}
    </div>`;
  }).join('');
}

// ===== 详情弹窗 =====
function openDetail(idx) {
  const p = projects[idx];
  if (!p) return;
  currentDetailIdx = idx;

  document.getElementById('modalName').textContent = p.name;
  document.getElementById('modalId').textContent = p.id || '无编号';
  document.getElementById('modalId').className = 'badge badge-phase-default';

  document.getElementById('modalBody').innerHTML = `
    <div class="detail-two-col">
      <!-- 左栏：项目基本情况 -->
      <div class="detail-col detail-col-left">
        <div class="col-title">项目基本情况</div>
        <div class="col-body">
          <div class="detail-block">
            <h3>项目概述</h3>
            <div class="detail-desc">${esc(p.background) || '暂无'}</div>
          </div>
          <div class="detail-block">
            <h3>项目目标</h3>
            <div class="detail-desc">${esc(p.objectives) || '<span class="empty-detail">暂无</span>'}</div>
          </div>
          <div class="detail-block">
            <h3>项目范围</h3>
            <div class="detail-desc">${esc(p.scope) || '<span class="empty-detail">暂无</span>'}</div>
          </div>
          <div class="detail-block">
            <h3>基本信息</h3>
            <div class="detail-grid">
              <div><span class="di-label">项目阶段：</span><span class="di-value">${phaseBadge(p.phase)}</span></div>
              <div><span class="di-label">项目状态：</span><span class="di-value">${statusBadge(p.status)}</span></div>
              <div><span class="di-label">优先级：</span><span class="di-value">${priorityBadge(p.priority)}</span></div>
              <div><span class="di-label">合同情况：</span><span class="di-value">${esc(getContractStatus(p))}</span></div>
              <div><span class="di-label">客户：</span><span class="di-value">${esc(p.customer) || '--'}</span></div>
              <div><span class="di-label">项目负责人：</span><span class="di-value">${esc(p.pm) || '未指定'}</span></div>
              <div><span class="di-label">成员：</span><span class="di-value">${esc(p.members) || '--'}</span></div>
              <div><span class="di-label">计划开始：</span><span class="di-value">${esc(p.startDate) || '待定'}</span></div>
              <div><span class="di-label">计划结束：</span><span class="di-value">${esc(p.endDate) || '待定'}</span></div>
              <div><span class="di-label">实际完成：</span><span class="di-value">${esc(p.actualEndDate) || '--'}</span></div>
            </div>
          </div>
          <div class="detail-block">
            <h3>验收及评价标准</h3>
            <div class="detail-desc">${esc(p.acceptanceCriteria) || '<span class="empty-detail">暂无</span>'}</div>
          </div>
          ${p.businessPhase || p.businessProgress ? `
          <div class="detail-block">
            <h3>商务进展</h3>
            <div class="detail-grid">
              <div><span class="di-label">商务流程：</span><span class="di-value">${p.businessPhase ? '已进入' : '未进入'}</span></div>
              <div><span class="di-label">商务进展：</span><span class="di-value">${esc(p.businessProgress) || '--'}</span></div>
            </div>
          </div>` : ''}
          <div class="detail-block">
            <h3>关键里程碑</h3>
            ${p.milestones && p.milestones.length > 0 ? `
              <div class="timeline">
                ${p.milestones.map(m => `
                  <div class="timeline-item">
                    <div class="timeline-date">${esc(typeof m === 'string' ? '' : m.date || '')}</div>
                    <div class="timeline-content">${esc(typeof m === 'string' ? m : m.content || '')}</div>
                  </div>
                `).join('')}
              </div>
            ` : '<div class="empty-detail">暂无里程碑记录</div>'}
          </div>
          <div class="detail-block">
            <h3>干系人登记表</h3>
            ${p.stakeholders && p.stakeholders.length > 0 ? renderStakeholderTable(p.stakeholders) : '<div class="empty-detail">暂无干系人记录</div>'}
          </div>
          <div class="detail-block">
            <h3>项目风险管理计划</h3>
            ${p.riskPlan && p.riskPlan.length > 0 ? renderRiskTable(p.riskPlan) : '<div class="empty-detail">暂无风险记录</div>'}
          </div>
          <div class="detail-block">
            <h3>项目变更记录</h3>
            ${p.changeLog && p.changeLog.length > 0 ? renderChangeLogTable(p.changeLog) : '<div class="empty-detail">暂无变更记录</div>'}
          </div>
        </div>
      </div>

      <!-- 右栏：项目动态 -->
      <div class="detail-col detail-col-right">
        <div class="col-title">
          项目动态
          ${p.updates && p.updates.length > 0 ? `
          <span class="update-filter">
            <span class="uf-tag active" data-filter="all">全部</span>
            <span class="uf-tag" data-filter="oa">OA</span>
            <span class="uf-tag" data-filter="daily">日常</span>
          </span>
          ` : ''}
        </div>
        <div class="col-body">
          <div class="add-update-form">
            <input type="date" id="inputUpdateDate" value="${new Date().toISOString().slice(0,10)}">
            <input type="text" id="inputUpdate" placeholder="输入最新动态，按回车添加...">
            <button class="btn-add" id="btnAddUpdate">添加</button>
          </div>
          ${p.updates && p.updates.length > 0 ? `
            <div class="timeline" id="detailTimeline" data-project-idx="${idx}" style="margin-top:14px">
              ${p.updates.map((u,i) => `
                <div class="timeline-item" data-source="${u.author === 'OA周报' ? 'oa' : 'daily'}" data-update-idx="${i}">
                  <div class="timeline-date">${esc(u.date || '')} · ${esc(u.author || '')}</div>
                  <div class="timeline-content">
                    <span class="ti-text">${esc(u.content || u)}</span>
                    <span class="ti-actions">
                      <button class="ti-btn ti-edit" data-action="edit" data-idx="${i}" title="编辑">✎</button>
                      <button class="ti-btn ti-del" data-action="delete" data-idx="${i}" title="删除">✕</button>
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="empty-detail" style="margin-top:14px">暂无动态记录<br>上方输入框可直接添加</div>'}
        </div>
      </div>
    </div>
  `;

  document.getElementById('modalDetail').classList.add('open');
  document.body.style.overflow = 'hidden';

  // 绑定添加动态事件
  document.getElementById('btnAddUpdate').addEventListener('click', () => addUpdate(idx));
  document.getElementById('inputUpdate').addEventListener('keydown', e => {
    if (e.key === 'Enter') addUpdate(idx);
  });

  // 绑定动态筛选
  document.querySelectorAll('.uf-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      document.querySelectorAll('.uf-tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      const filter = tag.dataset.filter;
      document.querySelectorAll('#detailTimeline .timeline-item').forEach(item => {
        item.style.display = (filter === 'all' || item.dataset.source === filter) ? '' : 'none';
      });
    });
  });

  // 绑定编辑/删除按钮（事件委托，从 dataset 读取 projectIdx，避免闭包过时）
  var timeline = document.getElementById('detailTimeline');
  if (timeline) {
    timeline.addEventListener('click', function(e) {
      var btn = e.target.closest('.ti-btn');
      if (!btn) return;
      var action = btn.dataset.action;
      var updateIdx = parseInt(btn.dataset.idx);
      var projectIdx = parseInt(timeline.dataset.projectIdx);
      if (action === 'edit') {
        editUpdate(projectIdx, updateIdx);
      } else if (action === 'delete') {
        deleteUpdate(projectIdx, updateIdx);
      }
    });
  }
}

function addUpdate(idx) {
  var input = document.getElementById('inputUpdate');
  var dateInput = document.getElementById('inputUpdateDate');
  var content = input.value.trim();
  if (!content) return;

  var p = projects[idx];
  var edits = getLocalEdits();
  var key = getEditStorageKey(p, idx, edits);
  if (!edits[key]) edits[key] = {};
  if (!edits[key]._localUpdates) edits[key]._localUpdates = [];

  var dateVal = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
  var date = dateVal || new Date().toISOString().slice(0, 10);
  var newEntry = { date: date, content: content, author: 'PMO' };
  edits[key]._localUpdates.push(newEntry);
  // 排序本地更新
  edits[key]._localUpdates = sortUpdates(edits[key]._localUpdates);
  saveLocalEdits(edits);

  // 更新内存
  if (!p.updates) p.updates = [];
  p.updates.push(newEntry);
  p.updates = sortUpdates(p.updates);

  input.value = '';
  openDetail(idx);
  renderAll();
  showToast('动态已添加 ✓');
  syncToServer();
}

function editUpdate(projectIdx, updateIdx) {
  var p = projects[projectIdx];
  var u = p.updates[updateIdx];
  if (!u) return;

  var item = document.querySelector('#detailTimeline .timeline-item[data-update-idx="' + updateIdx + '"]');
  if (!item) return;

  var contentDiv = item.querySelector('.timeline-content');
  var oldText = u.content || '';
  var oldDate = parseUpdateDate(u);

  contentDiv.innerHTML = `
    <div class="ti-edit-form">
      <input type="date" class="ti-edit-date" value="${oldDate}">
      <input type="text" class="ti-edit-text" value="${escAttr(oldText)}" placeholder="编辑动态内容...">
      <button class="ti-edit-save" data-idx="${updateIdx}">保存</button>
      <button class="ti-edit-cancel" data-idx="${updateIdx}">取消</button>
    </div>
  `;

  // 保存按钮
  contentDiv.querySelector('.ti-edit-save').addEventListener('click', function() {
    var newDate = contentDiv.querySelector('.ti-edit-date').value || oldDate;
    var newContent = contentDiv.querySelector('.ti-edit-text').value.trim();
    if (!newContent) return;

    var edits = getLocalEdits();
    var key = getEditStorageKey(p, projectIdx, edits);
    if (!edits[key]) edits[key] = {};

    if (u.author === 'OA周报') {
      // OA 条目：存储编辑版本
      if (!edits[key]._editedOA) edits[key]._editedOA = {};
      edits[key]._editedOA[oldText] = { date: newDate, content: newContent };
    } else {
      // 本地条目：修改 _localUpdates
      if (edits[key]._localUpdates) {
        for (var i = 0; i < edits[key]._localUpdates.length; i++) {
          if (edits[key]._localUpdates[i].content === oldText) {
            edits[key]._localUpdates[i].date = newDate;
            edits[key]._localUpdates[i].content = newContent;
            break;
          }
        }
      }
    }

    saveLocalEdits(edits);
    mergeLocalEdits();
    openDetail(projectIdx);
    renderAll();
    showToast('动态已更新 ✓');
    syncToServer();
  });

  // 取消按钮
  contentDiv.querySelector('.ti-edit-cancel').addEventListener('click', function() {
    mergeLocalEdits();
    openDetail(projectIdx);
  });

  // 回车保存
  contentDiv.querySelector('.ti-edit-text').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') contentDiv.querySelector('.ti-edit-save').click();
  });
}

function deleteUpdate(projectIdx, updateIdx) {
  var p = projects[projectIdx];
  var u = p.updates[updateIdx];
  if (!u) return;

  if (!confirm('确定删除这条动态吗？')) return;

  var edits = getLocalEdits();
  var key = getEditStorageKey(p, projectIdx, edits);
  if (!edits[key]) edits[key] = {};

  if (u.author === 'OA周报') {
    // OA 条目：标记为已删除
    if (!edits[key]._deletedOA) edits[key]._deletedOA = [];
    edits[key]._deletedOA.push(u.content);
  } else {
    // 本地条目：从 _localUpdates 移除
    if (edits[key]._localUpdates) {
      edits[key]._localUpdates = edits[key]._localUpdates.filter(function(loc) {
        return loc.content !== u.content;
      });
    }
  }

  saveLocalEdits(edits);
  mergeLocalEdits();
  openDetail(projectIdx);
  renderAll();
  showToast('动态已删除 ✓');
  syncToServer();
}

function closeDetail() {
  document.getElementById('modalDetail').classList.remove('open');
  document.body.style.overflow = '';
  currentDetailIdx = -1;
}

// ===== 编辑弹窗 =====
function openEdit(idx) {
  const p = projects[idx];
  if (!p) return;
  currentDetailIdx = idx;

  document.getElementById('editBody').innerHTML = `
    <input type="hidden" id="editIdx" value="${idx}">
    <div class="form-row">
      <div class="form-group">
        <label>项目名称</label>
        <input type="text" id="editName" value="${escAttr(p.name)}">
      </div>
      <div class="form-group">
        <label>项目编号</label>
        <input type="text" id="editId" value="${escAttr(p.id)}">
      </div>
    </div>
    <div class="form-row-4">
      <div class="form-group">
        <label>项目阶段</label>
        <select id="editPhase">
          <option value="售前" ${p.phase==='售前'?'selected':''}>售前</option>
          <option value="实施开发中" ${p.phase==='实施开发中'?'selected':''}>实施开发中</option>
          <option value="系统测试中" ${p.phase==='系统测试中'?'selected':''}>系统测试中</option>
          <option value="已结项" ${p.phase==='已结项'?'selected':''}>已结项</option>
        </select>
      </div>
      <div class="form-group">
        <label>项目状态</label>
        <select id="editStatus">
          <option value="进行中" ${p.status==='进行中'?'selected':''}>进行中</option>
          <option value="已完成" ${p.status==='已完成'?'selected':''}>已完成</option>
        </select>
      </div>
      <div class="form-group">
        <label>优先级</label>
        <select id="editPriority">
          <option value="紧急" ${p.priority==='紧急'?'selected':''}>紧急</option>
          <option value="高" ${p.priority==='高'?'selected':''}>高</option>
          <option value="中" ${p.priority==='中'?'selected':''}>中</option>
          <option value="低" ${p.priority==='低'?'selected':''}>低</option>
        </select>
      </div>
      <div class="form-group">
        <label>合同情况</label>
        <select id="editContractStatus">
          <option value="无" ${getContractStatus(p)==='无'?'selected':''}>无</option>
          <option value="有" ${getContractStatus(p)==='有'?'selected':''}>有</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>客户</label>
        <input type="text" id="editCustomer" value="${escAttr(p.customer)}">
      </div>
      <div class="form-group">
        <label>项目负责人</label>
        <input type="text" id="editPm" value="${escAttr(p.pm)}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>计划开始时间</label>
        <input type="date" id="editStartDate" value="${p.startDate||''}">
      </div>
      <div class="form-group">
        <label>计划结束时间</label>
        <input type="date" id="editEndDate" value="${p.endDate||''}">
      </div>
    </div>
    <div class="form-group">
      <label>项目基本情况</label>
      <textarea id="editBg" rows="3">${escAttr(p.background)}</textarea>
    </div>
    <div class="form-group">
      <label>项目目标</label>
      <textarea id="editObj" rows="2">${escAttr(p.objectives)}</textarea>
    </div>
    <div class="form-group">
      <label>项目范围</label>
      <textarea id="editScope" rows="2">${escAttr(p.scope)}</textarea>
    </div>
    <div class="form-group">
      <label>验收及评价标准</label>
      <textarea id="editAccept" rows="2">${escAttr(p.acceptanceCriteria)}</textarea>
    </div>
    <div class="form-group">
      <label>干系人登记表（每行一条：姓名,重要性,类别,单位及职务,联系方式,我方联系人,备注）</label>
      <textarea id="editStakeholders" rows="4">${escAttr(formatCsvRows(p.stakeholders, ['name','importance','category','unit','contact','ourContact','remark']))}</textarea>
    </div>
    <div class="form-group">
      <label>项目风险管理计划（每行一条：类别,风险内容,应对方案）</label>
      <textarea id="editRiskPlan" rows="4">${escAttr(formatCsvRows(p.riskPlan, ['category','content','solution']))}</textarea>
    </div>
    <div class="form-group">
      <label>项目变更记录（每行一条：日期,变更内容,影响,提出人,状态）</label>
      <textarea id="editChangeLog" rows="4">${escAttr(formatCsvRows(p.changeLog, ['date','content','impact','proposer','status']))}</textarea>
    </div>
    <div class="form-group">
      <label>商务进展</label>
      <textarea id="editBizProgress" rows="2">${escAttr(p.businessProgress)}</textarea>
    </div>
  `;

  document.getElementById('modalEdit').classList.add('open');
  document.getElementById('modalEdit').dataset.initialSnapshot = getEditFormSnapshot();
  document.body.style.overflow = 'hidden';
}

function getEditFormSnapshot() {
  var ids = [
    'editName', 'editId', 'editPhase', 'editStatus', 'editPriority', 'editContractStatus',
    'editCustomer', 'editPm', 'editStartDate', 'editEndDate', 'editBg', 'editObj',
    'editScope', 'editAccept', 'editStakeholders', 'editRiskPlan', 'editChangeLog',
    'editBizProgress'
  ];
  return JSON.stringify(ids.map(function(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }));
}

function hasEditFormChanges() {
  var modal = document.getElementById('modalEdit');
  return modal.classList.contains('open') && modal.dataset.initialSnapshot !== getEditFormSnapshot();
}

function requestCloseEdit() {
  if (hasEditFormChanges() && !confirm('编辑内容尚未保存，确定要关闭吗？')) return;
  closeEdit();
}

function saveEdit() {
  const idx = parseInt(document.getElementById('editIdx').value);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return;

  const p = projects[idx];
  const edits = getLocalEdits();
  const key = getEditStorageKey(p, idx, edits);

  const changes = {
    name: document.getElementById('editName').value.trim(),
    id: document.getElementById('editId').value.trim(),
    phase: document.getElementById('editPhase').value,
    status: document.getElementById('editStatus').value,
    priority: document.getElementById('editPriority').value,
    contractStatus: document.getElementById('editContractStatus').value,
    customer: document.getElementById('editCustomer').value.trim(),
    pm: document.getElementById('editPm').value.trim(),
    startDate: document.getElementById('editStartDate').value,
    endDate: document.getElementById('editEndDate').value,
    background: document.getElementById('editBg').value.trim(),
    objectives: document.getElementById('editObj').value.trim(),
    scope: document.getElementById('editScope').value.trim(),
    acceptanceCriteria: document.getElementById('editAccept').value.trim(),
    currentFocus: '',
    summary: '',
    businessProgress: document.getElementById('editBizProgress').value.trim(),
    stakeholders: parseCsvLines(document.getElementById('editStakeholders').value, ['name','importance','category','unit','contact','ourContact','remark']),
    riskPlan: parseCsvLines(document.getElementById('editRiskPlan').value, ['category','content','solution']),
    changeLog: parseCsvLines(document.getElementById('editChangeLog').value, ['date','content','impact','proposer','status'])
  };

  if (hasDuplicateProjectId(changes.id, idx)) {
    alert('项目编号已存在，请换一个编号');
    return;
  }

  // 保存到 localStorage
  if (!edits[key]) edits[key] = {};
  Object.assign(edits[key], changes);
  var newKey = getProjectKey(changes, idx);
  if (newKey !== key) {
    edits[newKey] = { ...(edits[newKey] || {}), ...edits[key] };
  }
  saveLocalEdits(edits);

  // 更新内存
  Object.assign(p, changes);

  closeEdit();
  mergeLocalEdits();  // 重新合并以确保一致性
  renderAll();

  // 如果详情弹窗开着，刷新
  if (document.getElementById('modalDetail').classList.contains('open')) {
    openDetail(idx);
  }

  showToast('项目信息已保存 ✓');
  syncToServer();
}

function closeEdit() {
  document.getElementById('modalEdit').classList.remove('open');
  document.body.style.overflow = '';
  if (document.getElementById('modalDetail').classList.contains('open')) {
    document.body.style.overflow = 'hidden';
  }
}

// ===== 导出数据 =====
function exportData() {
  const exportData = JSON.stringify(projects, null, 2);
  const blob = new Blob([exportData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `projects_export_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('数据已导出，可发送给PMO助理合并到主数据文件 ✓');
}

// ===== Toast 提示 =====
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== 工具函数 =====
function esc(s) {
  if (s === undefined || s === null) return '';
  s = String(s);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escAttr(s) {
  if (s === undefined || s === null) return '';
  s = String(s);
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function phaseBadge(phase) {
  const map = { '售前': 'presale', '实施开发中': 'dev', '系统测试中': 'test', '已结项': 'done' };
  const cls = map[phase] || 'default';
  return `<span class="badge badge-phase-${cls}">${esc(phase) || '未知'}</span>`;
}

function statusBadge(status) {
  const map = { '进行中': 'active', '已完成': 'done' };
  const cls = map[status] || 'default';
  return `<span class="badge badge-status-${cls}">${esc(status) || '未知'}</span>`;
}

function priorityBadge(priority) {
  const map = { '紧急': 'urgent', '高': 'high', '中': 'mid', '低': 'low' };
  const cls = map[priority] || 'default';
  return `<span class="badge badge-priority-${cls}">${esc(priority) || '--'}</span>`;
}

// ===== 表格渲染 =====
function renderStakeholderTable(rows) {
  return `<table class="detail-table">
    <thead><tr><th>#</th><th>姓名</th><th>重要性</th><th>类别</th><th>单位及职务</th><th>联系方式</th><th>我方联系人</th><th>备注</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td>${i+1}</td><td>${esc(r.name||'')}</td><td>${esc(r.importance||'')}</td><td>${esc(r.category||'')}</td><td>${esc(r.unit||'')}</td><td>${esc(r.contact||'')}</td><td>${esc(r.ourContact||'')}</td><td>${esc(r.remark||'')}</td></tr>
    `).join('')}</tbody></table>`;
}

function renderRiskTable(rows) {
  return `<table class="detail-table">
    <thead><tr><th>#</th><th>类别</th><th>风险内容</th><th>应对方案</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td>${i+1}</td><td>${esc(r.category||'')}</td><td>${esc(r.content||'')}</td><td>${esc(r.solution||'')}</td></tr>
    `).join('')}</tbody></table>`;
}

function parseCsvLines(text, fields) {
  return text.trim().split('\n').filter(s => s.trim()).map(line => {
    const vals = line.split(',');
    const obj = {};
    fields.forEach((f, i) => { obj[f] = (vals[i] || '').trim(); });
    return obj;
  });
}

function formatCsvRows(rows, fields) {
  return (rows || []).map(function(row) {
    return fields.map(function(field) {
      var value = row && row[field];
      return value === undefined || value === null ? '' : value;
    }).join(',');
  }).join('\n');
}

function renderChangeLogTable(rows) {
  return `<table class="detail-table">
    <thead><tr><th>#</th><th>日期</th><th>变更内容</th><th>影响</th><th>提出人</th><th>状态</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td>${i+1}</td><td>${esc(r.date||'')}</td><td>${esc(r.content||'')}</td><td>${esc(r.impact||'')}</td><td>${esc(r.proposer||'')}</td><td>${esc(r.status||'')}</td></tr>
    `).join('')}</tbody></table>`;
}

// ===== 排序图标 =====
function updateSortIcon() {
  var idIcon = document.getElementById('sortIdIcon');
  var prIcon = document.getElementById('sortPriorityIcon');
  if (idIcon) {
    if (sortDir === 1) idIcon.textContent = '▲';
    else if (sortDir === -1) idIcon.textContent = '▼';
    else idIcon.textContent = '';
  }
  if (prIcon) {
    if (sortPriorityDir === 1) prIcon.textContent = '▲';
    else if (sortPriorityDir === -1) prIcon.textContent = '▼';
    else prIcon.textContent = '';
  }
}

// ===== 新增项目 =====
function openNewProject() {
  document.getElementById('newBody').innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>项目名称 <span style="color:var(--red)">*</span></label>
        <input type="text" id="newName" placeholder="必填">
      </div>
      <div class="form-group">
        <label>项目编号 <span style="color:var(--red)">*</span></label>
        <input type="text" id="newId" placeholder="必填">
      </div>
    </div>
    <div class="form-row-4">
      <div class="form-group">
        <label>项目阶段</label>
        <select id="newPhase">
          <option value="售前">售前</option>
          <option value="实施开发中" selected>实施开发中</option>
          <option value="系统测试中">系统测试中</option>
          <option value="已结项">已结项</option>
        </select>
      </div>
      <div class="form-group">
        <label>项目状态</label>
        <select id="newStatus">
          <option value="进行中" selected>进行中</option>
          <option value="已完成">已完成</option>
        </select>
      </div>
      <div class="form-group">
        <label>优先级</label>
        <select id="newPriority">
          <option value="中" selected>中</option>
          <option value="紧急">紧急</option>
          <option value="高">高</option>
          <option value="低">低</option>
        </select>
      </div>
      <div class="form-group">
        <label>合同情况</label>
        <select id="newContractStatus">
          <option value="无" selected>无</option>
          <option value="有">有</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>客户</label>
        <input type="text" id="newCustomer">
      </div>
      <div class="form-group">
        <label>项目负责人</label>
        <input type="text" id="newPm">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>计划开始时间</label>
        <input type="date" id="newStartDate">
      </div>
      <div class="form-group">
        <label>计划结束时间</label>
        <input type="date" id="newEndDate">
      </div>
    </div>
    <div class="form-group">
      <label>项目基本情况</label>
      <textarea id="newBg" rows="3"></textarea>
    </div>
    <div class="form-group">
      <label>项目目标</label>
      <textarea id="newObj" rows="2"></textarea>
    </div>
    <div class="form-group">
      <label>项目范围</label>
      <textarea id="newScope" rows="2"></textarea>
    </div>
    <div class="form-group">
      <label>验收及评价标准</label>
      <textarea id="newAccept" rows="2"></textarea>
    </div>
  `;
  document.getElementById('modalNew').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeNewProject(force) {
  if (!force && hasNewFormContent()) {
    if (!confirm('表单中有已填写的内容，确定要关闭吗？数据不会保存。')) return;
  }
  document.getElementById('modalNew').classList.remove('open');
  document.body.style.overflow = '';
}

function hasNewFormContent() {
  var fields = ['newName', 'newId', 'newCustomer', 'newPm', 'newBg', 'newObj', 'newScope', 'newAccept'];
  for (var i = 0; i < fields.length; i++) {
    var el = document.getElementById(fields[i]);
    if (el && el.value.trim()) return true;
  }
  var start = document.getElementById('newStartDate');
  var end = document.getElementById('newEndDate');
  if ((start && start.value) || (end && end.value)) return true;
  return false;
}

function saveNewProject() {
  // 清空搜索框，确保新建项目不会被浏览器的自动填充过滤掉
  var searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  const name = document.getElementById('newName').value.trim();
  const id = document.getElementById('newId').value.trim();
  if (!name) { alert('请填写项目名称'); return; }
  if (!id) { alert('请填写项目编号'); return; }
  if (hasDuplicateProjectId(id, -1)) { alert('项目编号已存在，请换一个编号'); return; }

  const p = {
    id,
    name,
    phase: document.getElementById('newPhase').value,
    status: document.getElementById('newStatus').value,
    priority: document.getElementById('newPriority').value,
    contractStatus: document.getElementById('newContractStatus').value,
    customer: document.getElementById('newCustomer').value.trim(),
    pm: document.getElementById('newPm').value.trim(),
    startDate: document.getElementById('newStartDate').value,
    endDate: document.getElementById('newEndDate').value,
    actualEndDate: '',
    members: '',
    businessPhase: false,
    businessProgress: '',
    currentFocus: '',
    milestones: [],
    updates: [],
    background: document.getElementById('newBg').value.trim(),
    objectives: document.getElementById('newObj').value.trim(),
    scope: document.getElementById('newScope').value.trim(),
    acceptanceCriteria: document.getElementById('newAccept').value.trim(),
    stakeholders: [],
    riskPlan: [],
    changeLog: [],
    summary: ''
  };

  projects.push(p);
  var edits = getLocalEdits();
  // 完整存储到本地项目列表（刷新不丢）
  if (!edits._localProjects) edits._localProjects = [];
  edits._localProjects.push(p);
  // 清理旧的 per-project 编辑数据（如果有）
  delete edits[id];
  saveLocalEdits(edits);
  closeNewProject(true);
  renderAll();
  // 异步同步到服务器
  syncToServer();
}

// ===== 主题切换 =====
function initTheme() {
  const saved = localStorage.getItem('pmo_theme') || 'report';
  applyTheme(saved);
  document.getElementById('themeToggle').addEventListener('click', (e) => {
    const span = e.target.closest('span');
    if (!span) return;
    const theme = span.dataset.themeVal;
    applyTheme(theme);
    localStorage.setItem('pmo_theme', theme);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-toggle span').forEach(s => {
    s.classList.toggle('active', s.dataset.themeVal === theme);
  });
}

// ===== Token 设置 =====
function initTokenUI() {
  var btnSettings = document.getElementById('btnSettings');
  var tokenClose = document.getElementById('tokenClose');
  var btnTokenCancel = document.getElementById('btnTokenCancel');
  var btnTokenSave = document.getElementById('btnTokenSave');
  var tokenInput = document.getElementById('tokenInput');
  var tokenStatus = document.getElementById('tokenStatus');
  var modal = document.getElementById('modalToken');

  if (!btnSettings) return;

  // 初始化：显示已有 token 状态
  var existing = getToken();
  if (existing) {
    btnSettings.style.color = 'var(--green)';
    btnSettings.title = 'GitHub Token 已配置';
  }

  btnSettings.addEventListener('click', function() {
    var t = getToken();
    tokenInput.value = t;
    tokenStatus.textContent = t ? '✅ Token 已配置（重新输入将覆盖）' : '';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  function closeTokenModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  tokenClose.addEventListener('click', closeTokenModal);
  btnTokenCancel.addEventListener('click', closeTokenModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeTokenModal();
  });

  btnTokenSave.addEventListener('click', function() {
    var val = tokenInput.value.trim();
    if (!val) {
      tokenStatus.textContent = '⚠ 请输入有效的 Token';
      tokenStatus.style.color = 'var(--red)';
      return;
    }
    localStorage.setItem('pmo_github_token', val);
    tokenStatus.textContent = '✅ Token 已保存，数据将自动同步到 GitHub';
    tokenStatus.style.color = 'var(--green)';
    btnSettings.style.color = 'var(--green)';
    btnSettings.title = 'GitHub Token 已配置';
    setTimeout(closeTokenModal, 800);
  });
}

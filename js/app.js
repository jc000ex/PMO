// ===== 全局状态 =====
let originalProjects = [];   // 从JSON加载的原始数据
let projects = [];           // 合并localStorage后的数据
let currentView = 'list';    // 'list' | 'card'
let currentDetailIdx = -1;   // 当前打开详情的项目索引

// ===== localStorage 键 =====
const STORAGE_KEY = 'pmo_project_edits';

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  // 主题初始化
  initTheme();
  loadProjects();

  // 视图切换
  document.querySelectorAll('.vt-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // 搜索
  document.getElementById('searchInput').addEventListener('input', debounce(renderAll, 200));

  // 下拉筛选
  ['filterPhase', 'filterStatus', 'filterPriority', 'filterPm', 'filterCustomer'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderAll);
  });

  // 弹窗关闭
  document.getElementById('modalClose').addEventListener('click', closeDetail);
  document.getElementById('modalDetail').addEventListener('click', e => {
    if (e.target === e.target.currentTarget) closeDetail();
  });
  document.getElementById('editClose').addEventListener('click', closeEdit);
  document.getElementById('modalEdit').addEventListener('click', e => {
    if (e.target === e.target.currentTarget) closeEdit();
  });
  document.getElementById('btnEditCancel').addEventListener('click', closeEdit);
  document.getElementById('btnEditSave').addEventListener('click', saveEdit);
  document.getElementById('btnEditDetail').addEventListener('click', () => {
    if (currentDetailIdx >= 0) openEdit(currentDetailIdx);
  });
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnLogout').addEventListener('click', () => {
    sessionStorage.removeItem('pmo_auth');
    window.location.replace('login.html');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDetail(); closeEdit(); }
  });
});

// ===== 加载数据 =====
function loadProjects() {
  fetch('data/projects.json')
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
        '<tr><td colspan="9" class="empty-state">数据加载失败，请检查 data/projects.json 文件</td></tr>';
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

function mergeLocalEdits() {
  const edits = getLocalEdits();
  projects = originalProjects.map((p, i) => {
    const key = p.id || `_idx_${i}`;
    if (edits[key]) {
      // 合并：local层覆盖原始层
      const merged = { ...p, ...edits[key] };
      // updates 数组要合并（原始 + 本地添加）
      if (edits[key]._localUpdates) {
        merged.updates = [...(p.updates || []), ...edits[key]._localUpdates];
      }
      // 清理内部字段，避免泄漏到渲染数据
      delete merged._localUpdates;
      return merged;
    }
    return { ...p };
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
  const filtered = getFilteredProjects();

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
  const filtered = getFilteredProjects();

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
          ${p.summary ? `
          <div class="detail-block">
            <h3>项目当前摘要</h3>
            <div class="summary-block">${esc(p.summary)}</div>
          </div>` : ''}
          <div class="detail-block">
            <h3>当前重点工作</h3>
            <div class="detail-desc">${esc(p.currentFocus) || '<span class="empty-detail">暂无记录</span>'}</div>
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
        <div class="col-title">项目动态</div>
        <div class="col-body">
          <div class="add-update-form">
            <input type="date" id="inputUpdateDate" value="${new Date().toISOString().slice(0,10)}">
            <input type="text" id="inputUpdate" placeholder="输入最新动态，按回车添加...">
            <button class="btn-add" id="btnAddUpdate">添加</button>
          </div>
          ${p.updates && p.updates.length > 0 ? `
            <div class="timeline" style="margin-top:14px">
              ${p.updates.slice().reverse().map(u => `
                <div class="timeline-item">
                  <div class="timeline-date">${esc(u.date || '')} · ${esc(u.author || '')}</div>
                  <div class="timeline-content">${esc(u.content || u)}</div>
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
}

function addUpdate(idx) {
  const input = document.getElementById('inputUpdate');
  const dateInput = document.getElementById('inputUpdateDate');
  const content = input.value.trim();
  if (!content) return;

  const p = projects[idx];
  const key = p.id || `_idx_${idx}`;
  const edits = getLocalEdits();
  if (!edits[key]) edits[key] = {};
  if (!edits[key]._localUpdates) edits[key]._localUpdates = [];

  const dateVal = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
  const date = dateVal || new Date().toISOString().slice(0, 10);
  edits[key]._localUpdates.push({ date, content, author: 'PMO' });
  saveLocalEdits(edits);

  // 更新内存
  if (!p.updates) p.updates = [];
  p.updates.push({ date, content, author: 'PMO' });

  input.value = '';
  // 刷新详情
  openDetail(idx);
  renderAll();
  showToast('动态已添加 ✓');
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
    <div class="form-row-3">
      <div class="form-group">
        <label>项目阶段</label>
        <select id="editPhase">
          <option value="售前" ${p.phase==='售前'?'selected':''}>售前</option>
          <option value="系统测试" ${p.phase==='系统测试'?'selected':''}>系统测试</option>
          <option value="系统交付" ${p.phase==='系统交付'?'selected':''}>系统交付</option>
          <option value="运维" ${p.phase==='运维'?'selected':''}>运维</option>
        </select>
      </div>
      <div class="form-group">
        <label>项目状态</label>
        <select id="editStatus">
          <option value="进行中" ${p.status==='进行中'?'selected':''}>进行中</option>
          <option value="已完成" ${p.status==='已完成'?'selected':''}>已完成</option>
          <option value="暂停" ${p.status==='暂停'?'selected':''}>暂停</option>
        </select>
      </div>
      <div class="form-group">
        <label>优先级</label>
        <select id="editPriority">
          <option value="高" ${p.priority==='高'?'selected':''}>高</option>
          <option value="中" ${p.priority==='中'?'selected':''}>中</option>
          <option value="低" ${p.priority==='低'?'selected':''}>低</option>
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
      <label>当前重点工作</label>
      <textarea id="editFocus" rows="2">${escAttr(p.currentFocus)}</textarea>
    </div>
    <div class="form-group">
      <label>项目当前摘要</label>
      <textarea id="editSummary" rows="3">${escAttr(p.summary)}</textarea>
    </div>
    <div class="form-group">
      <label>干系人登记表（每行一条：姓名,重要性,类别,单位及职务,联系方式,我方联系人,备注）</label>
      <textarea id="editStakeholders" rows="4">${(p.stakeholders||[]).map(s => [s.name,s.importance,s.category,s.unit,s.contact,s.ourContact,s.remark].map(v=>v||'').join(',')).join('\n')}</textarea>
    </div>
    <div class="form-group">
      <label>项目风险管理计划（每行一条：类别,风险内容,应对方案）</label>
      <textarea id="editRiskPlan" rows="4">${(p.riskPlan||[]).map(r => [r.category,r.content,r.solution].map(v=>v||'').join(',')).join('\n')}</textarea>
    </div>
    <div class="form-group">
      <label>项目变更记录（每行一条：日期,变更内容,影响,提出人,状态）</label>
      <textarea id="editChangeLog" rows="4">${(p.changeLog||[]).map(c => [c.date,c.content,c.impact,c.proposer,c.status].map(v=>v||'').join(',')).join('\n')}</textarea>
    </div>
    <div class="form-group">
      <label>商务进展</label>
      <textarea id="editBizProgress" rows="2">${escAttr(p.businessProgress)}</textarea>
    </div>
  `;

  document.getElementById('modalEdit').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function saveEdit() {
  const idx = parseInt(document.getElementById('editIdx').value);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return;

  const p = projects[idx];
  const key = p.id || `_idx_${idx}`;
  const edits = getLocalEdits();

  const changes = {
    name: document.getElementById('editName').value.trim(),
    id: document.getElementById('editId').value.trim(),
    phase: document.getElementById('editPhase').value,
    status: document.getElementById('editStatus').value,
    priority: document.getElementById('editPriority').value,
    customer: document.getElementById('editCustomer').value.trim(),
    pm: document.getElementById('editPm').value.trim(),
    startDate: document.getElementById('editStartDate').value,
    endDate: document.getElementById('editEndDate').value,
    background: document.getElementById('editBg').value.trim(),
    objectives: document.getElementById('editObj').value.trim(),
    scope: document.getElementById('editScope').value.trim(),
    acceptanceCriteria: document.getElementById('editAccept').value.trim(),
    currentFocus: document.getElementById('editFocus').value.trim(),
    summary: document.getElementById('editSummary').value.trim(),
    businessProgress: document.getElementById('editBizProgress').value.trim(),
    stakeholders: parseCsvLines(document.getElementById('editStakeholders').value, ['name','importance','category','unit','contact','ourContact','remark']),
    riskPlan: parseCsvLines(document.getElementById('editRiskPlan').value, ['category','content','solution']),
    changeLog: parseCsvLines(document.getElementById('editChangeLog').value, ['date','content','impact','proposer','status'])
  };

  // 保存到 localStorage
  if (!edits[key]) edits[key] = {};
  Object.assign(edits[key], changes);
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
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function phaseBadge(phase) {
  const map = { '系统测试': 'sys-test', '系统交付': 'delivery', '售前': 'presale', '运维': 'ops' };
  const cls = map[phase] || 'default';
  return `<span class="badge badge-phase-${cls}">${esc(phase) || '未知'}</span>`;
}

function statusBadge(status) {
  const map = { '进行中': 'active', '已完成': 'done', '暂停': 'paused', '有风险': 'risk' };
  const cls = map[status] || 'default';
  return `<span class="badge badge-status-${cls}">${esc(status) || '未知'}</span>`;
}

function priorityBadge(priority) {
  const map = { '高': 'high', '中': 'mid', '低': 'low' };
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

function renderChangeLogTable(rows) {
  return `<table class="detail-table">
    <thead><tr><th>#</th><th>日期</th><th>变更内容</th><th>影响</th><th>提出人</th><th>状态</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr><td>${i+1}</td><td>${esc(r.date||'')}</td><td>${esc(r.content||'')}</td><td>${esc(r.impact||'')}</td><td>${esc(r.proposer||'')}</td><td>${esc(r.status||'')}</td></tr>
    `).join('')}</tbody></table>`;
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

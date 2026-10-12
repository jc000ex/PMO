(function () {
  'use strict';
  var DATA_URL = 'data/projects.json';
  var ONLINE_DATA_URL = 'https://jc000ex.github.io/PMO/data/projects.json';
  var STORAGE_KEY = 'pmo_project_edits';
  var SNAPSHOT_KEY = 'pmo_weekly_report_snapshot';
  var REPORTS_KEY = 'pmo_external_weekly_reports';
  var state = { projects: [], weeks: {}, selectedWeek: '', externalReports: {} };

  var $ = function (id) { return document.getElementById(id); };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }
  function localEdits() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (_) { return {}; } }
  function dateFromUpdate(u) { var m = String(u && u.date || '').match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; }
  function mondayOf(dateText) {
    var d = new Date(dateText + 'T00:00:00'); if (isNaN(d.getTime())) return '';
    var day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return localDate(d);
  }
  function localDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function sundayOf(monday) { var d = new Date(monday + 'T00:00:00'); d.setDate(d.getDate() + 6); return localDate(d); }
  function formatDate(dateText) { var p = dateText.split('-'); return p.length === 3 ? p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日' : dateText; }
  function formatWeek(monday) { return formatDate(monday) + ' - ' + formatDate(sundayOf(monday)); }
  function keyFor(p, i) { return String(p && p.id || '').trim() || '_idx_' + i; }
  function mergeProjects(base) {
    var edits = localEdits();
    return base.map(function (p, i) {
      var key = keyFor(p, i), e = edits[key] || {}, merged = Object.assign({}, p, e);
      var updates = (p.updates || []).slice();
      (e._localUpdates || []).forEach(function (u) { if (!updates.some(function (x) { return x.content === u.content && x.date === u.date; })) updates.push(u); });
      if (e._deletedOA) updates = updates.filter(function (u) { return e._deletedOA.indexOf(u.content) < 0; });
      if (e._editedOA) updates = updates.map(function (u) { var x = e._editedOA[u.content]; return x ? Object.assign({}, u, x) : u; });
      merged.updates = updates; return merged;
    });
  }
  function normalizeText(text) { return String(text || '').replace(/\r\n?/g, '\n').trim(); }
  function fingerprint(projects) {
    return JSON.stringify(projects.map(function (p) { return { id:p.id, name:p.name, updates:(p.updates || []).map(function (u) { return { date:u.date, content:u.content, author:u.author }; }) }; }));
  }
  function buildWeeks(projects) {
    var weeks = {};
    projects.forEach(function (p) { (p.updates || []).forEach(function (u) {
      var date = dateFromUpdate(u), week = mondayOf(date); if (!week) return;
      if (!weeks[week]) weeks[week] = [];
      var item = weeks[week].find(function (x) { return x.project === p; });
      if (!item) { item = { project:p, updates:[] }; weeks[week].push(item); }
      item.updates.push(u);
    }); });
    Object.keys(weeks).forEach(function (w) { weeks[w].sort(function (a,b) { return String(a.project.name || '').localeCompare(String(b.project.name || ''), 'zh-CN'); }); });
    return weeks;
  }
  function textHtml(content) {
    var lines = normalizeText(content).split('\n'), html = [], paragraph = [];
    function flush() { if (paragraph.length) { html.push('<p>' + paragraph.map(esc).join('<br>') + '</p>'); paragraph = []; } }
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) { flush(); return; }
      if (/^(第?[一二三四五六七八九十\d]+[、.．)]|[①②③④⑤⑥⑦⑧⑨⑩]|本周|下周|风险|问题|重点|工作安排|项目进度|需要协调)/.test(t) && /[:：]$/.test(t)) { flush(); html.push('<p class="text-heading">' + esc(t) + '</p>'); return; }
      paragraph.push(t);
    }); flush(); return html.join('');
  }
  function renderList() {
    var keys = Object.keys(state.weeks).sort().reverse(); $('weekCount').textContent = keys.length + ' 周';
    var allDates = [];
    state.projects.forEach(function (p) { (p.updates || []).forEach(function (u) { var d = dateFromUpdate(u); if (d) allDates.push(d); }); });
    var latestDate = allDates.sort().pop();
    $('headerLatestDate').textContent = latestDate ? formatDate(latestDate) : '--';
    $('listHint').textContent = keys.length ? '点击某一周查看该周已提交的全部项目周报' : '暂无可汇总的周报记录';
    $('weekList').innerHTML = keys.length ? '<div class="week-table-wrap"><table class="week-table"><thead><tr><th>周次</th><th>项目摘要</th><th>已提交项目数</th><th>周报记录数</th><th>查看</th></tr></thead><tbody>' + keys.map(function (w) { var rows = state.weeks[w]; var reports = rows.reduce(function (n,r) { return n + r.updates.length; }, 0); var summary = rows.map(function (r) { return Array.from(String(r.project.name || '').trim()).slice(0, 2).join(''); }).filter(Boolean).join('、'); return '<tr class="week-row" data-week="' + w + '"><td class="week-link">' + esc(formatWeek(w)) + '</td><td>' + esc(summary) + '</td><td class="num">' + rows.length + '</td><td class="num">' + reports + '</td><td class="week-link">查看报告 →</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">还没有可展示的周报记录</div>';
    document.querySelectorAll('.week-row').forEach(function (row) { row.addEventListener('click', function () { openWeek(row.dataset.week); }); });
  }
  function openWeek(week) {
    state.selectedWeek = week; var rows = state.weeks[week] || [];
    $('weekListView').hidden = true; $('weekDetailView').hidden = false;
    $('selectedWeekLabel').textContent = formatWeek(week) + ' · 仅列出本周已提交周报的项目';
    $('rawReportPanel').innerHTML = rows.map(function (row) { var p = row.project; return '<article class="project-report"><div class="project-head"><div><div class="project-name">' + esc(p.name || '未命名项目') + '</div><div class="project-sub">' + esc(p.id || '无编号') + ' · 负责人：' + esc(p.pm || '未指定') + (p.customer ? ' · 客户：' + esc(p.customer) : '') + '</div></div><div class="project-status">' + esc(p.status || '') + '</div></div><div class="project-content">' + row.updates.slice().sort(function (a,b) { return dateFromUpdate(a).localeCompare(dateFromUpdate(b)); }).map(function (u) { return '<div class="report-entry"><div class="entry-meta">' + esc(dateFromUpdate(u) || u.date || '') + (u.author ? ' · ' + esc(u.author) : '') + '</div><div class="entry-text">' + textHtml(u.content || u) + '</div></div>'; }).join('') + '</div></article>'; }).join('');
    var report = state.externalReports[week] || '';
    $('externalReportInput').value = report;
    $('externalReportInput').hidden = !!report;
    $('externalReportInput').classList.toggle('report-editor-hidden', !!report);
    $('externalReport').innerHTML = report ? markdownHtml(report) : '<p>保存后，对外报告会显示在这里。</p>';
    $('externalReport').classList.toggle('empty-report', !report);
    $('btnCopyReport').disabled = !report;
    $('btnEditReport').hidden = !report;
    $('btnSaveReport').textContent = report ? '保存修改' : '保存对外报告';
    $('externalReportStatus').textContent = report ? '本周对外报告已保存在当前浏览器，可继续修改、复制或打印。' : '粘贴整理好的报告并保存，内容会保存在当前浏览器。';
    setActiveTab('raw');
  }
  function markdownHtml(markdown) {
    var lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n'), html = [], listType = '';
    function closeList() { if (listType) { html.push('</' + listType + '>'); listType = ''; } }
    function inline(text) { return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
    lines.forEach(function (line) {
      var t = line.trim(); if (!t) { closeList(); return; }
      var heading = t.match(/^(#{1,3})\s+(.+)$/);
      if (heading) { closeList(); var level = heading[1].length; html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); return; }
      var bullet = t.match(/^[-*]\s+(.+)$/), ordered = t.match(/^\d+[.、)]\s*(.+)$/);
      if (bullet || ordered) { var type = bullet ? 'ul' : 'ol'; if (listType !== type) { closeList(); listType = type; html.push('<' + type + '>'); } html.push('<li>' + inline((bullet || ordered)[1]) + '</li>'); return; }
      closeList(); html.push('<p>' + inline(t) + '</p>');
    }); closeList(); return html.join('');
  }
  function setActiveTab(tab) {
    var raw = tab === 'raw'; $('tabRaw').classList.toggle('active', raw); $('tabExternal').classList.toggle('active', !raw);
    $('tabRaw').setAttribute('aria-selected', String(raw)); $('tabExternal').setAttribute('aria-selected', String(!raw));
    $('rawReportPanel').hidden = !raw; $('externalReportPanel').hidden = raw;
  }
  function rawWeekText(week) {
    var rows = state.weeks[week] || [];
    return '项目周报原始内容\n' + formatWeek(week) + '\n\n' + rows.map(function (row) {
      return '【' + (row.project.name || '未命名项目') + '】' + (row.project.id ? '（' + row.project.id + '）' : '') + '\n' + row.updates.slice().sort(function (a,b) { return dateFromUpdate(a).localeCompare(dateFromUpdate(b)); }).map(function (u) { return (u.date || '') + (u.author ? ' · ' + u.author : '') + '\n' + normalizeText(u.content || u); }).join('\n\n');
    }).join('\n\n' + '-'.repeat(24) + '\n\n');
  }
  function copyText(text, successMessage, statusId) {
    navigator.clipboard.writeText(text).then(function () { $(statusId).textContent = successMessage; }).catch(function () { $(statusId).textContent = '复制失败，请手动选择文字复制。'; });
  }
  function saveExternalReport() {
    var report = $('externalReportInput').value.trim();
    if (!report) { $('externalReportStatus').textContent = '请先粘贴整理后的对外报告。'; $('externalReportInput').focus(); return; }
    state.externalReports[state.selectedWeek] = report;
    localStorage.setItem(REPORTS_KEY, JSON.stringify(state.externalReports));
    $('externalReport').innerHTML = markdownHtml(report);
    $('externalReport').classList.remove('empty-report');
    $('externalReportInput').hidden = true;
    $('externalReportInput').classList.add('report-editor-hidden');
    $('btnEditReport').hidden = false;
    $('btnCopyReport').disabled = false;
    $('btnSaveReport').textContent = '保存修改';
    $('externalReportStatus').textContent = '已保存本周对外报告。';
  }
  function editExternalReport() {
    $('externalReportInput').hidden = false;
    $('externalReportInput').classList.remove('report-editor-hidden');
    $('externalReportInput').focus();
    $('btnEditReport').hidden = true;
    $('externalReportStatus').textContent = '编辑完成后点击“保存修改”。';
  }
  function showNotice(message, warn) { var el = $('notice'); el.hidden = !message; el.className = 'notice' + (warn ? ' warn' : ''); el.textContent = message || ''; }
  function diffUpdates(previous, current) {
    var oldMap = {}, newMap = {};
    previous.forEach(function (p) { (p.updates || []).forEach(function (u) { var w = mondayOf(dateFromUpdate(u)); if (w) oldMap[p.id + '|' + w + '|' + dateFromUpdate(u) + '|' + u.content] = (p.name || p.id) + '（' + formatWeek(w) + '）'; }); });
    current.forEach(function (p) { (p.updates || []).forEach(function (u) { var w = mondayOf(dateFromUpdate(u)); if (w) newMap[p.id + '|' + w + '|' + dateFromUpdate(u) + '|' + u.content] = (p.name || p.id) + '（' + formatWeek(w) + '）'; }); });
    var added = Object.keys(newMap).filter(function (k) { return !oldMap[k]; }).map(function (k) { return newMap[k]; });
    var removed = Object.keys(oldMap).filter(function (k) { return !newMap[k]; }).map(function (k) { return oldMap[k]; });
    return { added:added, removed:removed };
  }
  function fetchJson(url) { return fetch(url + '?v=' + Date.now(), { cache:'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function load(isRefresh) {
    $('btnRefresh').disabled = true; fetchJson(ONLINE_DATA_URL).catch(function () { return fetchJson(DATA_URL); }).then(function (base) {
      var merged = mergeProjects(base), previous = [];
      try { previous = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]'); } catch (_) {}
      if (isRefresh && previous.length) { var d = diffUpdates(previous, merged); if (!d.added.length && !d.removed.length) showNotice('本次刷新完成：周报内容没有更新。'); else { var parts = []; if (d.added.length) parts.push('新增 ' + d.added.length + ' 条：' + d.added.slice(0,8).join('、')); if (d.removed.length) parts.push('移除或修改 ' + d.removed.length + ' 条：' + d.removed.slice(0,8).join('、')); showNotice('本次刷新完成：' + parts.join('；') + (d.added.length + d.removed.length > 8 ? '……' : ''), false); } }
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(merged)); state.projects = merged; state.weeks = buildWeeks(merged); renderList();
      if (state.selectedWeek) openWeek(state.selectedWeek);
    }).catch(function (err) { showNotice('周报读取失败：' + err.message, true); }).finally(function () { $('btnRefresh').disabled = false; });
  }
  $('btnRefresh').addEventListener('click', function () { load(true); }); $('btnBack').addEventListener('click', function () { $('weekDetailView').hidden = true; $('weekListView').hidden = false; }); $('btnPrint').addEventListener('click', function () { window.print(); });
  $('tabRaw').addEventListener('click', function () { setActiveTab('raw'); });
  $('tabExternal').addEventListener('click', function () { setActiveTab('external'); });
  $('btnCopyRaw').addEventListener('click', function () { copyText(rawWeekText(state.selectedWeek), '本周原始周报已复制，可粘贴发给我整理。', 'externalReportStatus'); });
  $('btnSaveReport').addEventListener('click', saveExternalReport);
  $('btnEditReport').addEventListener('click', editExternalReport);
  $('btnCopyReport').addEventListener('click', function () {
    var report = state.externalReports[state.selectedWeek]; if (!report) return;
    copyText(report, '对外报告已复制到剪贴板。', 'externalReportStatus');
  });
  try { state.externalReports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '{}'); } catch (_) { state.externalReports = {}; }
  var migratedReports = false;
  Object.keys(state.externalReports).forEach(function (oldWeek) {
    var day = new Date(oldWeek + 'T00:00:00');
    if (day.getDay() !== 0) return;
    day.setDate(day.getDate() + 1);
    var correctedWeek = localDate(day);
    if (!state.externalReports[correctedWeek]) state.externalReports[correctedWeek] = state.externalReports[oldWeek];
    delete state.externalReports[oldWeek];
    migratedReports = true;
  });
  if (migratedReports) localStorage.setItem(REPORTS_KEY, JSON.stringify(state.externalReports));
  var savedTheme = localStorage.getItem('pmo_theme') || 'report';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.querySelectorAll('.theme-toggle span').forEach(function (span) {
    span.classList.toggle('active', span.dataset.themeVal === savedTheme);
  });
  $('themeToggle').addEventListener('click', function (event) {
    var option = event.target.closest('[data-theme-val]'); if (!option) return;
    var theme = option.dataset.themeVal; localStorage.setItem('pmo_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.theme-toggle span').forEach(function (span) { span.classList.toggle('active', span.dataset.themeVal === theme); });
  });
  load(false);
}());

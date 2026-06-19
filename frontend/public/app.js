let currentUser = null;
const app = document.getElementById('app');
const adminNav = document.getElementById('adminNav');
const submissionsNav = document.getElementById('submissionsNav');
const userBox = document.getElementById('userBox');
let submissionPollTimer = null;
let loginFailureCount = 0;

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || res.statusText);
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function jsArg(value) {
  return JSON.stringify(String(value ?? ''));
}
function problemUrl(id) {
  return encodeURIComponent(String(id ?? ''));
}
function problemApi(id, suffix = '') {
  return `/api/problems/${problemUrl(id)}${suffix}`;
}
function routeAnchor(path, label, className = '') {
  const safePath = String(path || '/');
  const cls = className ? ` class="${esc(className)}"` : '';
  return `<a${cls} href="${esc(safePath)}" data-route="${esc(safePath)}">${esc(label)}</a>`;
}
function routeLink(path, label, className = 'btn') {
  return routeAnchor(path, label, className);
}
function routeButton(path, label, className = '') {
  const safePath = String(path || '/');
  const cls = className ? ` class="${esc(className)}"` : '';
  return `<button type="button"${cls} data-route="${esc(safePath)}">${esc(label)}</button>`;
}
async function runUiAction(action, after) {
  try {
    const result = await action();
    if (after) await after(result);
    return result;
  } catch (err) {
    alert(err.message || String(err));
    throw err;
  }
}

function renderKatex(expr, displayMode = false) {
  try {
    if (window.katex) return window.katex.renderToString(expr, { displayMode, throwOnError: false, strict: false });
  } catch (_) {}
  return esc(displayMode ? `$$${expr}$$` : `$${expr}$`);
}

function highlightCode(code, lang = '') {
  const language = String(lang || '').toLowerCase();
  let html = esc(code);
  if (['cpp', 'c++', 'cc', 'cxx', 'cpp11', 'cpp14', 'cpp17', 'c'].includes(language)) {
    html = html
      .replace(/\b(#include|using|namespace|std|int|long|long long|double|float|char|bool|void|return|if|else|for|while|do|switch|case|break|continue|const|auto|vector|string|map|set|queue|stack|priority_queue|struct|class|public|private|cin|cout|scanf|printf)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|'[^']*?')/g, '<span class="tok-string">$1</span>')
      .replace(/(\/\/.*)$/gm, '<span class="tok-comment">$1</span>');
  } else if (['py', 'python', 'python3'].includes(language)) {
    html = html
      .replace(/\b(def|return|if|elif|else|for|while|in|import|from|class|try|except|with|as|True|False|None|and|or|not|lambda|print|input|range|len|list|dict|set)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|'[^']*?')/g, '<span class="tok-string">$1</span>')
      .replace(/(#.*)$/gm, '<span class="tok-comment">$1</span>');
  } else if (['js', 'javascript', 'ts', 'typescript'].includes(language)) {
    html = html
      .replace(/\b(function|const|let|var|return|if|else|for|while|class|new|async|await|try|catch|import|export|from|true|false|null|undefined)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|'[^']*?'|`[^`]*?`)/g, '<span class="tok-string">$1</span>')
      .replace(/(\/\/.*)$/gm, '<span class="tok-comment">$1</span>');
  }
  return html;
}

function renderCodeBlock(code, lang = '') {
  const language = String(lang || '').trim();
  const label = language ? `<div class="code-lang">${esc(language)}</div>` : '';
  return `<div class="code-block">${label}<pre><code class="language-${esc(language)}">${highlightCode(code, language)}</code></pre></div>`;
}

function safeLinkUrl(url) {
  const value = String(url || '').trim();
  if (/^(https?:|\/)/i.test(value)) return value;
  return '#';
}

function renderInlineMarkdown(text) {
  const slots = [];
  function hold(html) { slots.push(html); return `\u0000${slots.length - 1}\u0000`; }
  let raw = String(text ?? '');
  raw = raw.replace(/`([^`]+)`/g, (_m, code) => hold(`<code>${esc(code)}</code>`));
  raw = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => hold(`<img class="md-image" src="${esc(safeLinkUrl(url))}" alt="${esc(alt)}" loading="lazy" />`));
  raw = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => hold(`<a href="${esc(safeLinkUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`));
  raw = raw.replace(/\\\((.+?)\\\)/g, (_m, expr) => hold(renderKatex(expr.trim(), false)));
  raw = raw.replace(/\$([^$\n]+?)\$/g, (_m, expr) => hold(renderKatex(expr.trim(), false)));
  raw = esc(raw)
    .replace(/\b(\d+)\^(\d+)\b/g, '$1<sup>$2</sup>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return raw.replace(/\u0000(\d+)\u0000/g, (_m, i) => slots[Number(i)] || '');
}

function renderMarkdown(source) {
  let text = String(source ?? '').replace(/\r\n/g, '\n');
  const slots = [];
  function hold(html) { slots.push(html); return `\n\u0000${slots.length - 1}\u0000\n`; }
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_m, lang, code) => hold(renderCodeBlock(code.replace(/^\n|\n$/g, ''), lang.trim())));
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, expr) => hold(`<div class="math-block">${renderKatex(expr.trim(), true)}</div>`));
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, expr) => hold(`<div class="math-block">${renderKatex(expr.trim(), true)}</div>`));
  const out = [];
  let paragraph = [];
  let list = [];
  let table = [];
  function flushParagraph() {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  }
  function flushList() {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  }
  function flushTable() {
    if (!table.length) return;
    const rows = table.map((line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((cell) => cell.trim()));
    const hasAlign = rows[1] && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell));
    const head = rows[0] || [];
    const body = hasAlign ? rows.slice(2) : rows.slice(1);
    out.push(`<table class="md-table"><thead><tr>${head.map((c) => `<th>${renderInlineMarkdown(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${renderInlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    table = [];
  }
  for (const line of text.split('\n')) {
    const slot = line.match(/^\u0000(\d+)\u0000$/);
    if (slot) {
      flushParagraph(); flushList(); flushTable();
      out.push(slots[Number(slot[1])] || '');
      continue;
    }
    if (!line.trim()) { flushParagraph(); flushList(); flushTable(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList(); flushTable();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) { flushParagraph(); flushTable(); list.push(bullet[1]); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushParagraph(); flushList(); table.push(line); continue; }
    flushTable();
    paragraph.push(line);
  }
  flushParagraph(); flushList(); flushTable();
  return out.join('\n') || '<p class="muted">暂无内容</p>';
}

function updateMarkdownPreview(textarea, target) {
  const input = typeof textarea === 'string' ? qs(textarea) : textarea;
  const box = typeof target === 'string' ? qs(target) : target;
  if (input && box) box.innerHTML = renderMarkdown(input.value || '');
}

function statusClass(status) { return String(status || '').split(' ')[0]; }

function formatUtc8Time(value) {
  if (!value) return '--';
  const raw = String(value).trim();
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} UTC+8`;
}

const LUOGU_DIFFICULTIES = [
  { value: 'unrated', label: '暂无评定', className: 'unrated' },
  { value: 'beginner', label: '入门', className: 'red' },
  { value: 'popular_minus', label: '普及−', className: 'orange' },
  { value: 'improve_minus', label: '普及/提高−', className: 'yellow' },
  { value: 'popular_plus', label: '普及+/提高', className: 'green' },
  { value: 'province_minus', label: '提高+/省选−', className: 'blue' },
  { value: 'noi_minus', label: '省选/NOI−', className: 'purple' },
  { value: 'ctsc', label: 'NOI/NOI+/CTSC', className: 'black' },
];
function normalizeDifficulty(d) { return d || 'unrated'; }
function difficultyInfo(d) {
  const key = normalizeDifficulty(d);
  return LUOGU_DIFFICULTIES.find((x) => x.value === key) || LUOGU_DIFFICULTIES[0];
}
function difficultyBadge(d) {
  const info = difficultyInfo(d);
  return `<span class="difficulty-badge difficulty-${info.className}">${esc(info.label)}</span>`;
}
function difficultyOptions(selected = '') {
  const value = selected || '';
  return LUOGU_DIFFICULTIES.map((d) => `<option value="${d.value}" ${value === d.value ? 'selected' : ''}>${d.label}</option>`).join('');
}

function checkerModeLabel(value) {
  if (value === 'special_judge') return 'Special Judge';
  return '标准输出';
}

const SUBMISSION_LANGUAGES = [
  { value: 'cpp11', label: 'C++11' },
  { value: 'cpp14', label: 'C++14' },
  { value: 'cpp17', label: 'C++17' },
  { value: 'c', label: 'C11' },
  { value: 'python', label: 'Python 3' },
];
function isCppLanguage(value) {
  return ['cpp11', 'cpp14', 'cpp17'].includes(String(value || ''));
}
function languageOptions(selected = 'cpp14') {
  return SUBMISSION_LANGUAGES.map((lang) => `<option value="${lang.value}" ${selected === lang.value ? 'selected' : ''}>${lang.label}</option>`).join('');
}
function languageLabel(value) {
  const item = SUBMISSION_LANGUAGES.find((lang) => lang.value === value);
  return item ? item.label : String(value || '未知');
}
const PROBLEM_ID_PATTERN = /^[A-Z]+\d+$/;
function validateProblemIdForUI(value) {
  const id = String(value || '').trim();
  if (!PROBLEM_ID_PATTERN.test(id)) {
    alert('题号格式错误：题号必须由若干大写英文字母 + 若干数字组成，例如 P1001、ABC12。');
    return false;
  }
  return true;
}
function requiredLabel(text) { return `<label class="required-label">${text}</label>`; }


const PRELIM_SECTION_LABELS = {
  single_choice: '单项选择题',
  program_reading: '阅读程序',
  code_completion: '完善程序',
};
const PRELIM_TYPE_LABELS = {
  single_choice: '单选题',
  true_false: '判断题',
};
function prelimSectionLabel(value) { return PRELIM_SECTION_LABELS[value] || value || '未知题型'; }
function prelimTypeLabel(value) { return PRELIM_TYPE_LABELS[value] || value || '选择题'; }
function prelimQuestionTitle(q) { return `${q.year} ${q.groupName} 第 ${q.number} 题`; }
function prelimAccuracy(q) {
  if (!q.attemptCount) return '--';
  return `${Math.round((q.correctCount || 0) * 10000 / q.attemptCount) / 100}%`;
}
function prelimStatusBadge(q) {
  if (q.userResult === 1 || q.userResult === true) return '<span class="state-pill state-ac">正确</span>';
  if (q.userResult === 0 || q.userResult === false) return '<span class="state-pill state-hidden">错误</span>';
  return '<span class="state-pill state-none">未做</span>';
}
function prelimTags(q) {
  const names = q.tagNames || (q.tags || []).map((t) => typeof t === 'string' ? t : t.name).filter(Boolean);
  return names.length ? names.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('') : '<span class="muted">--</span>';
}
function prelimQuestionRow(q) {
  return `<tr>
    <td>${prelimStatusBadge(q)}</td>
    <td>${routeAnchor(`/prelim/item/${q.groupId || q.id}`, prelimQuestionTitle(q), 'problem-title-link')}</td>
    <td class="prelim-type-cell"><span class="prelim-type-chip">${esc(prelimSectionLabel(q.section))}</span><div class="muted small">${esc(prelimTypeLabel(q.questionType))}${q.groupNo ? ` · 第 ${esc(q.groupNo)} 组` : ''}</div></td>
    <td>${prelimTags(q)}</td>
    <td>${esc(String(q.score || 0))}</td>
    <td>${prelimAccuracy(q)}</td>
  </tr>`;
}
function prelimOptionButton(option) {
  return `<button type="button" class="prelim-option" data-answer="${esc(option.key)}"><span class="option-key">${esc(option.key === 'T' ? '√' : option.key === 'F' ? '×' : option.key)}</span><span class="option-text">${renderInlineMarkdown(option.text || '')}</span></button>`;
}
function prelimTagWeights(tags = []) {
  if (!tags.length) return '<span class="muted">暂无知识点</span>';
  return tags.map((t) => `<span class="tag-chip">${esc(t.name || t)}${t.weight ? ` ${esc(t.weight)}%` : ''}</span>`).join('');
}
function formatScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
function shouldShowPrelimGroupStem(item) {
  return item && item.section !== 'single_choice' && String(item.stem || '').trim();
}

const PRELIM_SECTION_ORDER = ['single_choice', 'program_reading', 'code_completion'];
function defaultPrelimSectionTitle(section) {
  if (section === 'single_choice') return '一、单项选择题（共 15 题，每题 2 分，共计 30 分；每题有且仅有一个正确选项）';
  if (section === 'program_reading') return '二、阅读程序（程序输入不超过数组或字符串定义的范围；判断题正确填√，错误填×；除特殊说明外，判断题 1.5 分，选择题 3 分，共计 40 分）';
  if (section === 'code_completion') return '三、完善程序（单选题，每小题 3 分，共计 30 分）';
  return prelimSectionLabel(section);
}
function sectionTitleFromGroups(section, groups = []) {
  const found = groups.find((g) => g.section === section && g.sectionTitle);
  return found?.sectionTitle || defaultPrelimSectionTitle(section);
}
function groupShortTitle(item) {
  if (!item) return '';
  if (item.section === 'single_choice') return `${item.firstQuestionNumber || item.number}.${questionScoreInline(item)}`;
  return item.title || `（${item.groupNo || item.number || ''}）`;
}
function questionScoreInline(q) {
  const n = Number(q?.score || 0);
  return Number.isFinite(n) && n > 0 ? `（${formatScore(n)}分）` : '';
}
function questionPaperStem(q) {
  return `${q.number}.${questionScoreInline(q)}${q.stem || ''}`;
}
function numberedStem(q, cls = 'small-stem') {
  return `<div class="markdown ${cls}">${renderMarkdown(questionPaperStem(q))}</div>`;
}
function renderQuestionOptions(q, inputMode = 'button', readonly = false) {
  const options = q.options || [];
  if (inputMode === 'radio') {
    return `<div class="mock-options">${options.map((o) => {
      const key = o.key === 'T' ? '√' : o.key === 'F' ? '×' : o.key;
      return `<label class="mock-option" data-option-key="${esc(o.key)}"><input class="mock-option-input" type="radio" name="q_${q.id}" value="${esc(o.key)}" /><span class="option-key">${esc(key)}</span><span class="option-text markdown">${renderInlineMarkdown(o.text || '')}</span></label>`;
    }).join('')}</div>`;
  }
  return `<div class="prelim-options">${options.map((o) => prelimOptionButton(o).replace('class="prelim-option"', `class="prelim-option" ${readonly ? 'disabled' : ''}`)).join('')}</div>`;
}


function sortText(s) { return ({ default: '默认排序', recent: '最新创建', title: '标题排序', difficulty: '难度排序', acceptance: '通过率' }[s] || '默认排序'); }
function optionList(items = [], selected = '', label = '全部') {
  return `<option value="">${label}</option>` + items.map((x) => `<option value="${esc(x)}" ${String(selected) === String(x) ? 'selected' : ''}>${esc(x)}</option>`).join('');
}
function acceptanceText(p) {
  if (!p.submitCount) return '--';
  return `${Math.round((p.acCount || 0) * 10000 / p.submitCount) / 100}%`;
}
function problemVisibilityBadge(p) {
  return p.isPublic ? '<span class="state-pill state-public">公开</span>' : '<span class="state-pill state-hidden">隐藏</span>';
}
function problemSubmitStatus(p) {
  return p.accepted ? '<span class="state-pill state-ac">已通过</span>' : '<span class="state-pill state-none">未提交</span>';
}
function selectedFilterParams(params, keys) {
  const q = new URLSearchParams();
  for (const k of keys) if (params.get(k)) q.set(k, params.get(k));
  return q;
}
function setActiveNav() {
  qsa('.main-nav [data-nav]').forEach((btn) => btn.classList.remove('active'));
  const path = location.pathname;
  const key = path.startsWith('/admin') ? 'admin' : path.startsWith('/analytics') ? 'analytics' : path.startsWith('/prelim/mock') ? 'mock' : path.startsWith('/prelim') ? 'prelim' : path.startsWith('/submissions') || path.startsWith('/submission') ? 'submissions' : 'problems';
  const btn = qs(`.main-nav [data-nav="${key}"]`);
  if (btn) btn.classList.add('active');
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function qs(selector, root = document) { return root.querySelector(selector); }
function qsa(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function ensureControlId(control, index = 0) {
  if (control.id) return control.id;
  const base = control.name || control.getAttribute('aria-label') || control.dataset.fileLabel || control.type || control.tagName.toLowerCase();
  const safeBase = String(base).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
  control.id = `liteoj-${safeBase}-${index}`;
  return control.id;
}
function controlHasAccessibleName(control) {
  if (control.labels && control.labels.length) return true;
  if (control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return true;
  return false;
}
function enhanceFormAccessibility(root = app) {
  if (!root) return;
  const controls = qsa('input, select, textarea', root);
  controls.forEach((control, index) => {
    ensureControlId(control, index);
    if (!control.name && !['button', 'submit', 'reset'].includes(control.type || '')) {
      if (control.dataset.mdImage !== undefined) control.name = 'markdownImage';
      else if (control.type === 'file') control.name = control.id;
    }
  });
  qsa('label', root).forEach((label) => {
    if (label.htmlFor || label.querySelector('input, select, textarea')) return;
    let control = null;
    let next = label.nextElementSibling;
    if (next?.matches?.('input, select, textarea')) control = next;
    if (!control && next?.querySelector) control = next.querySelector('input, select, textarea');
    if (!control && label.parentElement) {
      const siblings = [...label.parentElement.children];
      const start = siblings.indexOf(label);
      for (const sibling of siblings.slice(start + 1)) {
        if (sibling.matches?.('input, select, textarea')) { control = sibling; break; }
        control = sibling.querySelector?.('input, select, textarea');
        if (control) break;
      }
    }
    if (control) label.htmlFor = ensureControlId(control);
  });
  controls.forEach((control, index) => {
    if (control.type === 'hidden' || controlHasAccessibleName(control)) return;
    const placeholder = control.getAttribute('placeholder');
    const name = control.name || control.id || `${control.tagName.toLowerCase()}-${index}`;
    control.setAttribute('aria-label', placeholder || name.replace(/^liteoj-/, '').replace(/-/g, ' '));
  });
}
function clearSubmissionPoll() {
  if (submissionPollTimer) clearTimeout(submissionPollTimer);
  submissionPollTimer = null;
}

function scheduleSubmissionPoll(id) {
  clearSubmissionPoll();
  const expectedPath = `/submission/${id}`;
  submissionPollTimer = setTimeout(() => {
    submissionPollTimer = null;
    if (location.pathname !== expectedPath) return;
    renderSubmission(id).catch(console.error);
  }, 1800);
}

function nav(path) {
  clearSubmissionPoll();
  history.pushState(null, '', path);
  render();
}
window.nav = nav;
document.addEventListener('click', (event) => {
  const routeEl = event.target.closest('[data-route]');
  if (!routeEl) return;
  const path = routeEl.dataset.route || routeEl.getAttribute('href');
  if (!path || /^(https?:|mailto:)/i.test(path) || routeEl.target) return;
  event.preventDefault();
  nav(path);
});
window.addEventListener('popstate', () => {
  clearSubmissionPoll();
  render();
});

function setImmersive(on) {
  document.body.classList.toggle('auth-page', Boolean(on));
}

async function refreshMe() {
  const data = await api('/api/auth/me');
  currentUser = data.user;
  adminNav.classList.toggle('hidden', currentUser?.role !== 'admin');
  if (submissionsNav) submissionsNav.classList.toggle('hidden', !currentUser);
  if (currentUser) {
    const roleText = currentUser.role === 'admin' ? '管理员' : '普通用户';
    userBox.innerHTML = `${routeAnchor('/profile', `${currentUser.username} · ${roleText}`, 'user-name profile-link')} <button type="button" onclick="logout()">退出</button>`;
  } else {
    userBox.innerHTML = `${routeButton('/login', '登录')}${routeButton('/register', '注册', 'primary')}`;
  }
  setActiveNav();
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  await refreshMe();
  nav('/');
}
window.logout = logout;

function renderError(err) {
  setImmersive(false);
  app.innerHTML = `<div class="card error"><b>操作失败：</b>${esc(err.message || err)}</div>`;
}

function showInlineError(target, err) {
  const box = qs(target);
  if (box) box.innerHTML = `<div class="error" role="alert">${esc(err.message || err)}</div>`;
}
function showInlineSuccess(target, message) {
  const box = qs(target);
  if (box) box.innerHTML = `<div class="success">${esc(message)}</div>`;
}

function authLayout(type) {
  const isLogin = type === 'login';
  return `
    <section class="auth-shell simple-auth-shell">
      <div class="auth-main simple-auth-card">
        <div class="auth-logo"><img src="/logo-mark.svg" alt="LiteOJ" /></div>
        <h1>${isLogin ? '登录账号' : '注册账号'}</h1>
        <p class="auth-note">${isLogin ? '登录后可以提交代码、查看评测记录。' : '创建账号后即可开始刷题与提交代码。'}</p>
        <div id="authMsg"></div>
        <form id="${isLogin ? 'loginForm' : 'registerForm'}" class="auth-form">
          <label class="material-textbox">用户名
            <input name="username" type="text" autocomplete="username" autofocus placeholder="请输入用户名" />
          </label>
          <label class="material-textbox">密码
            <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="${isLogin ? '请输入密码' : '至少 6 位字符'}" />
          </label>
          <button class="primary expanded rounded auth-submit-btn">${isLogin ? '登录' : '注册'}</button>
        </form>
        <p class="auth-bottom">
          ${isLogin ? `还没有账号？${routeAnchor('/register', '立即注册')}` : `已有账号？${routeAnchor('/login', '返回登录')}`}
        </p>
      </div>
    </section>`;
}

async function renderLogin() {
  setImmersive(true);
  loginFailureCount = 0;
  app.innerHTML = authLayout('login');
  qs('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
      await refreshMe();
      nav('/');
    } catch (err) {
      loginFailureCount += 1;
      showInlineError('#authMsg', `${err.message || err}，请检查后重试（第 ${loginFailureCount} 次失败）。`);
      const passwordInput = qs('[name="password"]', e.target);
      passwordInput?.focus();
      passwordInput?.select();
    }
  };
}

async function renderRegister() {
  setImmersive(true);
  app.innerHTML = authLayout('register');
  qs('#registerForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/register', { method: 'POST', body: formData(e.target) });
      await refreshMe();
      nav('/');
    } catch (err) { showInlineError('#authMsg', err); }
  };
}

async function renderProfile() {
  setImmersive(false);
  if (!currentUser) { nav('/login'); return; }
  const roleText = currentUser.role === 'admin' ? '管理员' : '普通用户';
  app.innerHTML = `<div class="profile-page">
    <div class="grid two profile-grid">
      <section class="card profile-card">
        <h2>账号信息</h2>
        <dl class="profile-info">
          <dt>用户名</dt><dd>${esc(currentUser.username)}</dd>
          <dt>角色</dt><dd>${esc(roleText)}</dd>
          <dt>注册时间</dt><dd>${esc(currentUser.createdAt || '--')}</dd>
        </dl>
      </section>
      <section class="card profile-card">
        <h2>修改密码</h2>
        <div id="profileMsg"></div>
        <form id="passwordForm" class="profile-password-form">
          <label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" required /></label>
          <label>新密码<input name="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 位字符" required /></label>
          <label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" required /></label>
          <button class="primary">保存新密码</button>
        </form>
      </section>
    </div>
  </div>`;
  qs('#passwordForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/profile/password', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      showInlineSuccess('#profileMsg', '密码修改成功，请牢记新密码。');
    } catch (err) {
      showInlineError('#profileMsg', err);
    }
  };
}

function publicProblemRow(p) {
  return `<tr>
    <td>${problemSubmitStatus(p)}</td>
    <td>${routeAnchor(`/problem/${problemUrl(p.id)}`, `${p.id}. ${p.title}`, 'problem-title-link')}</td>
    <td>${(p.tags || []).length ? (p.tags || []).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('') : '<span class="muted">--</span>'}</td>
    <td>${difficultyBadge(p.difficulty)}</td>
    <td>${acceptanceText(p)}</td>
  </tr>`;
}

function manageProblemRow(p) {
  return `<tr>
    <td><input type="checkbox" class="problem-check" value="${esc(p.id)}"></td>
    <td>${problemVisibilityBadge(p)}<div class="muted small">数据 ${p.caseCount || 0} 组</div></td>
    <td>${routeAnchor(`/problem/${problemUrl(p.id)}`, `${p.id}. ${p.title}`, 'problem-title-link')}</td>
    <td>${(p.tags || []).length ? (p.tags || []).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('') : '<span class="muted">--</span>'}</td>
    <td>${difficultyBadge(p.difficulty)}</td>
    <td>${acceptanceText(p)}<div class="muted small">${p.acCount || 0}/${p.submitCount || 0}</div></td>
    <td class="table-actions-cell">
      <div class="table-action-row" aria-label="题目操作">
        ${routeLink(`/admin/problem/${problemUrl(p.id)}/edit`, '编辑', 'btn table-link-btn')}
        ${routeLink(`/admin/problem/${problemUrl(p.id)}/data`, '数据', 'btn table-link-btn')}
        <button type="button" data-problem-action="toggle" data-id="${esc(p.id)}" data-public="${p.isPublic ? '0' : '1'}">${p.isPublic ? '隐藏' : '公开'}</button>
        <button type="button" data-problem-action="clone" data-id="${esc(p.id)}">复制</button>
        <button type="button" class="danger" data-problem-action="delete" data-id="${esc(p.id)}">删除</button>
      </div>
    </td>
  </tr>`;
}

async function renderProblems() {
  setImmersive(false);
  const params = new URLSearchParams(location.search);
  const keys = ['keyword','tag','difficulty','sort'];
  const query = selectedFilterParams(params, keys);
  const [data, facets] = await Promise.all([
    api('/api/problems' + (query.toString() ? `?${query}` : '')),
    api('/api/problems/facets'),
  ]);
  app.innerHTML = `
    <div class="card filter-panel-card">
      <form id="problemFilter" class="filter-panel-grid problem-filter-grid">
        <label class="filter-keyword">关键词<input name="keyword" placeholder="题号 / 标题 / 题面" value="${esc(params.get('keyword') || '')}" /></label>
        <label class="filter-difficulty">难度<select name="difficulty"><option value="">全部难度</option>${difficultyOptions(params.get('difficulty') || '')}</select></label>
        <label class="filter-tag">知识点<select name="tag">${optionList(facets.tags || [], params.get('tag') || '', '全部知识点')}</select></label>
        <label class="filter-sort">排序<select name="sort">${['default','recent','title','difficulty','acceptance'].map((x) => `<option value="${x}" ${params.get('sort') === x ? 'selected' : ''}>${sortText(x)}</option>`).join('')}</select></label>
        <div class="filter-actions"><button class="primary">筛选</button><button type="button" class="reset-btn" onclick="nav('/problems')">重置</button></div>
      </form>
    </div>
    <div class="card table-card problemset-table">
      <table>
        <thead><tr><th>状态</th><th>标题</th><th>知识点</th><th>难度</th><th>通过率</th></tr></thead>
        <tbody>${data.problems.length ? data.problems.map(publicProblemRow).join('') : `<tr><td colspan="5" class="muted">暂无题目</td></tr>`}</tbody>
      </table>
      <div class="table-footer">共 ${data.problems.length} 条</div>
    </div>`;
  qs('#problemFilter').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const q = new URLSearchParams();
    for (const k of keys) if (f[k]) q.set(k, f[k]);
    nav('/problems' + (q.toString() ? `?${q}` : ''));
  };
}

async function renderProblem(id) {
  setImmersive(false);
  const data = await api(problemApi(id));
  const p = data.problem;
  app.innerHTML = `
    <div class="card problem-card">
      <div class="problem-head row space">
        <div class="problem-heading">
          <h1 class="problem-title">${esc(p.id)} ${esc(p.title)}</h1>
          <p class="problem-meta muted">时间限制：${p.timeLimit} ms　内存限制：${p.memoryLimit} MB　难度：${difficultyBadge(p.difficulty)}　计分：测试点/子任务得分　评测：${esc(checkerModeLabel(p.checkerMode))}</p>
        </div>
        ${currentUser?.role === 'admin' ? `<div class="row actions">${routeLink(`/admin/problem/${problemUrl(p.id)}/edit`, '编辑', 'btn')}</div>` : ''}
      </div>
      <div class="problem-tags">${(p.tags || []).map((t) => `<span class="problem-tag">${esc(t)}</span>`).join('')}${p.isPublic ? '' : '<span class="problem-tag warn">隐藏</span>'}</div>
      <div class="markdown problem-statement">${renderMarkdown(p.description || '暂无题面')}</div>
    </div>
    <div class="card">
      <h2>提交代码</h2>
      ${currentUser ? `
        <form id="submitForm">
          <label>语言</label><select name="language">${languageOptions()}</select>
          <label class="checkbox-line o2-line"><input type="checkbox" name="o2" checked /> 开启 O2 优化</label>
          <label>代码</label><textarea name="code" class="codearea" placeholder="请在这里粘贴或编写代码"></textarea>
          <p><button class="primary">提交</button></p>
        </form>` : `<p class="muted">请先登录后再提交。</p><button onclick="nav('/login')">去登录</button>`}
    </div>
    ${currentUser?.role === 'admin' ? `<div class="card"><h2>管理信息</h2>${renderCaseTable(p.id, data.cases || [])}<div class="row button-row">${routeLink(`/admin/problem/${problemUrl(p.id)}/data`, '管理测试点', 'btn')}<button type="button" onclick="rejudgeProblem(${jsArg(p.id)})">重测本题</button></div></div>` : ''}`;
  const form = qs('#submitForm');
  if (form) {
    const languageSelect = qs('[name="language"]', form);
    const o2Line = qs('.o2-line', form);
    const o2Input = qs('[name="o2"]', form);
    const syncO2 = () => {
      const visible = isCppLanguage(languageSelect?.value);
      o2Line?.classList.toggle('hidden', !visible);
      if (o2Input) {
        o2Input.disabled = !visible;
        if (!visible) o2Input.checked = false;
      }
    };
    languageSelect?.addEventListener('change', syncO2);
    syncO2();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      data.o2 = isCppLanguage(data.language) && Boolean(e.target.o2?.checked);
      const result = await api(problemApi(id, '/submit'), { method: 'POST', body: data });
      nav(`/submission/${result.submissionId}`);
    };
  }
}

function renderCaseTable(_problemId, cases) {
  if (!cases.length) return '<p class="muted">暂无测试点。</p>';
  const groups = groupCasesBySubtask(cases);
  const groupScore = new Map(groups.map((group) => [group.subtask || '', group.score]));
  const firstInGroup = new Set(groups.map((group) => group.cases[0]?.id).filter(Boolean));
  return `<table><thead><tr><th>#</th><th>子任务</th><th>分值</th><th>输入文件</th><th>输出文件</th></tr></thead><tbody>${cases.map((c) => {
    const scoreText = c.subtask ? (firstInGroup.has(c.id) ? `${formatScore(groupScore.get(c.subtask) || 0)}（子任务）` : '随子任务') : formatScore(c.score);
    return `<tr><td>${c.sort}</td><td>${c.subtask ? esc(c.subtask) : '<span class="muted">--</span>'}</td><td>${esc(scoreText)}</td><td>${esc(c.inputPath)}</td><td>${esc(c.outputPath)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function caseFileName(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '--';
}

function caseEditorId(caseId) {
  return `caseEditor-${String(caseId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function groupCasesBySubtask(cases = []) {
  const groups = [];
  const map = new Map();
  for (const c of cases) {
    const key = c.subtask || '__single__';
    if (!map.has(key)) {
      const group = {
        key,
        title: c.subtask || '未分组测试点',
        subtask: c.subtask || '',
        cases: [],
        score: 0,
      };
      map.set(key, group);
      groups.push(group);
    }
    const group = map.get(key);
    group.cases.push(c);
    group.score += Number(c.score || 0);
  }
  return groups;
}

function caseEffectiveTime(problem, c = {}) {
  return Number(c.timeLimit || 0) || Number(problem.timeLimit || 1000) || 1000;
}

function caseEffectiveMemory(problem, c = {}) {
  return Number(c.memoryLimit || 0) || Number(problem.memoryLimit || 128) || 128;
}

function caseHelpIcon(text) {
  return `<span class="help-icon" tabindex="0" data-tooltip="${esc(text)}">?</span>`;
}

function normalizeCaseGroups(cases = [], subtaskMode = false) {
  if (!subtaskMode) return [{ name: '', score: 0, cases: cases.map((c) => ({ ...c, subtask: '' })) }];
  const map = new Map();
  const ensure = (name) => {
    const key = name || '子任务1';
    if (!map.has(key)) map.set(key, { name: key, score: 0, cases: [] });
    return map.get(key);
  };
  ensure('子任务1');
  for (const c of cases) {
    const name = c.subtask || '子任务1';
    const group = ensure(name);
    group.cases.push({ ...c, subtask: name });
    group.score += Number(c.score || 0);
  }
  return [...map.values()].filter((group, index) => index === 0 || group.cases.length);
}

function renderCaseRow(problemId, problem, c, index, subtaskMode) {
  const timeValue = caseEffectiveTime(problem, c);
  const memoryValue = caseEffectiveMemory(problem, c);
  return `<div class="case-data-row" draggable="true" data-case-id="${esc(c.id)}">
    <label class="case-select"><input type="checkbox" aria-label="选择测试点 ${index + 1}" /></label>
    <span class="case-index">#${index + 1}</span>
    <code class="case-file-name">${esc(caseFileName(c.inputPath))}</code>
    <code class="case-file-name">${esc(caseFileName(c.outputPath))}</code>
    <label class="case-mini-field"><input class="case-time-input" inputmode="numeric" value="${esc(timeValue)}" /></label>
    <label class="case-mini-field"><input class="case-memory-input" inputmode="numeric" value="${esc(memoryValue)}" /></label>
    ${subtaskMode ? '' : `<label class="case-mini-field case-score-field"><input class="case-score-input" inputmode="decimal" value="${esc(c.score || 0)}" /></label>`}
    <div class="case-row-actions">
      <button type="button" class="case-edit-btn" data-problem-id="${esc(problemId)}" data-case-id="${esc(c.id)}">编辑</button>
      <button type="button" class="danger case-delete-btn" data-problem-id="${esc(problemId)}" data-case-id="${esc(c.id)}">删除</button>
    </div>
    <div class="case-inline-editor" id="${esc(caseEditorId(c.id))}"></div>
  </div>`;
}

function renderPlainCaseList(problemId, problem, cases) {
  return `<section class="case-plain-list" data-subtask="">
    <div class="case-row-head">
      <span><input type="checkbox" class="case-select-all" aria-label="选择全部测试点" /></span><span>#</span><span>输入文件</span><span>输出文件</span><span>时间限制 <small>ms</small></span><span>内存限制 <small>MB</small></span><span>分值</span><span>操作</span>
    </div>
    <div class="case-drop-list">${cases.map((c, idx) => renderCaseRow(problemId, problem, c, idx, false)).join('')}</div>
  </section>`;
}

function renderSubtaskGroup(problemId, problem, group, groupIndex, globalStartIndex, groupCount) {
  const title = `子任务${groupIndex + 1}`;
  return `<section class="case-subtask-card" data-subtask="${esc(title)}">
    <div class="case-subtask-head">
      <strong class="case-subtask-title">${esc(title)}</strong>
      <label class="case-subtask-score-field">分值:<input class="case-subtask-score" inputmode="decimal" value="${esc(group.score || '')}" /><span>分</span></label>
      <label>时间限制:<input class="case-subtask-fill-time" inputmode="numeric" placeholder="一键填充  ms" /></label>
      <label>内存限制:<input class="case-subtask-fill-memory" inputmode="numeric" placeholder="一键填充  MB" /></label>
      <button type="button" class="danger case-remove-subtask" ${groupCount <= 1 ? 'disabled' : ''}>删除子任务</button>
    </div>
    <div class="case-row-head case-subtask-row-head">
      <span><input type="checkbox" class="case-select-all" aria-label="选择本子任务测试点" /></span><span>#</span><span>输入文件</span><span>输出文件</span><span>时间限制 <small>ms</small></span><span>内存限制 <small>MB</small></span><span>操作</span>
    </div>
    <div class="case-drop-list">${group.cases.map((c, idx) => renderCaseRow(problemId, problem, c, globalStartIndex + idx, true)).join('')}</div>
  </section>`;
}

function renderSubtaskCaseList(problemId, problem, cases) {
  const groups = normalizeCaseGroups(cases, true);
  let offset = 0;
  const html = groups.map((group, index) => {
    const out = renderSubtaskGroup(problemId, problem, group, index, offset, groups.length);
    offset += group.cases.length;
    return out;
  }).join('');
  return `<div class="case-subtask-list" id="caseSubtaskList">${html}</div>
    <button type="button" id="addSubtaskBtn" class="case-add-line"><span></span><b>⊕ 添加子任务</b><span></span></button>`;
}

function renderCaseOverview(problemId, problem, cases = [], subtaskMode = false) {
  if (!cases.length) {
    return `<div class="case-empty-state">
      <h3>暂无测试点</h3>
      <p class="muted">上传 zip 或手动新增测试点后，这里会展示文件、分值和时空限制；点击编辑不会加载测试点正文。</p>
    </div>`;
  }
  const groups = normalizeCaseGroups(cases, subtaskMode);
  const totalScore = cases.reduce((sum, c) => sum + Number(c.score || 0), 0);
  return `<div class="case-overview">
    <div class="case-summary-strip">
      <div><b>${cases.length}</b><span>测试点</span></div>
      <div><b>${subtaskMode ? groups.length : '--'}</b><span>${subtaskMode ? '子任务' : '常规模式'}</span></div>
      <div><b>${formatScore(totalScore)}</b><span>总分</span></div>
      <div><b>${subtaskMode ? '开启' : '未开启'}</b><span>子任务模式</span></div>
    </div>
    <div class="case-mode-note">
      <span class="state-pill ${subtaskMode ? 'state-public' : 'state-none'}">${subtaskMode ? '子任务整组得分' : '普通测试点'}</span>
      <p class="muted">${subtaskMode ? '同一子任务内全部测试点通过时，才获得该子任务分值。测试点可拖进不同子任务并按位置重排。' : '每个测试点独立计分，可直接编辑分值、时间限制和内存限制。'}</p>
    </div>
    ${subtaskMode ? renderSubtaskCaseList(problemId, problem, cases) : renderPlainCaseList(problemId, problem, cases)}
    <div class="case-layout-actions"><button type="button" id="saveCaseLayoutBtn" class="primary">保存测试点配置</button><span id="caseLayoutMsg"></span></div>
  </div>`;
}

function manualCaseDraftItem(index, problem, score = 0) {
  return `<div class="case-manual-card">
    <div class="row space"><b>测试点 #${index}</b><button type="button" class="case-manual-remove">删除</button></div>
    <div class="grid two">
      <div><label>测试输入</label><textarea name="caseInput" class="case-text"></textarea></div>
      <div><label>测试输出</label><textarea name="caseOutput" class="case-text"></textarea></div>
    </div>
    <div class="grid three">
      <div><label>时间限制</label><input name="caseTimeLimit" inputmode="numeric" value="${esc(problem.timeLimit || 1000)}" /><span class="input-unit">ms</span></div>
      <div><label>内存限制</label><input name="caseMemoryLimit" inputmode="numeric" value="${esc(problem.memoryLimit || 128)}" /><span class="input-unit">MB</span></div>
      <div><label>分值</label><input name="caseScore" inputmode="decimal" value="${esc(score)}" /></div>
    </div>
  </div>`;
}

function renderCheckerPanel(problem) {
  const spjEnabled = problem.checkerMode === 'special_judge';
  const statusClassName = spjEnabled && problem.hasChecker ? 'state-public' : 'state-none';
  const statusText = spjEnabled ? (problem.hasChecker ? 'Special Judge 已启用' : 'Special Judge 待上传 checker.cpp') : '标准输出评测';
  return `<div class="card case-checker-card">
    <div class="row space case-checker-head">
      <div>
        <h2>评测器</h2>
        <p class="muted small">标准输出适合答案唯一的题目；Special Judge 适合多解、构造、交互式输出格式检查等场景。</p>
      </div>
      <span class="state-pill ${statusClassName}">${esc(statusText)}</span>
    </div>
    <div class="case-checker-body">
      <form id="checkerUploadForm" class="case-checker-upload">
        ${filePicker('checker', 'checkerFileName', problem.hasChecker ? '替换 checker.cpp' : '上传 checker.cpp', '.cpp')}
        <button type="submit" class="primary">保存评测器</button>
      </form>
      <button type="button" id="disableSpjBtn" class="danger" ${spjEnabled || problem.hasChecker ? '' : 'disabled'}>关闭 Special Judge</button>
      <span id="checkerMsg" class="small"></span>
    </div>
    <p class="muted small">checker.cpp 使用 testlib 风格：<code>registerTestlibCmd(argc, argv)</code> 后读取 <code>inf</code>、<code>ouf</code>、<code>ans</code>；LiteOJ 会按 input、用户输出、标准输出的顺序传参。</p>
  </div>`;
}

function bindCheckerPanel(problemId) {
  const form = qs('#checkerUploadForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const fd = new FormData(form);
      const res = await fetch(problemApi(problemId, '/checker'), { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      showInlineSuccess('#checkerMsg', 'checker.cpp 已保存，Special Judge 已启用');
      setTimeout(() => nav(`/admin/problem/${problemUrl(problemId)}/data`), 500);
    } catch (err) {
      showInlineError('#checkerMsg', err);
    }
  });
  qs('#disableSpjBtn')?.addEventListener('click', async () => {
    if (!confirm('确认关闭 Special Judge 并删除 checker.cpp？')) return;
    try {
      await api(problemApi(problemId, '/checker'), { method: 'DELETE' });
      showInlineSuccess('#checkerMsg', '已恢复标准输出评测');
      setTimeout(() => nav(`/admin/problem/${problemUrl(problemId)}/data`), 500);
    } catch (err) {
      showInlineError('#checkerMsg', err);
    }
  });
}

function renumberManualCaseCards() {
  qsa('.case-manual-card b').forEach((node, idx) => { node.textContent = `测试点 #${idx + 1}`; });
}

function renumberCaseRows() {
  qsa('#caseOverviewMount .case-data-row').forEach((row, idx) => {
    const index = qs('.case-index', row);
    if (index) index.textContent = `#${idx + 1}`;
  });
  qsa('#caseOverviewMount .case-subtask-card').forEach((card, idx) => {
    const name = `子任务${idx + 1}`;
    card.dataset.subtask = name;
    const title = qs('.case-subtask-title', card);
    if (title) title.textContent = name;
    qs('.case-remove-subtask', card)?.toggleAttribute('disabled', qsa('#caseOverviewMount .case-subtask-card').length <= 1);
  });
}

function updateCaseSelectionHeaders() {
  qsa('#caseOverviewMount .case-subtask-card, #caseOverviewMount .case-plain-list').forEach((scope) => {
    const selectAll = qs('.case-select-all', scope);
    if (!selectAll) return;
    const boxes = qsa('.case-select input', scope);
    const checked = boxes.filter((item) => item.checked).length;
    selectAll.checked = boxes.length > 0 && checked === boxes.length;
    selectAll.indeterminate = checked > 0 && checked < boxes.length;
  });
}

function caseRowAfter(container, y) {
  return qsa('.case-data-row:not(.dragging)', container).reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

let activeCaseDragRows = [];

function bindCaseDragAndDrop(root = document) {
  qsa('.case-data-row', root).forEach((row) => {
    if (row.dataset.dragBound === '1') return;
    row.dataset.dragBound = '1';
    const checkbox = qs('.case-select input', row);
    checkbox?.addEventListener('change', () => {
      row.classList.toggle('selected', checkbox.checked);
      updateCaseSelectionHeaders();
    });
    row.classList.toggle('selected', Boolean(checkbox?.checked));
    row.addEventListener('dragstart', (event) => {
      const selected = qsa('#caseOverviewMount .case-data-row')
        .filter((item) => qs('.case-select input', item)?.checked);
      activeCaseDragRows = selected.includes(row) ? selected : [row];
      activeCaseDragRows.forEach((item) => item.classList.add('dragging'));
      event.dataTransfer?.setData('text/plain', row.dataset.caseId || '');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      activeCaseDragRows.forEach((item) => item.classList.remove('dragging'));
      activeCaseDragRows = [];
      renumberCaseRows();
      updateCaseSelectionHeaders();
    });
  });
  qsa('.case-drop-list', root).forEach((list) => {
    if (list.dataset.dropBound === '1') return;
    list.dataset.dropBound = '1';
    list.addEventListener('dragover', (event) => {
      event.preventDefault();
      const moving = activeCaseDragRows.length ? activeCaseDragRows : qsa('.case-data-row.dragging');
      if (!moving.length) return;
      const after = caseRowAfter(list, event.clientY);
      const fragment = document.createDocumentFragment();
      moving.forEach((row) => fragment.appendChild(row));
      if (after) list.insertBefore(fragment, after);
      else list.appendChild(fragment);
    });
  });
}

function collectCaseLayout(subtaskMode) {
  if (subtaskMode) {
    const items = [];
    let sort = 1;
    qsa('#caseOverviewMount .case-subtask-card').forEach((card) => {
      const subtask = card.dataset.subtask || '';
      const groupScore = Number(qs('.case-subtask-score', card)?.value) || 0;
      qsa('.case-data-row', card).forEach((row, idx) => {
        items.push({
          id: Number(row.dataset.caseId),
          subtask,
          score: idx === 0 ? groupScore : 0,
          sort,
          timeLimit: Number(qs('.case-time-input', row)?.value) || 0,
          memoryLimit: Number(qs('.case-memory-input', row)?.value) || 0,
        });
        sort += 1;
      });
    });
    return items;
  }
  return qsa('#caseOverviewMount .case-data-row').map((row, idx) => ({
    id: Number(row.dataset.caseId),
    subtask: '',
    score: Number(qs('.case-score-input', row)?.value) || 0,
    sort: idx + 1,
    timeLimit: Number(qs('.case-time-input', row)?.value) || 0,
    memoryLimit: Number(qs('.case-memory-input', row)?.value) || 0,
  }));
}

function bindCaseOverviewActions(problemId) {
  bindCaseDragAndDrop(qs('#caseOverviewMount') || document);
  qsa('.case-select-all').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
      const scope = input.closest('.case-subtask-card') || input.closest('.case-plain-list') || qs('#caseOverviewMount');
      qsa('.case-data-row', scope).forEach((row) => {
        const checkbox = qs('.case-select input', row);
        if (checkbox) checkbox.checked = input.checked;
        row.classList.toggle('selected', input.checked);
      });
      updateCaseSelectionHeaders();
    });
  });
  qsa('.case-edit-btn').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => openCaseEditor(btn.dataset.problemId || problemId, btn.dataset.caseId));
  });
  qsa('.case-delete-btn').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => deleteCase(btn.dataset.problemId || problemId, btn.dataset.caseId));
  });
  updateCaseSelectionHeaders();
}

function bindCaseManagerInteractions(problemId, problem, cases, initialSubtaskMode) {
  let subtaskMode = Boolean(initialSubtaskMode);
  const renderOverview = () => {
    qs('#caseOverviewMount').innerHTML = renderCaseOverview(problemId, problem, cases, subtaskMode);
    bindCaseOverviewActions(problemId);
    bindSubtaskControls();
  };
  const bindSubtaskControls = () => {
    const addBtn = qs('#addSubtaskBtn');
    if (addBtn && addBtn.dataset.bound !== '1') addBtn.addEventListener('click', () => {
      const list = qs('#caseSubtaskList');
      if (!list) return;
      const next = qsa('.case-subtask-card', list).length + 1;
      list.insertAdjacentHTML('beforeend', renderSubtaskGroup(problemId, problem, { name: `子任务${next}`, score: 0, cases: [] }, next - 1, qsa('.case-data-row').length, next));
      renumberCaseRows();
      bindCaseOverviewActions(problemId);
      bindSubtaskControls();
    });
    if (addBtn) addBtn.dataset.bound = '1';
    qsa('.case-remove-subtask').forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const cards = qsa('#caseOverviewMount .case-subtask-card');
        if (cards.length <= 1) return;
        const card = btn.closest('.case-subtask-card');
        const targetCard = cards.find((item) => item !== card) || cards[0];
        const targetList = qs('.case-drop-list', targetCard);
        if (card && targetList) qsa('.case-data-row', card).forEach((row) => targetList.appendChild(row));
        card?.remove();
        renumberCaseRows();
        bindCaseOverviewActions(problemId);
        bindSubtaskControls();
      });
    });
    qsa('.case-subtask-fill-time').forEach((input) => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('change', () => {
        if (!input.value) return;
        qsa('.case-time-input', input.closest('.case-subtask-card')).forEach((x) => { x.value = input.value; });
      });
    });
    qsa('.case-subtask-fill-memory').forEach((input) => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('change', () => {
        if (!input.value) return;
        qsa('.case-memory-input', input.closest('.case-subtask-card')).forEach((x) => { x.value = input.value; });
      });
    });
    const saveBtn = qs('#saveCaseLayoutBtn');
    if (saveBtn && saveBtn.dataset.bound !== '1') saveBtn.addEventListener('click', async () => {
      try {
        const body = { cases: collectCaseLayout(subtaskMode) };
        await api(problemApi(problemId, '/cases/bulk'), { method: 'PUT', body });
        showInlineSuccess('#caseLayoutMsg', '测试点配置已保存');
        setTimeout(() => nav(`/admin/problem/${problemUrl(problemId)}/data`), 350);
      } catch (err) {
        showInlineError('#caseLayoutMsg', err);
      }
    });
    if (saveBtn) saveBtn.dataset.bound = '1';
  };

  qsa('.case-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      qsa('.case-mode-btn').forEach((x) => x.classList.toggle('active', x === btn));
      qs('#zipCaseManagePanel').classList.toggle('hidden', mode !== 'zip');
      qs('#manualCaseManagePanel').classList.toggle('hidden', mode !== 'manual');
    });
  });
  const subtaskToggle = qs('#caseSubtaskMode');
  subtaskToggle?.addEventListener('change', () => {
    subtaskMode = Boolean(subtaskToggle.checked);
    renderOverview();
  });
  const fileInput = qs('#caseZipForm input[type="file"]');
  fileInput?.addEventListener('change', () => {
    const box = qs('#caseZipNameBox');
    if (box) box.value = fileInput.files?.[0]?.name || '';
  });
  qs('#addManualCaseBtn')?.addEventListener('click', () => {
    const list = qs('#manualCaseList');
    list?.insertAdjacentHTML('beforeend', manualCaseDraftItem(qsa('.case-manual-card', list).length + 1, problem, 0));
    renumberManualCaseCards();
  });
  qs('#manualCasesForm')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.case-manual-remove');
    if (!btn) return;
    const cards = qsa('.case-manual-card');
    if (cards.length <= 1) return;
    btn.closest('.case-manual-card')?.remove();
    renumberManualCaseCards();
  });
  qs('#manualCasesForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const startSort = cases.length + 1;
      const drafts = qsa('.case-manual-card').map((card, idx) => ({
        input: qs('[name="caseInput"]', card)?.value || '',
        output: qs('[name="caseOutput"]', card)?.value || '',
        score: Number(qs('[name="caseScore"]', card)?.value) || 0,
        timeLimit: Number(qs('[name="caseTimeLimit"]', card)?.value) || 0,
        memoryLimit: Number(qs('[name="caseMemoryLimit"]', card)?.value) || 0,
        sort: startSort + idx,
      })).filter((item) => item.input || item.output);
      for (const item of drafts) await api(problemApi(problemId, '/cases'), { method: 'POST', body: item });
      showInlineSuccess('#caseMsg', `已新增 ${drafts.length} 组测试点`);
      setTimeout(() => nav(`/admin/problem/${problemUrl(problemId)}/data`), 350);
    } catch (err) {
      showInlineError('#caseMsg', err);
    }
  });
  bindCaseOverviewActions(problemId);
  bindSubtaskControls();
}

async function renderSubmissions() {
  setImmersive(false);
  const data = await api('/api/submissions');
  app.innerHTML = `<div class="card table-card"><table>
    <thead><tr><th>ID</th><th>题目</th><th>用户</th><th>语言</th><th>状态</th><th>分数</th><th>时间</th><th>提交时间</th></tr></thead>
    <tbody>${data.submissions.map((s) => `<tr>
      <td>${routeAnchor(`/submission/${s.id}`, `#${s.id}`)}</td>
      <td>${esc(s.problemId)} ${esc(s.problemTitle)}</td>
      <td>${esc(s.username)}</td>
      <td>${languageLabel(s.language)}</td>
      <td><span class="status ${statusClass(s.status)}">${esc(s.status)}</span></td>
      <td>${s.score}</td><td>${s.timeMs} ms</td><td>${esc(formatUtc8Time(s.createdAt))}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

async function renderSubmission(id) {
  setImmersive(false);
  const data = await api(`/api/submissions/${id}`);
  const s = data.submission;
  app.innerHTML = `
    <div class="card">
      <div class="row space"><h1>提交 #${s.id}</h1><button onclick="rejudge(${s.id})">重新评测</button></div>
      <p>题目：${esc(s.problemId)} ${esc(s.problemTitle)}　用户：${esc(s.username)}　语言：${languageLabel(s.language)}　O2优化：${s.optimize ? '开启' : '关闭'}</p>
      <p>状态：<span class="status ${statusClass(s.status)}">${esc(s.status)}</span>　分数：${s.score}　时间：${s.timeMs} ms　提交时间：${esc(formatUtc8Time(s.createdAt))}</p>
      ${s.message ? `<pre>${esc(s.message)}</pre>` : ''}
      <h3>测试点详情</h3>
      ${renderDetails(s.details || [])}
      <h3>代码</h3><pre>${esc(s.code)}</pre>
    </div>`;
  if (['Waiting', 'Judging'].includes(s.status)) scheduleSubmissionPoll(id);
}
window.rejudge = async (id) => {
  await api(`/api/submissions/${id}/rejudge`, { method: 'POST', body: {} });
  if (location.pathname === `/submission/${id}`) renderSubmission(id);
};

function renderDetails(details) {
  if (!details.length) return '<p class="muted">暂无测试点详情。</p>';
  return `<table><thead><tr><th>#</th><th>子任务</th><th>状态</th><th>分数</th><th>时间</th><th>信息</th></tr></thead><tbody>${details.map((d) => `
    <tr><td>${d.sort}</td><td>${d.subtask ? esc(d.subtask) : '<span class="muted">--</span>'}</td><td><span class="status ${statusClass(d.status)}">${esc(d.status)}</span></td><td>${d.score}</td><td>${d.timeMs} ms</td><td>${esc(d.message || '')}</td></tr>`).join('')}</tbody></table>`;
}



function prelimItemTitle(item) {
  if (item.section === 'single_choice') return `${item.year} ${item.groupName} 第 ${item.firstQuestionNumber || item.number} 题`;
  return `${item.year} ${item.groupName} ${prelimSectionLabel(item.section)}（${item.groupNo || item.number}）`;
}
function prelimItemStatusBadge(item) {
  const total = Number(item.questionCount || 0);
  const done = Number(item.userAttemptedCount || 0);
  const correct = Number(item.userCorrectCount || 0);
  const wrong = Number(item.userWrongCount || 0);
  if (!done) return '<span class="state-pill state-none">未做</span>';
  if (total && correct === total) return '<span class="state-pill state-ac">正确</span>';
  if (wrong) return '<span class="state-pill state-hidden">错误</span>';
  return '<span class="state-pill state-public">进行中</span>';
}
function prelimItemAccuracy(item) {
  if (!item.attemptCount) return '--';
  return `${Math.round((item.correctCount || 0) * 10000 / item.attemptCount) / 100}%`;
}
function prelimItemRow(item) {
  return `<tr>
    <td>${prelimItemStatusBadge(item)}</td>
    <td class="prelim-title-cell">${routeAnchor(`/prelim/item/${item.id}`, prelimItemTitle(item), 'problem-title-link prelim-title-link')}</td>
    <td class="prelim-type-cell"><span class="prelim-type-chip">${esc(prelimSectionLabel(item.section))}</span></td>
    <td>${prelimTags(item)}</td>
    <td>${formatScore(item.score)}</td>
    <td>${prelimItemAccuracy(item)}</td>
  </tr>`;
}
function prelimSubQuestionBlock(q, readonly = false) {
  const recentAnswer = q.userAnswer ? `最近作答：${esc(storedAnswerText(q.userAnswer))}` : '';
  return `<div class="prelim-subquestion" data-question-id="${q.id}">
    ${recentAnswer ? `<div class="muted small subquestion-meta">${recentAnswer}</div>` : ''}
    ${numberedStem(q, 'prelim-stem')}
    ${renderQuestionOptions(q, 'button', readonly)}
    <div class="prelim-question-result"></div>
  </div>`;
}
function storedAnswerText(answer) {
  if (answer === 'T') return '√';
  if (answer === 'F') return '×';
  return answer || '';
}


async function renderAdmin() {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const stats = await api('/api/admin/stats');
  app.innerHTML = `<div class="admin-clean-page">
    <div class="admin-stat-strip">
      <div><b>${stats.users}</b><span>用户</span></div>
      <div><b>${stats.problems}</b><span>编程题</span></div>
      <div><b>${stats.prelimQuestions || 0}</b><span>初赛小题</span></div>
      <div><b>${stats.submissions}</b><span>提交</span></div>
    </div>
    <div class="admin-action-grid">
      <div class="admin-action-card">
        <h2>编程题库</h2>
        <div class="admin-action-buttons">${routeLink('/admin/problems', '管理题目', 'btn primary')}${routeLink('/admin/problem/new', '新增题目', 'btn')}</div>
      </div>
      <div class="admin-action-card">
        <h2>初赛题库</h2>
        <div class="admin-action-buttons">${routeLink('/admin/prelim', '管理试卷', 'btn primary')}${routeLink('/admin/prelim/import', '导入试卷', 'btn')}</div>
      </div>
      <div class="admin-action-card">
        <h2>用户管理</h2>
        <div class="admin-action-buttons">${routeLink('/admin/users', '管理用户', 'btn primary')}</div>
      </div>
    </div>
  </div>`;
}

async function renderUserAdmin() {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const data = await api('/api/admin/users');
  app.innerHTML = `<div class="row space page-head"><div><h1>用户管理</h1></div><button onclick="nav('/admin')">返回后台</button></div>
  <div class="card table-card"><table><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead><tbody>${data.users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.createdAt)}</td><td class="table-actions-cell"><div class="table-action-row">${u.id === currentUser.id ? '<span class="muted">当前用户</span>' : `<button type="button" onclick="setUserRole(${u.id}, '${u.role === 'admin' ? 'user' : 'admin'}')">设为${u.role === 'admin' ? '普通用户' : '管理员'}</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
}
window.setUserRole = async (id, role) => runUiAction(async () => {
  await api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } });
  renderUserAdmin();
});

async function renderProblemManage() {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const params = new URLSearchParams(location.search);
  const keys = ['keyword','status','difficulty','tag','sort'];
  const query = selectedFilterParams(params, keys);
  query.set('manage', '1');
  const [data, facets] = await Promise.all([
    api('/api/problems' + (query.toString() ? `?${query}` : '')),
    api('/api/problems/facets?all=1'),
  ]);
  app.innerHTML = `<div class="manage-layout-head"><div><h1>编程题库管理</h1></div><div class="row button-row">${routeLink('/admin/problem/new', '新增题目', 'btn primary')}${routeLink('/admin', '返回后台', 'btn')}</div></div>
  <div class="card filter-panel-card"><form id="problemManageFilter" class="filter-panel-grid manage-problem-filter-grid">
    <label class="filter-keyword">关键词<input name="keyword" placeholder="题号 / 标题 / 题面" value="${esc(params.get('keyword') || '')}" /></label>
    <label class="filter-status">状态<select name="status"><option value="">全部</option><option value="public" ${params.get('status') === 'public' ? 'selected' : ''}>公开</option><option value="hidden" ${params.get('status') === 'hidden' ? 'selected' : ''}>隐藏</option></select></label>
    <label class="filter-difficulty">难度<select name="difficulty"><option value="">全部难度</option>${difficultyOptions(params.get('difficulty') || '')}</select></label>
    <label>知识点<select name="tag">${optionList(facets.tags || [], params.get('tag') || '', '全部知识点')}</select></label>
    <label>排序<select name="sort">${['default','recent','title','difficulty','acceptance'].map((x) => `<option value="${x}" ${params.get('sort') === x ? 'selected' : ''}>${sortText(x)}</option>`).join('')}</select></label>
    <div class="filter-actions"><button class="primary">筛选</button><button type="button" class="reset-btn" onclick="nav('/admin/problems')">重置</button></div>
  </form></div>
  <div class="card batch-bar"><label class="checkbox-line"><input type="checkbox" id="checkAllProblems" /> 全选</label><button onclick="batchProblemManage('publish')">批量公开</button><button onclick="batchProblemManage('hide')">批量隐藏</button><button class="danger" onclick="batchProblemManage('delete')">批量删除</button></div>
  <div class="card table-card problemset-table"><table><thead><tr><th></th><th>状态</th><th>标题</th><th>知识点</th><th>难度</th><th>通过率</th><th>操作</th></tr></thead><tbody>${data.problems.length ? data.problems.map(manageProblemRow).join('') : '<tr><td colspan="7" class="muted">暂无题目</td></tr>'}</tbody></table><div class="table-footer">共 ${data.problems.length} 条</div></div>`;
  qs('#problemManageFilter').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const q = new URLSearchParams();
    for (const k of keys) if (f[k]) q.set(k, f[k]);
    nav('/admin/problems' + (q.toString() ? `?${q}` : ''));
  };
  qs('#checkAllProblems')?.addEventListener('change', (e) => qsa('.problem-check').forEach((x) => { x.checked = e.target.checked; }));
  bindProblemManageActions();
}
function selectedProblemIds() { return qsa('.problem-check:checked').map((x) => x.value); }
window.batchProblemManage = async (action) => runUiAction(async () => {
  const ids = selectedProblemIds();
  if (!ids.length) return alert('请先选择题目');
  if (action === 'delete' && !confirm(`确认删除 ${ids.length} 道题？`)) return null;
  await api('/api/problems/batch', { method: 'POST', body: { ids, action } });
  renderProblemManage();
});
function bindProblemManageActions() {
  const table = qs('.problemset-table');
  if (!table || table.dataset.actionsBound === '1') return;
  table.dataset.actionsBound = '1';
  table.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-problem-action]');
    if (!btn || !table.contains(btn)) return;
    event.preventDefault();
    const id = btn.dataset.id;
    const action = btn.dataset.problemAction;
    if (!id) return alert('题号丢失，请刷新后重试');
    if (action === 'edit') return editProblem(id);
    if (action === 'data') return openProblemData(id);
    if (action === 'toggle') return toggleProblem(id, btn.dataset.public === '1');
    if (action === 'clone') return cloneProblem(id);
    if (action === 'delete') return deleteProblem(id);
  });
}

async function renderPrelimList() {
  setImmersive(false);
  const params = new URLSearchParams(location.search);
  const keys = ['keyword','year','groupName','section','tag','status'];
  const query = selectedFilterParams(params, keys);
  const [data, facets] = await Promise.all([
    api('/api/prelim/items' + (query.toString() ? `?${query}` : '')),
    api('/api/prelim/facets'),
  ]);
  app.innerHTML = `
    <div class="card filter-panel-card prelim-filter-card">
      <form id="prelimFilter" class="filter-panel-grid prelim-filter-grid compact-prelim-filter">
        <label class="filter-keyword prelim-keyword">关键词<input name="keyword" placeholder="题干 / 代码" value="${esc(params.get('keyword') || '')}" /></label>
        <label>年份<select name="year">${optionList(facets.years || [], params.get('year') || '', '全部年份')}</select></label>
        <label>组别<select name="groupName">${optionList(facets.groups || [], params.get('groupName') || '', '全部组别')}</select></label>
        <label>题型<select name="section"><option value="">全部题型</option>${Object.entries(PRELIM_SECTION_LABELS).map(([k, v]) => `<option value="${k}" ${params.get('section') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>知识点<select name="tag">${optionList(facets.tags || [], params.get('tag') || '', '全部知识点')}</select></label>
        <label>状态<select name="status"><option value="">全部状态</option><option value="todo" ${params.get('status') === 'todo' ? 'selected' : ''}>未做</option><option value="partial" ${params.get('status') === 'partial' ? 'selected' : ''}>进行中</option><option value="correct" ${params.get('status') === 'correct' ? 'selected' : ''}>正确</option><option value="wrong" ${params.get('status') === 'wrong' ? 'selected' : ''}>错误</option></select></label>
        <div class="filter-actions"><button class="primary">筛选</button><button type="button" class="reset-btn" onclick="nav('/prelim')">重置</button></div>
      </form>
    </div>
    <div class="card table-card problemset-table prelim-table">
      <table>
        <thead><tr><th>状态</th><th>题目</th><th>题型</th><th>知识点</th><th>分值</th><th>正确率</th></tr></thead>
        <tbody>${(data.items || []).length ? data.items.map(prelimItemRow).join('') : `<tr><td colspan="6" class="muted">暂无初赛题目</td></tr>`}</tbody>
      </table>
      <div class="table-footer">共 ${(data.items || []).length} 条</div>
    </div>`;
  qs('#prelimFilter').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const q = new URLSearchParams();
    for (const k of keys) if (f[k]) q.set(k, f[k]);
    nav('/prelim' + (q.toString() ? `?${q}` : ''));
  };
}

async function renderPrelimItem(id) {
  setImmersive(false);
  const data = await api(`/api/prelim/items/${id}`);
  const item = data.item;
  app.innerHTML = `
    <div class="card prelim-question-card prelim-item-card">
      <div class="row space">
        <div>
          <h1>${esc(prelimItemTitle(item))}</h1>
          <p class="muted prelim-item-meta">${esc(prelimSectionLabel(item.section))}　${formatScore(item.score)} 分</p>
        </div>
        <button onclick="nav('/prelim')">返回初赛题库</button>
      </div>
      <p>${prelimTags(item)}</p>
      ${shouldShowPrelimGroupStem(item) ? `<div class="markdown prelim-group-stem">${renderMarkdown(item.stem)}</div>` : ''}
      ${item.code ? `<h2>公共代码</h2>${renderCodeBlock(item.code, 'cpp')}` : ''}
      <div id="prelimSubquestions">${(item.questions || []).map((q) => prelimSubQuestionBlock(q)).join('')}</div>
    </div>`;
  bindPrelimAnswerEvents(qs('#prelimSubquestions'));
}

function bindPrelimAnswerEvents(root) {
  root?.addEventListener('click', async (event) => {
    const btn = event.target.closest('.prelim-option');
    if (!btn || btn.disabled) return;
    const block = btn.closest('.prelim-subquestion');
    const questionId = block?.dataset.questionId;
    if (!questionId) return;
    try {
      qsa('.prelim-option', block).forEach((x) => { x.disabled = true; x.classList.remove('selected'); });
      btn.classList.add('selected');
      const result = await api(`/api/prelim/questions/${questionId}/check`, { method: 'POST', body: { answer: btn.dataset.answer } });
      qsa('.prelim-option', block).forEach((x) => {
        if (x.dataset.answer === result.answer) x.classList.add('correct');
        if (x.dataset.answer === result.selectedAnswer && !result.correct) x.classList.add('wrong');
      });
      qs('.prelim-question-result', block).innerHTML = `<div class="prelim-result ${result.correct ? 'success' : 'error'}"><b>${result.correct ? '回答正确' : '回答错误'}</b>　你的答案：${esc(result.selectedAnswerLabel)}　正确答案：${esc(result.answerLabel)}</div>
      <div class="nested-card answer-panel"><h3>答案解析</h3><div class="markdown">${renderMarkdown(result.explanation || '暂无解析')}</div><p>${prelimTagWeights(result.tags || [])}</p></div>`;
    } catch (err) {
      qsa('.prelim-option', block).forEach((x) => { x.disabled = false; });
      qs('.prelim-question-result', block).innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  });
}

function paperQuestionBlock(item) {
  if (item.section === 'single_choice') {
    const q = (item.questions || [])[0] || item;
    return `<div class="paper-question-item">
      ${numberedStem(q, 'small-stem')}
      <div class="prelim-paper-options">${(q.options || []).map((o) => `<span class="paper-option"><b>${esc(o.key === 'T' ? '√' : o.key === 'F' ? '×' : o.key)}.</b> ${renderInlineMarkdown(o.text || '')}</span>`).join('')}</div>
      <div class="paper-question-actions"><button type="button" onclick="nav('/prelim/item/${item.id}')">练习本题</button></div>
    </div>`;
  }
  return `<div class="paper-question-item">
    <div class="row space">${routeAnchor(`/prelim/item/${item.id}`, groupShortTitle(item), 'problem-title-link')}<span class="muted small">${formatScore(item.score)} 分 / ${item.questionCount} 个小题</span></div>
    ${shouldShowPrelimGroupStem(item) ? `<div class="markdown small-stem">${renderMarkdown(item.stem)}</div>` : ''}
    ${item.code ? renderCodeBlock(item.code, 'cpp') : ''}
    ${(item.questions || []).map((q) => `<div class="paper-subq">${numberedStem(q, 'small-stem')}<div class="prelim-paper-options">${(q.options || []).map((o) => `<span class="paper-option"><b>${esc(o.key === 'T' ? '√' : o.key === 'F' ? '×' : o.key)}.</b> ${renderInlineMarkdown(o.text || '')}</span>`).join('')}</div></div>`).join('')}
  </div>`;
}
function paperSectionBlock(section, items) {
  if (!items.length) return '';
  return `<section class="paper-section"><h2>${esc(sectionTitleFromGroups(section, items))}</h2>${items.map(paperQuestionBlock).join('')}</section>`;
}
function renderPaperSections(items = []) {
  return PRELIM_SECTION_ORDER.map((section) => paperSectionBlock(section, items.filter((q) => q.section === section))).join('');
}

async function renderPrelimPaper(id) {
  setImmersive(false);
  const data = await api(`/api/prelim/papers/${id}`);
  const items = data.groups || [];
  app.innerHTML = `<div class="card">
    <div class="row space"><div><h1>${esc(data.paper.title)}</h1><p class="muted">${data.paper.year} ${data.paper.groupName} ${data.paper.roundName}　共 ${items.length} 道整题</p></div><button onclick="nav('/prelim')">返回初赛题库</button></div>
    ${renderPaperSections(items)}
  </div>`;
}

async function renderPrelimAdmin() {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const [papers, items, questions] = await Promise.all([
    api('/api/prelim/papers'),
    api('/api/prelim/items?all=1'),
    api('/api/prelim/questions?all=1'),
  ]);
  app.innerHTML = `<div class="manage-layout-head admin-clean-head">
    <div><h1>初赛题库管理</h1></div>
    <div class="row button-row"><button class="primary" onclick="nav('/admin/prelim/import')">导入试卷</button><button onclick="nav('/admin')">返回后台</button></div>
  </div>
  <div class="admin-stat-strip prelim-admin-stats">
    <div><b>${papers.papers.length}</b><span>试卷</span></div>
    <div><b>${items.items.length}</b><span>整题</span></div>
    <div><b>${questions.questions.length}</b><span>小题</span></div>
  </div>
  <div class="card table-card"><div class="table-headline"><h2>试卷列表</h2></div><table><thead><tr><th>年份</th><th>组别</th><th>标题</th><th>题量</th><th>操作</th></tr></thead><tbody>${papers.papers.map((p) => `<tr><td>${p.year}</td><td>${esc(p.groupName)}</td><td>${esc(p.title)}</td><td>${p.groupCount || 0} 整题 / ${p.questionCount || 0} 小题</td><td class="table-actions-cell"><div class="table-action-row"><button type="button" onclick="nav('/prelim/paper/${p.id}')">查看</button><button type="button" class="danger" onclick="deletePrelimPaper(${p.id})">删除</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无试卷</td></tr>'}</tbody></table></div>
  <div class="card table-card"><div class="table-headline"><h2>整题概览</h2><span class="muted small">最多显示前 200 条</span></div><table><thead><tr><th>题目</th><th>题型</th><th>知识点</th><th>小题数</th><th>正确率</th></tr></thead><tbody>${items.items.slice(0, 200).map((item) => `<tr><td>${routeAnchor(`/prelim/item/${item.id}`, prelimItemTitle(item))}</td><td>${esc(prelimSectionLabel(item.section))}</td><td>${prelimTags(item)}</td><td>${item.questionCount}</td><td>${prelimItemAccuracy(item)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无题目</td></tr>'}</tbody></table></div>`;
}

async function renderPrelimImport() {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  app.innerHTML = `<div class="editor-layout-page rich-editor-page">
    <div class="edit-title-wrap"><button class="back-btn" onclick="nav('/admin/prelim')">←</button><h1>导入初赛试卷</h1><span class="edit-tag">CSP 初赛</span></div>
    <form id="prelimImportForm" class="editor-layout-form">
      <section class="editor-panel">
        <div class="grid three">
          <div>${requiredLabel('年份')}<input name="year" value="2025" /></div>
          <div>${requiredLabel('组别')}<select name="groupName"><option value="CSP-J">CSP-J</option><option value="CSP-S">CSP-S</option></select></div>
          <div>${requiredLabel('轮次')}<input name="roundName" value="初赛" /></div>
        </div>
        <label>试卷标题</label><input name="title" value="2025 CSP-J 初赛真题" />
        <div class="grid two">
          <div><label class="required-label">试卷 Markdown</label>${filePicker('paper', 'prelimPaperFile', '选择试卷 md', '.md,.markdown,.txt')}</div>
          <div><label class="required-label">答案解析 Markdown</label>${filePicker('solution', 'prelimSolutionFile', '选择解析 md', '.md,.markdown,.txt')}</div>
        </div>
        <label class="checkbox-line"><input type="checkbox" name="replace" checked /> 覆盖同年份同组别试卷</label>
        <div id="prelimImportMsg"></div>
        <div class="editor-footer"><button type="button" onclick="previewPrelimImport()">解析预览</button><button class="primary">确认导入</button></div>
      </section>
    </form>
  </div>`;
  bindFileNameDisplays(qs('#prelimImportForm'));
  qs('#prelimImportForm').onsubmit = async (e) => {
    e.preventDefault();
    await submitPrelimImport(false);
  };
}

async function submitPrelimImport(preview) {
  const form = qs('#prelimImportForm');
  const fd = new FormData(form);
  fd.set('preview', preview ? '1' : '0');
  fd.set('replace', form.replace.checked ? '1' : '0');
  const res = await fetch('/api/prelim/import-md', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  const box = qs('#prelimImportMsg');
  if (preview) {
    const p = data.preview;
    box.innerHTML = `<div class="success">解析成功：${p.itemCount} 道整题，${p.questionCount} 个小题。缺失答案：${p.missingAnswerNumbers.join(', ') || '无'}</div><pre>${esc(JSON.stringify(p.previewItems, null, 2))}</pre>`;
  } else {
    box.innerHTML = `<div class="success">导入成功：${data.itemCount} 道整题，${data.questionCount} 个小题。</div>`;
    setTimeout(() => nav('/admin/prelim'), 700);
  }
}
window.previewPrelimImport = () => runUiAction(() => submitPrelimImport(true));
window.deletePrelimPaper = async (id) => runUiAction(async () => {
  if (!confirm('确认删除这套初赛试卷？')) return null;
  await api(`/api/prelim/papers/${id}`, { method: 'DELETE' });
  nav('/admin/prelim');
});


function analyticsPercent(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 10) / 10}%`;
}
function analyticsScore(value) { return formatScore(value); }
function analyticsSelectedYears(params) {
  const fromQuery = String(params.get('years') || params.get('year') || '')
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
  return [...new Set(fromQuery)];
}
function analyticsYearDropdown(years = [], selected = []) {
  const selectedSet = new Set(selected.map((x) => String(x)));
  const label = selected.length ? `已选择 ${selected.length} 年` : '请选择年份';
  return `<details class="analytics-year-dropdown">
    <summary><span>${esc(label)}</span>${selected.length ? `<b>${selected.map((y) => esc(y)).join('、')}</b>` : ''}</summary>
    <div class="analytics-year-menu">${years.map((year) => `<label class="analytics-year-option"><input type="checkbox" name="years" value="${esc(year)}" ${selectedSet.has(String(year)) ? 'checked' : ''} /> <span>${esc(year)}</span></label>`).join('')}</div>
  </details>`;
}
function analyticsGroupSelect(groups = [], selected = '') {
  const list = ['CSP-J', 'CSP-S'];
  const valid = new Set([...(groups || []), ...list]);
  return `<select name="groupName" class="analytics-group-select"><option value="" ${selected ? '' : 'selected'}>请选择组别</option>${list.filter((g) => valid.has(g)).map((g) => `<option value="${esc(g)}" ${selected === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
}
function analyticsCountBarChart(counts = []) {
  const shown = counts;
  if (!shown.length) return '<p class="muted">暂无可统计的考点数据。</p>';
  const max = Math.max(...shown.map((x) => Number(x.count) || 0), 1);
  return `<div class="analytics-count-chart">${shown.map((item, index) => `<div class="analytics-count-row">
    <div class="analytics-count-label"><span>${esc(index + 1)}. ${esc(item.tag)}</span><b>${esc(item.count)} 次</b></div>
    <div class="analytics-count-track"><i style="width:${Math.max(5, Math.min(100, (Number(item.count) || 0) / max * 100))}%"></i></div>
  </div>`).join('')}</div>`;
}
function analyticsDonutData(items = []) {
  return (items || [])
    .filter((item) => Number(item.score) > 0)
    .map((item) => ({
      tag: item.tag,
      score: Number(item.score || 0),
      percent: Number(item.percent || 0),
    }));
}
function analyticsDonutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const polar = (radius, angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const startOuter = polar(outerR, startAngle);
  const endOuter = polar(outerR, endAngle);
  const startInner = polar(innerR, startAngle);
  const endInner = polar(innerR, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${startOuter.x.toFixed(3)} ${startOuter.y.toFixed(3)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x.toFixed(3)} ${endOuter.y.toFixed(3)}`,
    `L ${endInner.x.toFixed(3)} ${endInner.y.toFixed(3)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${startInner.x.toFixed(3)} ${startInner.y.toFixed(3)}`,
    'Z',
  ].join(' ');
}
function analyticsDonutChart(items = []) {
  const data = analyticsDonutData(items);
  if (!data.length) return '<p class="muted">暂无可统计的加权分值数据。</p>';
  const colors = ['#2563eb', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b', '#ec4899', '#84cc16', '#0ea5e9', '#cbd5e1'];
  const totalScore = data.reduce((sum, item) => sum + Number(item.score || 0), 0) || 1;
  let angle = 0;
  const paths = data.map((item, i) => {
    const ratio = Math.max(0, Number(item.score || 0)) / totalScore;
    const start = angle;
    const end = i === data.length - 1 ? 360 : Math.min(360, angle + ratio * 360);
    angle = end;
    const path = analyticsDonutPath(120, 120, 108, 62, start, Math.min(end, start + 359.99));
    return `<path class="analytics-donut-segment" d="${path}" fill="${colors[i % colors.length]}" fill-rule="evenodd" data-tag="${attrEsc(item.tag)}" data-score="${attrEsc(analyticsScore(item.score))}" data-percent="${attrEsc(analyticsPercent(item.percent))}"></path>`;
  });
  return `<div class="analytics-donut-wrap">
    <div class="analytics-donut-shell">
      <svg class="analytics-donut-svg" viewBox="0 0 240 240" role="img" aria-label="考点加权分值中空饼图">${paths.join('')}</svg>
      <div id="analyticsDonutTooltip" class="analytics-donut-tooltip" aria-hidden="true"></div>
    </div>
  </div>`;
}
function analyticsYearCompare(stats) {
  const byYear = stats.byYear || [];
  const tags = (stats.items || []).map((x) => x.tag);
  if (!byYear.length || !tags.length) return '<p class="muted">暂无可统计的年份对比数据。</p>';
  return `<div class="analytics-compare-table"><table><thead><tr><th>考点</th>${byYear.map((year) => `<th>${esc(year.year)}</th>`).join('')}<th>总分</th></tr></thead><tbody>${tags.map((tag) => {
    const values = byYear.map((year) => year.tags.find((x) => x.tag === tag) || { score: 0, percent: 0 });
    const sum = values.reduce((s, x) => s + Number(x.score || 0), 0);
    return `<tr><td><b>${esc(tag)}</b></td>${values.map((v) => `<td><div class="year-score">${analyticsScore(v.score)} 分</div></td>`).join('')}<td><b>${analyticsScore(sum)} 分</b></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function bindAnalyticsYearDropdown() {
  if (window.__liteojAnalyticsYearDropdownBound) return;
  const closeOutside = (event) => {
    qsa('.analytics-year-dropdown[open]').forEach((dropdown) => {
      if (!dropdown.contains(event.target)) dropdown.removeAttribute('open');
    });
  };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('click', closeOutside);
  document.addEventListener('focusin', closeOutside);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') qsa('.analytics-year-dropdown[open]').forEach((dropdown) => dropdown.removeAttribute('open'));
  });
  window.__liteojAnalyticsYearDropdownBound = true;
}

function bindAnalyticsDonutTooltip() {
  const tooltip = qs('#analyticsDonutTooltip');
  if (!tooltip) return;
  const move = (event) => {
    const box = event.currentTarget?.getBoundingClientRect?.();
    const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : (box ? box.left + box.width / 2 : 0);
    const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : (box ? box.top + box.height / 2 : 0);
    tooltip.style.left = `${x + 14}px`;
    tooltip.style.top = `${y + 14}px`;
  };
  qsa('.analytics-donut-segment').forEach((segment) => {
    const show = (event) => {
      tooltip.innerHTML = `<b>${esc(decodeAttrValue(segment.dataset.tag))}</b><span>${esc(decodeAttrValue(segment.dataset.score))} 分</span><em>${esc(decodeAttrValue(segment.dataset.percent))}</em>`;
      move(event);
      tooltip.classList.add('visible');
    };
    const hide = () => tooltip.classList.remove('visible');
    segment.addEventListener('pointerenter', show);
    segment.addEventListener('mouseenter', show);
    segment.addEventListener('click', show);
    segment.addEventListener('pointermove', move);
    segment.addEventListener('mousemove', move);
    segment.addEventListener('pointerleave', hide);
    segment.addEventListener('mouseleave', hide);
  });
}

async function renderAnalytics() {
  setImmersive(false);
  const params = new URLSearchParams(location.search);
  const options = await api('/api/analytics/prelim/options');
  const selectedYears = analyticsSelectedYears(params);
  const selectedGroup = params.get('groupName') || params.get('group') || '';
  const hasAnalysis = Boolean(selectedYears.length && selectedGroup);
  const query = new URLSearchParams();
  if (selectedYears.length) query.set('years', selectedYears.join(','));
  if (selectedGroup) query.set('groupName', selectedGroup);
  const stats = hasAnalysis ? await api('/api/analytics/prelim/knowledge' + (query.toString() ? `?${query}` : '')) : null;
  app.innerHTML = `<div class="analytics-page">
    <div class="card filter-panel-card analytics-filter-card">
      <form id="analyticsFilter" class="filter-panel-grid analytics-filter-grid compact-analytics-filter">
        <label class="analytics-years-control">年份${analyticsYearDropdown(options.years || [], selectedYears)}</label>
        <label>组别${analyticsGroupSelect(options.groups || ['CSP-J', 'CSP-S'], selectedGroup)}</label>
        <div class="filter-actions"><button class="primary">分析</button><button type="button" class="reset-btn" data-route="/analytics">重置</button></div>
      </form>
    </div>
    ${stats ? `<div class="analytics-grid-main equal">
      <section class="card analytics-chart-card analytics-count-card"><div class="table-headline"><h2>考点出现次数</h2></div>${analyticsCountBarChart(stats.counts || [])}</section>
      <section class="card analytics-chart-card analytics-donut-card"><div class="table-headline"><h2>考点加权分值</h2></div>${analyticsDonutChart(stats.items || [])}</section>
    </div>
    <section class="card analytics-chart-card"><div class="table-headline"><h2>考点/年份对照表</h2></div>${analyticsYearCompare(stats)}</section>` : ''}
  </div>`;
  bindAnalyticsYearDropdown();
  bindAnalyticsDonutTooltip();
  qs('#analyticsFilter').onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const years = qsa('input[name="years"]:checked', form).map((x) => x.value);
    if (!years.length) { alert('请至少选择一个年份。'); return; }
    const f = formData(form);
    if (!f.groupName) { alert('请选择组别。'); return; }
    const q = new URLSearchParams();
    q.set('years', years.join(','));
    q.set('groupName', f.groupName);
    nav('/analytics?' + q.toString());
  };
}

function mockCard(p) {
  const latest = p.latest;
  const btnText = latest ? '重新练习' : '开始练习';
  return `<div class="mock-paper-card mock-card">
    <div class="mock-paper-card-content">
      <div class="mock-paper-main">
        <div class="mock-paper-icon">卷</div>
        <h4 class="mock-paper-title">${esc(p.title)}</h4>
        <div class="mock-paper-meta"><p class="mock-paper-meta-item">年份 ${esc(String(p.year || '--'))}</p><p class="mock-paper-meta-item">${esc(p.groupName)} · ${p.questionCount} 小题</p></div>
      </div>
      <div class="mock-paper-actions">
        <div class="mock-paper-score-wrap">${latest ? `<p class="mock-paper-score">${formatScore(latest.score)}</p><p class="mock-paper-score-note">上次得分 / ${formatScore(latest.totalScore || 0)}</p>` : ''}</div>
        <div class="mock-paper-buttons">${latest ? `<button type="button" class="mock-paper-report-btn" onclick="nav('/prelim/mock/report/${latest.examId}')">查看报告</button>` : ''}<button type="button" class="primary mock-paper-start-btn" onclick="startMockExam(${p.id})">${btnText}</button></div>
      </div>
    </div>
  </div>`;
}
async function renderMockHome() {
  setImmersive(false);
  const params = new URLSearchParams(location.search);
  const data = await api('/api/prelim/mock/papers');
  let papers = data.papers || [];
  if (params.get('keyword')) papers = papers.filter((p) => p.title.includes(params.get('keyword')) || p.paperTitle.includes(params.get('keyword')));
  if (params.get('year')) papers = papers.filter((p) => String(p.year) === params.get('year'));
  if (params.get('status') === 'done') papers = papers.filter((p) => p.latest);
  if (params.get('status') === 'todo') papers = papers.filter((p) => !p.latest);
  const years = [...new Set((data.papers || []).map((p) => p.year).filter(Boolean))].sort((a,b)=>b-a);
  app.innerHTML = `<div class="mock-page mock-page-clean">
    <div class="card filter-panel-card mock-filter-card">
      <form id="mockFilter" class="mock-filter-form mock-filter-grid mock-filter-grid-clean">
        <label class="mock-keyword">关键词<input name="keyword" type="text" placeholder="试卷名称" maxlength="30" value="${esc(params.get('keyword') || '')}" /></label>
        <label>完成状态<select name="status"><option value="">全部状态</option><option value="done" ${params.get('status') === 'done' ? 'selected' : ''}>已完成</option><option value="todo" ${params.get('status') === 'todo' ? 'selected' : ''}>未练习</option></select></label>
        <label>年份<select name="year">${optionList(years, params.get('year') || '', '全部年份')}</select></label>
        <div class="filter-actions"><button class="primary">筛选</button><button type="button" class="reset-btn" onclick="nav('/prelim/mock')">重置</button></div>
      </form>
    </div>
    <div class="mock-paper-list-wrap"><div class="mock-paper-list">${papers.length ? papers.map(mockCard).join('') : '<div class="card muted">暂无可用模考试卷</div>'}</div></div>
  </div>`;
  qs('#mockFilter').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const q = new URLSearchParams();
    for (const k of ['keyword','status','year']) if (f[k]) q.set(k, f[k]);
    nav('/prelim/mock' + (q.toString() ? `?${q}` : ''));
  };
}
window.startMockExam = async (paperId) => runUiAction(async () => {
  const result = await api('/api/prelim/mock/start', { method: 'POST', body: { paperId } });
  nav(`/prelim/mock/exam/${result.examId}`);
});
function mockQuestionInput(q) {
  return `<div class="mock-subq" data-question-id="${q.id}">${numberedStem(q, 'small-stem')}${renderQuestionOptions(q, 'radio')}</div>`;
}
function mockSingleChoiceBlock(g) {
  const q = (g.questions || [])[0];
  if (!q) return '';
  return `<div class="mock-exam-question single-choice-question" data-group-id="${g.id}">${mockQuestionInput(q)}</div>`;
}
function mockGroupBlock(g) {
  if (g.section === 'single_choice') return mockSingleChoiceBlock(g);
  const groupStem = shouldShowPrelimGroupStem(g) ? `<div class="markdown mock-group-stem">${renderMarkdown(g.stem)}</div>` : '';
  return `<div class="mock-exam-question grouped-question" data-group-id="${g.id}"><h3>${esc(groupShortTitle(g))}</h3>${groupStem}${g.code ? renderCodeBlock(g.code, 'cpp') : ''}${(g.questions || []).map(mockQuestionInput).join('')}</div>`;
}
function mockSectionBlock(section, groups) {
  if (!groups.length) return '';
  return `<section class="mock-exam-section"><h2>${esc(sectionTitleFromGroups(section, groups))}</h2>${groups.map(mockGroupBlock).join('')}</section>`;
}
function renderMockExamSections(groups = []) {
  return PRELIM_SECTION_ORDER.map((section) => mockSectionBlock(section, groups.filter((g) => g.section === section))).join('');
}

function bindMockOptionEvents(root) {
  qsa('.mock-option-input', root).forEach((input) => {
    input.addEventListener('change', () => {
      const options = input.closest('.mock-options');
      qsa('.mock-option', options).forEach((label) => label.classList.toggle('selected', qs('input', label)?.checked));
    });
  });
}
async function renderMockExam(id) {
  setImmersive(false);
  const data = await api(`/api/prelim/mock/exams/${id}`);
  app.innerHTML = `<form id="mockExamForm" class="mock-exam-page"><div class="row space page-head"><div><h1>${esc(data.exam.title)}</h1><p class="muted">总分 ${formatScore(data.exam.totalScore || 0)}，提交后自动判分</p></div><button type="button" onclick="nav('/prelim/mock')">返回模考</button></div>${renderMockExamSections(data.groups || [])}<div class="mock-submit-bar"><button class="primary">提交试卷并判分</button></div></form>`;
  bindMockOptionEvents(qs('#mockExamForm'));
  qs('#mockExamForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('确认提交本次模拟考试？提交后将立即判分。')) return;
    const answers = {};
    qsa('.mock-subq').forEach((block) => {
      const checked = qs('input[type="radio"]:checked', block);
      if (checked) answers[block.dataset.questionId] = checked.value;
    });
    const result = await api(`/api/prelim/mock/exams/${id}/submit`, { method: 'POST', body: { answers } });
    alert(`本次得分：${formatScore(result.score)} / ${formatScore(result.totalScore || 0)}`);
    nav(`/prelim/mock/report/${id}`);
  };
}
function mockReportQuestion(q, answers) {
  const a = answers[q.id] || {};
  return `<div class="mock-report-question">${numberedStem(q, 'small-stem')}<p class="${a.correct ? 'success' : 'error'}">你的答案：${esc(storedAnswerText(a.selectedAnswer)) || '未作答'}　正确答案：${esc(storedAnswerText(q.answer))}　${a.correct ? '正确' : '错误'}</p><div class="markdown">${renderMarkdown(q.explanation || '暂无解析')}</div><p>${prelimTagWeights(q.tags || [])}</p></div>`;
}
function mockReportGroup(g, answers) {
  if (g.section === 'single_choice') {
    return (g.questions || []).map((q) => mockReportQuestion(q, answers)).join('');
  }
  const groupStem = shouldShowPrelimGroupStem(g) ? `<div class="markdown mock-group-stem">${renderMarkdown(g.stem)}</div>` : '';
  return `<div class="mock-report-item"><h3>${esc(groupShortTitle(g))}</h3>${groupStem}${g.code ? renderCodeBlock(g.code, 'cpp') : ''}${(g.questions || []).map((q) => mockReportQuestion(q, answers)).join('')}</div>`;
}
function mockReportSection(section, groups, answers) {
  if (!groups.length) return '';
  return `<section class="card mock-report-group"><h2>${esc(sectionTitleFromGroups(section, groups))}</h2>${groups.map((g) => mockReportGroup(g, answers)).join('')}</section>`;
}
function renderMockReportSections(groups = [], answers = {}) {
  return PRELIM_SECTION_ORDER.map((section) => mockReportSection(section, groups.filter((g) => g.section === section), answers)).join('');
}
async function renderMockReport(id) {
  setImmersive(false);
  const data = await api(`/api/prelim/mock/exams/${id}/report`);
  const answers = data.exam.answers || {};
  app.innerHTML = `<div class="mock-report-page"><div class="card"><div class="row space"><div><h1>模考报告</h1><p class="muted">${esc(data.exam.title)}</p></div><button onclick="nav('/prelim/mock')">返回模考</button></div><div class="mock-score-big">${formatScore(data.exam.score)}<span>/ ${formatScore(data.exam.totalScore || 0)}</span></div></div>${renderMockReportSections(data.groups || [], answers)}</div>`;
}

function attrEsc(value) {
  return esc(encodeURIComponent(String(value ?? '')));
}
function decodeAttrValue(value) {
  try { return decodeURIComponent(value || ''); } catch (_) { return value || ''; }
}
function toolbarButton(title, label, before, after = '') {
  return `<button type="button" class="md-tool-btn" title="${esc(title)}" data-md-insert data-before="${attrEsc(before)}" data-after="${attrEsc(after)}">${label}</button>`;
}

function mdToolbar(targetName) {
  return `<div class="md-toolbar" data-target="${esc(targetName)}">
    ${toolbarButton('粗体', '<b>B</b>', '**', '**')}
    ${toolbarButton('斜体', '<i>I</i>', '*', '*')}
    ${toolbarButton('删除线', 'S', '~~', '~~')}
    ${toolbarButton('标题', 'H', '### ', '')}
    ${toolbarButton('链接', '链接', '[链接文字](', ')')}
    ${toolbarButton('表格', '表格', '\n| 列1 | 列2 |\n| :-- | :-- |\n| 内容 | 内容 |\n', '')}
    ${toolbarButton('公式', '$x$', '$', '$')}
    ${toolbarButton('代码块', '代码', '\n```cpp\n', '\n```\n')}
    <label class="md-tool-btn md-image-tool" title="插入图片">图片<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" data-md-image /></label>
  </div>`;
}

function insertIntoTextarea(input, before, after = '') {
  if (!input) return;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const text = input.value.slice(start, end) || '';
  input.value = input.value.slice(0, start) + before + text + after + input.value.slice(end);
  input.focus();
  input.selectionStart = start + before.length;
  input.selectionEnd = start + before.length + text.length;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

window.insertMarkdown = (targetName, before, after) => {
  insertIntoTextarea(qs(`[name="${targetName}"]`), before, after);
};

function currentProblemIdForAttachment(input) {
  const form = input?.closest('form') || document;
  const idInput = qs('[name="id"]', form);
  const id = String(idInput?.value || '').trim();
  if (!id) {
    alert('请先填写题号，再上传本题附件图片。');
    return null;
  }
  if (!PROBLEM_ID_PATTERN.test(id)) {
    alert('题号格式错误：题号必须由若干大写英文字母 + 若干数字组成，例如 P1001、ABC12。');
    return null;
  }
  return id;
}

async function uploadProblemAttachment(problemId, file) {
  const fd = new FormData();
  fd.set('file', file);
  const res = await fetch(problemApi(problemId, '/attachments'), { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function insertImageIntoEditor(input, file) {
  if (!input || !file) return;
  if (!/^image\//.test(file.type || '')) {
    alert('请选择图片文件，支持 png、jpg、jpeg、gif、webp。');
    return;
  }
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    alert('图片不能超过 5MB。');
    return;
  }
  const problemId = currentProblemIdForAttachment(input);
  if (!problemId) return;
  try {
    const result = await uploadProblemAttachment(problemId, file);
    const name = (file.name || 'image').replace(/[\r\n\[\]]/g, '').trim() || 'image';
    insertIntoTextarea(input, `\n![${name}](${result.url})\n`, '');
  } catch (err) {
    alert(err.message || '图片上传失败，请重试。');
  }
}

function bindMarkdownEditors(root = document) {
  qsa('.md-editor-wrap', root).forEach((wrap) => {
    const input = qs('.md-source', wrap);
    const preview = qs('.md-preview', wrap);
    if (!input || !preview) return;
    const update = () => { preview.innerHTML = renderMarkdown(input.value || ''); };
    input.addEventListener('input', update);
    update();
    const toolbar = qs('.md-toolbar', wrap);
    if (!toolbar || toolbar.dataset.bound === '1') return;
    toolbar.dataset.bound = '1';
    toolbar.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-md-insert]');
      if (!btn || !toolbar.contains(btn)) return;
      event.preventDefault();
      insertIntoTextarea(input, decodeAttrValue(btn.dataset.before), decodeAttrValue(btn.dataset.after));
    });
    qsa('[data-md-image]', toolbar).forEach((fileInput) => {
      fileInput.addEventListener('click', (event) => event.stopPropagation());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) insertImageIntoEditor(input, file);
        fileInput.value = '';
      });
    });
  });
}

function bindMarkdownPreviews(root = document) {
  bindMarkdownEditors(root);
}

function mdEditor(name, label, value = '', options = {}) {
  const previewId = options.previewId || `${name}Preview`;
  const maxLength = options.maxLength ? `maxlength="${options.maxLength}"` : '';
  return `<div data-form-name="${esc(name)}" class="form-block md-form-block ${options.required ? 'required-form-block' : ''}">
    <label class="editor-field-label ${options.required ? 'required-label' : ''}">${esc(label)}</label>
    <div class="formField editor-md-editor-wrap md-editor-wrap">
      ${mdToolbar(name)}
      <div class="md-editor-content">
        <textarea name="${name}" class="md-source md-at-scroll-container" placeholder="请使用 Markdown 编写完整题面，可包含题目描述、输入格式、输出格式、样例、提示说明等内容" ${maxLength}>${esc(value)}</textarea>
        <div id="${previewId}" class="markdown md-preview"></div>
      </div>
    </div>
  </div>`;
}

function collectProblemForm(form, existingId) {
  const f = formData(form);
  return {
    id: f.id || existingId || '',
    title: f.title,
    description: f.description,
    tags: String(f.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    difficulty: f.difficulty || 'unrated',
    timeLimit: Number(f.timeLimit) || 1000,
    memoryLimit: Number(f.memoryLimit) || 128,
    checkerMode: form.querySelector('[name="specialJudge"]')?.checked ? 'special_judge' : 'standard',
    checkerTolerance: 0.000001,
    isPublic: Boolean(form.querySelector('[name="isPublic"]')?.checked),
  };
}

function filePicker(name, labelId, buttonText = '选择压缩包', accept = '.zip') {
  return `<div class="file-upload-row">
    <label class="file-select-btn">
      <input name="${esc(name)}" type="file" accept="${esc(accept)}" data-file-label="#${esc(labelId)}" />
      <span>${esc(buttonText)}</span>
    </label>
    <span id="${esc(labelId)}" class="file-name">未选择文件</span>
  </div>`;
}

function bindFileNameDisplays(root = document) {
  qsa('input[type="file"][data-file-label]', root).forEach((input) => {
    const label = qs(input.dataset.fileLabel, root) || qs(input.dataset.fileLabel);
    const update = () => {
      if (label) label.textContent = input.files?.[0]?.name || '未选择文件';
    };
    input.addEventListener('change', update);
    update();
  });
}

async function renderProblemEditor(id) {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const isNew = id === 'new';
  let p = { id: '', title: '', description: '', tags: [], difficulty: 'beginner', timeLimit: 1000, memoryLimit: 128, checkerMode: 'standard', checkerTolerance: 0.000001, isPublic: false, hasChecker: false };
  if (!isNew) p = (await api(problemApi(id))).problem;
  if (isNew) {
    try { p.id = (await api('/api/problems/next-id')).id; } catch (_) { p.id = ''; }
  }
  app.innerHTML = `
    <div class="editor-layout-page rich-editor-page">
      <div class="edit-title-wrap">
        <a class="back-btn" href="/admin/problems" data-route="/admin/problems" aria-label="返回题目管理">←</a>
        <h1>${isNew ? '新增编程题' : '编辑编程题'}</h1>
        <span class="edit-tag">题库</span>
      </div>
      <form id="problemForm" class="editor-layout-form">
        <section class="editor-panel">
          <div class="grid three">
            <div>${requiredLabel('题号')}<input ${isNew ? 'name="id"' : ''} value="${esc(p.id)}" ${isNew ? '' : 'disabled'} placeholder="如 P1001、CSP1001" />${!isNew ? `<input type="hidden" name="id" value="${esc(p.id)}" />` : ''}</div>
            <div>${requiredLabel('标题')}<input name="title" value="${esc(p.title)}" placeholder="请输入标题" maxlength="80" /></div>
            <div>${requiredLabel('难度')}<select name="difficulty">${difficultyOptions(p.difficulty)}</select></div>
          </div>
          <div class="grid two">
            <div>${requiredLabel('时间限制 ms')}<input name="timeLimit" value="${esc(p.timeLimit)}" /></div>
            <div>${requiredLabel('内存限制 MB')}<input name="memoryLimit" value="${esc(p.memoryLimit)}" /></div>
          </div>
          <div class="form-block spj-form-block">
            <label class="checkbox-line publish-line"><input type="checkbox" name="specialJudge" ${p.checkerMode === 'special_judge' ? 'checked' : ''} /> 启用 Special Judge</label>
            <p class="muted small">用于答案不唯一的题目。checker.cpp 使用 testlib 风格编写，在测试数据管理页上传；参数顺序为 input、用户输出、标准输出。</p>
            ${!isNew ? `<span class="state-pill ${p.checkerMode === 'special_judge' && p.hasChecker ? 'state-public' : 'state-none'}">${p.checkerMode === 'special_judge' ? (p.hasChecker ? '已上传 checker.cpp' : '待上传 checker.cpp') : '标准输出评测'}</span>` : ''}
          </div>
          <label>标签，逗号分隔</label><input name="tags" value="${esc((p.tags || []).join(','))}" placeholder="例如 图论,LCA,树形DP" />
          ${mdEditor('description', '题面', p.description, { required: true, maxLength: 50000 })}
          <div class="form-block publish-form-block">
            <label class="checkbox-line publish-line"><input type="checkbox" name="isPublic" ${p.isPublic ? 'checked' : ''} /> 公开题目</label>
          </div>
          <div id="editorMsg"></div>
          <div class="editor-footer"><button type="submit" class="primary editor-submit-btn">${isNew ? '创建题目' : '保存'}</button>${routeLink('/admin/problems', '取消', 'btn')}${!isNew ? routeLink(`/admin/problem/${problemUrl(p.id)}/data`, '管理测试点', 'btn') : ''}</div>
        </section>
      </form>
    </div>`;
  bindMarkdownPreviews(qs('#problemForm'));
  qs('#problemForm').onsubmit = (e) => saveProblemEditor(e, p, isNew);
}

async function saveProblemEditor(e, existingProblem, isNew) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = qs('.editor-submit-btn', form);
  try {
    if (submitBtn) submitBtn.disabled = true;
    const body = collectProblemForm(form, existingProblem.id);
    if (!validateProblemIdForUI(body.id)) return;
    const method = isNew ? 'POST' : 'PUT';
    const url = isNew ? '/api/problems' : problemApi(body.id);
    const result = await api(url, { method, body });
    const problemId = result.problem.id;
    if (isNew) {
      nav(`/admin/problem/${problemUrl(problemId)}/data`);
    } else {
      showInlineSuccess('#editorMsg', '保存成功');
      setTimeout(() => nav('/admin/problems'), 350);
    }
  } catch (err) {
    showInlineError('#editorMsg', err);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function renderCaseManager(problemId) {
  setImmersive(false);
  if (currentUser?.role !== 'admin') return renderLogin();
  const pdata = await api(problemApi(problemId));
  const cdata = await api(problemApi(problemId, '/cases'));
  const cases = cdata.cases || [];
  const initialSubtaskMode = cases.some((c) => c.subtask);
  const zipNameKey = `liteoj.caseZipName:${problemId}`;
  let savedZipName = '';
  try { savedZipName = localStorage.getItem(zipNameKey) || ''; } catch {}
  app.innerHTML = `
    <div class="row space page-head">
      <div><h1>${esc(pdata.problem.id)} ${esc(pdata.problem.title)}</h1></div>
      <div class="row button-row">${routeLink(`/admin/problem/${problemUrl(problemId)}/edit`, '编辑题面', 'btn')}${routeLink(`/problem/${problemUrl(problemId)}`, '查看题目', 'btn')}</div>
    </div>
    ${renderCheckerPanel(pdata.problem)}
    <div class="card case-manager-card">
      <div class="testcase-mode-header">
        <label class="case-section-label required-label">测试点</label>
        <div class="segmented case-mode">
          <button type="button" class="case-mode-btn active" data-mode="zip">上传压缩包</button>
          <button type="button" class="case-mode-btn" data-mode="manual">手动录入测试点</button>
        </div>
      </div>
      <section id="zipCaseManagePanel" class="testcase-panel">
        <form id="caseZipForm" class="zip-form case-upload-form">
          <div class="case-upload-title">
            <strong>上传测试点</strong>
            ${caseHelpIcon('1. 仅支持上传 .zip 文件；\n2. 输入数据和输出数据必须成对出现，输入文件扩展名为 .in，输出文件扩展名为 .out；\n3. 测试点文件名中只允许字母和数字，例如 game001.in；\n4. 若是特判题，请将特判文件命名为 checker.cpp，打包在测试点压缩包中一起上传。')}
          </div>
          <div class="case-upload-line">
            ${filePicker('file', 'caseZipFileName', '上传文件')}
            <label class="checkbox-line"><input type="checkbox" name="replace" checked /> 覆盖当前测试点</label>
            <button class="primary">上传并解析</button>
          </div>
          <input id="caseZipNameBox" class="case-zip-name-box" readonly placeholder="已上传测试点压缩包名称" value="${esc(savedZipName)}" />
          <label class="checkbox-line case-subtask-toggle">
            <input type="checkbox" id="caseSubtaskMode" ${initialSubtaskMode ? 'checked' : ''} />
            子任务模式
            ${caseHelpIcon('子任务评分模式下：\n每个子任务视为一个整体。\n子任务内全部测试点通过时，才会获得该子任务的分数。')}
          </label>
        </form>
        <div id="zipMsg"></div>
      </section>
      <section id="manualCaseManagePanel" class="testcase-panel hidden">
        <form id="manualCasesForm">
          <div id="manualCaseList">${manualCaseDraftItem(1, pdata.problem, cases.length ? 0 : 100)}</div>
          <button type="button" id="addManualCaseBtn" class="case-add-line"><span></span><b>⊕ 新增一组测试点</b><span></span></button>
          <div class="case-layout-actions"><button class="primary">保存手动测试点</button><span id="caseMsg"></span></div>
        </form>
      </section>
    </div>
    <div class="card table-card case-overview-card">
      <div class="table-headline"><h2>已有测试点</h2><span class="muted small">编辑测试点只修改元信息，不加载输入输出正文</span></div>
      <div id="caseOverviewMount">${renderCaseOverview(problemId, pdata.problem, cases, initialSubtaskMode)}</div>
    </div>`;
  bindFileNameDisplays(qs('#caseZipForm'));
  bindFileNameDisplays(qs('#checkerUploadForm'));
  bindCheckerPanel(problemId);
  bindCaseManagerInteractions(problemId, pdata.problem, cases, initialSubtaskMode);
  qs('#caseZipForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(e.target);
      fd.set('replace', e.target.replace.checked ? '1' : '0');
      fd.set('autoScore', '1');
      fd.set('subtaskMode', qs('#caseSubtaskMode')?.checked ? '1' : '0');
      const res = await fetch(problemApi(problemId, '/cases/zip'), { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const uploadedName = qs('#caseZipNameBox')?.value || '';
      if (uploadedName) try { localStorage.setItem(zipNameKey, uploadedName); } catch {}
      qs('#zipMsg').innerHTML = `<div class="success">已导入 ${data.imported} 组测试点。${data.checkerImported ? '已同步 checker.cpp 并启用 Special Judge。' : ''}${data.missing?.length ? `缺少配对文件：${data.missing.join(', ')}` : ''}</div>`;
      setTimeout(() => nav(`/admin/problem/${problemUrl(problemId)}/data`), 600);
    } catch (err) { showInlineError('#zipMsg', err); }
  };
}

function renderCaseEditorBlock(problemId, c) {
  const scoreLabel = c.subtask ? '子任务分值' : '测试点分值';
  const scoreValue = c.subtask ? (c.subtaskScore ?? c.score) : c.score;
  return `<form class="case-edit-form case-block case-meta-editor" data-case-id="${esc(c.id)}">
    <div class="row space"><h3>#${esc(c.sort)} 测试点元信息</h3><button type="button" onclick="closeCaseEditor(${jsArg(c.id)})">收起</button></div>
    <p class="muted">这里只修改文件归组、分值、排序和时空限制，不加载输入/输出正文。</p>
    <div class="grid three"><div><label>子任务</label><input name="subtask" value="${esc(c.subtask || '')}" placeholder="可选" /></div><div><label>${scoreLabel}</label><input name="score" value="${esc(scoreValue)}" /></div><div><label>排序</label><input name="sort" value="${esc(c.sort)}" /></div></div>
    <div class="grid two"><div><label>时间限制 ms</label><input name="timeLimit" value="${esc(c.timeLimit || '')}" placeholder="留空继承题目" /></div><div><label>内存限制 MB</label><input name="memoryLimit" value="${esc(c.memoryLimit || '')}" placeholder="留空继承题目" /></div></div>
    <p><button>保存测试点</button></p>
  </form>`;
}

async function openCaseEditor(problemId, caseId) {
  return runUiAction(async () => {
    const mount = qs(`#${caseEditorId(caseId)}`);
    if (!mount) return null;
    if (mount.dataset.loaded === '1') {
      mount.innerHTML = '';
      mount.dataset.loaded = '0';
      return null;
    }
    mount.innerHTML = '<div class="muted case-editor-loading">正在加载测试点元信息...</div>';
    const data = await api(problemApi(problemId, `/cases/${caseId}`));
    mount.innerHTML = renderCaseEditorBlock(problemId, data.case);
    mount.dataset.loaded = '1';
    const form = qs('.case-edit-form', mount);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      await api(problemApi(problemId, `/cases/${caseId}`), { method: 'PUT', body: { subtask: f.subtask || '', score: Number(f.score) || 0, sort: Number(f.sort) || 0, timeLimit: Number(f.timeLimit) || 0, memoryLimit: Number(f.memoryLimit) || 0 } });
      nav(`/admin/problem/${problemUrl(problemId)}/data`);
    };
    return data;
  });
}

function closeCaseEditor(caseId) {
  const mount = qs(`#${caseEditorId(caseId)}`);
  if (mount) {
    mount.innerHTML = '';
    mount.dataset.loaded = '0';
  }
}

async function deleteCase(problemId, caseId) {
  return runUiAction(async () => {
  if (!confirm('确认删除这个测试点？')) return null;
  await api(problemApi(problemId, `/cases/${caseId}`), { method: 'DELETE' });
  nav(`/admin/problem/${problemUrl(problemId)}/data`);
  });
}
window.deleteCase = deleteCase;
window.openCaseEditor = openCaseEditor;
window.closeCaseEditor = closeCaseEditor;

window.editProblem = (id) => nav(`/admin/problem/${problemUrl(id)}/edit`);
window.openProblemData = (id) => nav(`/admin/problem/${problemUrl(id)}/data`);
window.toggleProblem = async (id, isPublic) => runUiAction(
  () => api(problemApi(id, '/status'), { method: 'POST', body: { isPublic } }),
  () => renderProblemManage(),
);
window.deleteProblem = async (id) => runUiAction(async () => {
  if (!confirm(`确认删除 ${id}？相关提交和测试数据都会被删除。`)) return null;
  await api(problemApi(id), { method: 'DELETE' });
  nav('/admin/problems');
});
window.cloneProblem = async (id) => runUiAction(async () => {
  const newId = prompt('请输入新题号，例如 P1002 或 CSP1001。留空则自动分配：', '');
  if (newId === null) return null;
  if (newId.trim() && !validateProblemIdForUI(newId.trim())) return null;
  const result = await api(problemApi(id, '/clone'), { method: 'POST', body: { id: newId.trim() } });
  nav(`/admin/problem/${problemUrl(result.problem.id)}/edit`);
});
window.rejudgeProblem = async (id) => runUiAction(
  () => api(problemApi(id, '/rejudge'), { method: 'POST', body: {} }),
  (result) => alert(`已重置 ${result.changed} 条提交为等待评测。`),
);

async function render() {
  try {
    await refreshMe();
    const path = location.pathname;
    if (path === '/' || path === '/problems') return await renderProblems();
    if (path === '/prelim') return await renderPrelimList();
    if (path === '/prelim/mock') return await renderMockHome();
    if (path === '/analytics') return await renderAnalytics();
    if (path === '/login') return await renderLogin();
    if (path === '/register') return await renderRegister();
    if (path === '/profile') return await renderProfile();
    if (path === '/submissions') return await renderSubmissions();
    if (path === '/admin') return await renderAdmin();
    if (path === '/admin/users') return await renderUserAdmin();
    if (path === '/admin/problems') return await renderProblemManage();
    if (path === '/admin/prelim') return await renderPrelimAdmin();
    if (path === '/admin/prelim/import') return await renderPrelimImport();
    let m;
    if ((m = path.match(/^\/problem\/([A-Z]+\d+)$/))) return await renderProblem(m[1]);
    if ((m = path.match(/^\/prelim\/item\/(\d+)$/))) return await renderPrelimItem(m[1]);
    if ((m = path.match(/^\/prelim\/paper\/(\d+)$/))) return await renderPrelimPaper(m[1]);
    if ((m = path.match(/^\/prelim\/mock\/exam\/(\d+)$/))) return await renderMockExam(m[1]);
    if ((m = path.match(/^\/prelim\/mock\/report\/(\d+)$/))) return await renderMockReport(m[1]);
    if ((m = path.match(/^\/submission\/(\d+)$/))) return await renderSubmission(m[1]);
    if ((m = path.match(/^\/admin\/problem\/(new|[A-Z]+\d+)$/))) return await renderProblemEditor(m[1]);
    if ((m = path.match(/^\/admin\/problem\/([A-Z]+\d+)\/edit$/))) return await renderProblemEditor(m[1]);
    if ((m = path.match(/^\/admin\/problem\/([A-Z]+\d+)\/data$/))) return await renderCaseManager(m[1]);
    app.innerHTML = `<div class="card"><h1>页面不存在</h1><button onclick="nav('/problems')">返回题库</button></div>`;
  } catch (err) {
    renderError(err);
  } finally {
    enhanceFormAccessibility();
  }
}

render();

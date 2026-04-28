// Trello Command Center — client side
// Routes: #/overview, #/kanban, #/cards, #/devs, #/github, #/timeline, #/notes, #/docs

// ═══════════════════════════ STATE ═══════════════════════════
const state = {
  derived: null,
  github: null,
  notes: '',
  filter: { dev: null, label: null, epic: null, list: null, search: '' },
  route: 'overview',
  cardsByIdShort: {},
  currentUser: null,
  pollingTimer: null,
  lastRefresh: null,
  config: null,
};

// Carregado de config.json em runtime
let TEAM_USERS = [];
let CONFIG = null;

async function loadConfig() {
  try {
    const r = await fetch('config.json?_=' + Date.now());
    if (!r.ok) throw new Error('config.json não encontrado');
    const cfg = await r.json();
    CONFIG = cfg;
    state.config = cfg;
    TEAM_USERS = cfg.team || [];
    // Atualiza document.title
    if (cfg.project) {
      document.title = `${cfg.project.name} — ${cfg.project.tagline || 'Command Center'}`;
      const brandTitle = document.querySelector('.brand-title');
      if (brandTitle) brandTitle.textContent = cfg.project.name;
      const brandSubtitle = document.querySelector('.brand-subtitle');
      if (brandSubtitle) brandSubtitle.textContent = cfg.project.tagline || 'Command Center';
      const brandIcon = document.querySelector('.brand-icon');
      if (brandIcon && cfg.project.icon) brandIcon.textContent = cfg.project.icon;
      const boardName = document.getElementById('board-name');
      if (boardName) boardName.textContent = `${cfg.project.icon || '🎯'} ${cfg.project.name}`;
    }
    return cfg;
  } catch (e) {
    document.getElementById('page').innerHTML = `
      <div class="empty" style="color:var(--red);max-width:600px;margin:60px auto">
        <h2>⚠️ config.json não encontrado</h2>
        <p>Copie <code>config.example.json</code> para <code>config.json</code> e edite com info do seu projeto.</p>
        <p>Ou peça pro Claude do seu projeto fazer isso — ver <code>PROMPT-CLAUDE.md</code>.</p>
      </div>`;
    return null;
  }
}

function getUserPRs(user) {
  if (!state.github || !user || !user.githubLogin) return { open: [], merged: [], conflicting: [] };
  const repoNames = (CONFIG && CONFIG.project && CONFIG.project.githubRepos) || [];
  const stripPrefix = repoNames.length ? repoNames[0].full.split('/')[0] + '-' : '';
  const allPRs = Object.values(state.github.repos).flatMap(r =>
    r.prs.map(pr => ({ ...pr, repo: r.full.split('/')[1].replace(stripPrefix, '') }))
  );
  const mine = allPRs.filter(pr => {
    const login = (pr.author && (pr.author.login || pr.author.name)) || pr.author;
    return login === user.githubLogin;
  });
  return {
    open: mine.filter(p => p.state === 'OPEN'),
    merged: mine.filter(p => p.state === 'MERGED' && p.mergedAt && (Date.now() - new Date(p.mergedAt).getTime()) < 14 * 86400000),
    conflicting: mine.filter(p => p.state === 'OPEN' && p.mergeable === 'CONFLICTING'),
    total: mine.length,
  };
}

function getCurrentUser() {
  if (state.currentUser) return state.currentUser;
  try {
    const saved = JSON.parse(localStorage.getItem('tcc_current_user') || 'null');
    if (saved) {
      state.currentUser = saved;
      return saved;
    }
  } catch {}
  return null;
}

function setCurrentUser(user) {
  state.currentUser = user;
  localStorage.setItem('tcc_current_user', JSON.stringify(user));
  // Update sidebar avatar
  updateUserBadge();
  render();
}

function updateUserBadge() {
  const el = $('#user-badge');
  if (!el || !state.currentUser) return;
  const u = state.currentUser;
  el.innerHTML = `
    <div class="user-avatar-mini" style="background:${u.color}">${u.emoji}</div>
    <div class="user-meta">
      <div class="user-name">${escapeHtml(u.name.split(' ')[0])}</div>
      <div class="user-role">${escapeHtml(u.role)}</div>
    </div>
    <span class="user-switch" title="Trocar usuário">⇄</span>
  `;
}

function showUserPicker() {
  const cur = state.currentUser;
  const html = `
    <button class="modal-close" id="up-close">×</button>
    <h2>👋 Quem é você?</h2>
    <p style="color:var(--fg-muted);margin-bottom:18px;font-size:13.5px">
      O dashboard personaliza overview, alertas e seus cards conforme quem você é.
      ${cur ? `<br>Atualmente como <strong style="color:${cur.color}">${escapeHtml(cur.name)}</strong>.` : ''}
    </p>
    <div class="user-picker">
      ${TEAM_USERS.map(u => `
        <button class="user-pick-btn ${cur && cur.id === u.id ? 'active' : ''}" data-uid="${u.id}">
          <div class="user-avatar" style="background:${u.color}">${u.emoji}</div>
          <div>
            <div class="user-pick-name">${escapeHtml(u.name)}</div>
            <div class="user-pick-role">${escapeHtml(u.role)}</div>
          </div>
        </button>
      `).join('')}
    </div>
  `;
  $('#quick-add-content').innerHTML = html;
  $('#quick-add-modal').hidden = false;
  $('#up-close').onclick = closeQuickAdd;
  $$('.user-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      const u = TEAM_USERS.find(x => x.id === uid);
      if (u) {
        setCurrentUser(u);
        closeQuickAdd();
        showToast(`👋 Olá, ${u.name.split(' ')[0]}!`, 'success');
      }
    });
  });
}

// ═══════════════════════════ CONSTANTS ═══════════════════════════
const COLOR_MAP = {
  red: '#f85149', red_dark: '#ff7b72', yellow_dark: '#e3b341',
  green: '#56d364', black: '#6e7681', lime: '#a5d6a7',
  blue_light: '#79c0ff', purple: '#d2a8ff', orange: '#f0883e',
  red_light: '#ffa198', yellow: '#e3b341', blue: '#58a6ff',
};
const LIST_ORDER = [
  'Backlog', 'To-Do', 'In Progress (Max 2/dev)', 'Blocked',
  'Testing / Sandbox', 'Done / Deployed', 'Icebox',
];
const SHORT_LIST = {
  'In Progress (Max 2/dev)': 'In Progress',
  'Testing / Sandbox': 'Sandbox',
  'Done / Deployed': 'Done',
};
const COL_CLASS = {
  'Blocked': 'col-blocked',
  'Testing / Sandbox': 'col-sandbox',
  'Done / Deployed': 'col-done',
};

// ═══════════════════════════ HELPERS ═══════════════════════════
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return [...document.querySelectorAll(sel)]; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(isoStr, opts = {}) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('pt-BR', {
    dateStyle: opts.short ? 'short' : 'short',
    timeStyle: opts.noTime ? undefined : 'short',
  });
}

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d atrás`;
  const mo = Math.floor(d / 30);
  return `${mo}mo atrás`;
}

function ageColor(days) {
  if (days === null || days === undefined) return '';
  if (days >= 14) return 'critical';
  if (days >= 7) return 'stale';
  return '';
}

function initials(name) {
  return name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function getEpic(cardName) {
  const m = cardName.match(/\[(\w+)\]/);
  return m ? m[1] : null;
}

function cleanTitle(name) {
  return name.replace(/^#?\d+\s*/, '').replace(/^\[\w+\]\s*/, '').trim();
}

function getPRsForCard(idShort) {
  if (!state.github || !state.github.cardLinks) return [];
  const link = state.github.cardLinks[idShort];
  return link ? link.prs : [];
}

function getCommitsForCard(idShort) {
  if (!state.github || !state.github.cardLinks) return [];
  const link = state.github.cardLinks[idShort];
  return link ? link.commits : [];
}

// ═══════════════════════════ DATA LOADING ═══════════════════════════
async function loadData(silent = false) {
  try {
    // Tenta primeiro o snapshot live (mais fresco), com fallback pro JSON estático
    let derived = null;
    try {
      const r = await fetch('/.netlify/functions/trello-snapshot?_=' + Date.now(), {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (r.ok) derived = await r.json();
    } catch {}

    if (!derived) {
      // Fallback: JSON estático
      const r = await fetch('data/derived.json?_=' + Date.now());
      if (!r.ok) throw new Error('derived.json não encontrado');
      derived = await r.json();
    }

    const [github, notesText] = await Promise.all([
      fetch('data/github.json?_=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('notes.md?_=' + Date.now()).then(r => r.ok ? r.text() : '').catch(() => ''),
    ]);

    const wasFresh = state.lastRefresh;
    state.derived = derived;
    state.github = github;
    state.notes = notesText;
    state.cardsByIdShort = {};
    for (const c of derived.cards) state.cardsByIdShort[c.idShort] = c;
    state.lastRefresh = derived.refreshedAt;

    renderHeader();
    render();

    // Toast quando dados mudaram via outra máquina
    if (silent && wasFresh && wasFresh !== derived.refreshedAt) {
      showToast('🔄 Dados atualizados', 'info');
    }
  } catch (e) {
    if (silent) return;
    $('#page').innerHTML = `
      <div class="empty" style="color: var(--red);">
        <strong>Erro carregando dados:</strong><br>${e.message}<br>
        <div class="hint">Rode <code>node refresh.js</code> na pasta do projeto.</div>
      </div>`;
  }
}

// Polling automático a cada 30s (só quando aba ativa)
function setupPolling() {
  if (state.pollingTimer) clearInterval(state.pollingTimer);
  state.pollingTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadData(true);
    }
  }, 30000);
  // Refresh imediato quando volta pra aba
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.lastRefresh) {
      const ageMs = Date.now() - new Date(state.lastRefresh).getTime();
      if (ageMs > 30000) loadData(true);
    }
  });
}

// ═══════════════════════════ HEADER ═══════════════════════════
function renderHeader() {
  const d = state.derived;
  const g = state.github;

  // Status pill
  const critCount = d.alerts.filter(a => a.severity === 'critical').length;
  const warnCount = d.alerts.filter(a => a.severity === 'warning').length;
  const pill = $('#status-pill');
  if (critCount > 0) {
    pill.className = 'status-pill red';
    pill.textContent = `🚨 ${critCount} crítico${critCount > 1 ? 's' : ''}`;
  } else if (warnCount > 0) {
    pill.className = 'status-pill yellow';
    pill.textContent = `⚠️ ${warnCount} alerta${warnCount > 1 ? 's' : ''}`;
  } else {
    pill.className = 'status-pill green';
    pill.textContent = '✅ Tudo em dia';
  }

  $('#status-meta').innerHTML = `
    ${d.counts.activeCards} ativos · ${timeAgo(d.refreshedAt)}
  `;

  // Top right links
  $('#trello-link').href = d.boardUrl || '#';
  if (g) {
    $('#api-link').href = g.repos.api.url;
    $('#web-link').href = g.repos.web.url;
  }

  // Nav badges
  setBadge('overview', d.alerts.length, d.alerts.some(a => a.severity === 'critical') ? '' : 'warn');
  if (g) {
    const conflicting = Object.values(g.repos).reduce((sum, r) => sum + r.prs.filter(p => p.mergeable === 'CONFLICTING').length, 0);
    const failedRuns = Object.values(g.repos).reduce((sum, r) => sum + (r.stats.runsLastFailure && (!r.stats.runsLastSuccess || new Date(r.stats.runsLastSuccess.createdAt) < new Date(r.stats.runsLastFailure.createdAt)) ? 1 : 0), 0);
    setBadge('github', conflicting + failedRuns, '');
  }
  const blocked = d.cards.filter(c => !c.cardClosed && !c.listClosed && c.list === 'Blocked').length;
  setBadge('cards', blocked, 'warn');
}

function setBadge(route, count, kind) {
  const el = $(`#badge-${route}`);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.className = `nav-badge show ${kind || ''}`;
  } else {
    el.className = 'nav-badge';
  }
}

// ═══════════════════════════ ROUTER ═══════════════════════════
function getRoute() {
  const hash = location.hash.replace(/^#\/?/, '') || 'overview';
  return hash.split('/')[0];
}

function navigate() {
  state.route = getRoute();
  $$('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === state.route);
  });
  render();
}

window.addEventListener('hashchange', navigate);

// ═══════════════════════════ RENDER ═══════════════════════════
function render() {
  if (!state.derived) return;
  const route = state.route;
  const renders = {
    overview: renderOverview,
    epics: renderEpicsPage,
    kanban: renderKanban,
    cards: renderCardsList,
    devs: renderDevs,
    github: renderGithub,
    timeline: renderTimeline,
    notes: renderNotes,
    docs: renderDocsPage,
  };
  const fn = renders[route] || renderOverview;
  $('#page').innerHTML = fn();
  bindCardClicks();
  bindFilterClicks();
}

// ═══════════════════════════ PAGE: OVERVIEW ═══════════════════════════
function renderOverview() {
  const d = state.derived;
  const g = state.github;
  const lists = d.counts.byList || {};

  // Stats
  let stats = `
    <div class="stats">
      <div class="stat"><div class="label">Backlog</div><div class="value">${lists['Backlog'] || 0}</div></div>
      <div class="stat"><div class="label">To-Do</div><div class="value">${lists['To-Do'] || 0}</div></div>
      <div class="stat"><div class="label">In Progress</div><div class="value">${lists['In Progress (Max 2/dev)'] || 0}</div><div class="sub">limite 2/dev</div></div>
      <div class="stat ${(lists['Blocked'] || 0) > 0 ? 'alert-stat' : ''}"><div class="label">Blocked</div><div class="value">${lists['Blocked'] || 0}</div></div>
      <div class="stat ${(lists['Testing / Sandbox'] || 0) > 5 ? 'warn-stat' : ''}"><div class="label">Sandbox</div><div class="value">${lists['Testing / Sandbox'] || 0}</div></div>
      <div class="stat"><div class="label">Done atual</div><div class="value" style="color:var(--green)">${lists['Done / Deployed'] || 0}</div></div>
    </div>
  `;

  // GitHub mini stats
  if (g) {
    const apiOpen = g.repos.api.prs.filter(p => p.state === 'OPEN').length;
    const webOpen = g.repos.web.prs.filter(p => p.state === 'OPEN').length;
    const conflicting = Object.values(g.repos).reduce((s, r) => s + r.prs.filter(p => p.mergeable === 'CONFLICTING').length, 0);
    stats += `
      <div class="stats" style="margin-top:-12px">
        <div class="stat"><div class="label">PRs API abertos</div><div class="value">${apiOpen}</div></div>
        <div class="stat"><div class="label">PRs Web abertos</div><div class="value">${webOpen}</div></div>
        <div class="stat ${conflicting ? 'alert-stat' : ''}"><div class="label">Conflicting</div><div class="value">${conflicting}</div></div>
      </div>
    `;
  }

  // Notas
  const notesHtml = state.notes && window.marked ? window.marked.parse(state.notes) : '';

  // Alertas
  const alerts = renderAlertsBlock(d.alerts);

  // Cards do usuário atual (usa trelloName pra match correto)
  const cur = getCurrentUser();
  const trelloName = cur && cur.trelloName ? cur.trelloName : null;
  const myCards = trelloName
    ? d.cards.filter(c => !c.cardClosed && !c.listClosed && c.members.some(m => m.name === trelloName))
    : [];
  const myInProgress = myCards.filter(c => c.list === 'In Progress (Max 2/dev)');
  const mySandbox = myCards.filter(c => c.list === 'Testing / Sandbox');
  const myBlocked = myCards.filter(c => c.list === 'Blocked');

  // Helper pra pegar idList por nome
  const getListId = (name) => {
    const l = state.derived.lists.find(x => x.name === name);
    return l ? l.id : '';
  };
  const inProgListId = getListId('In Progress (Max 2/dev)');
  const sandboxListId = getListId('Testing / Sandbox');
  const blockedListId = getListId('Blocked');

  const myCardsHtml = `
    <section class="section">
      <div class="section-header">
        <h2>${cur ? cur.emoji : '🎯'} Cards de ${cur ? escapeHtml(cur.name.split(' ')[0]) : 'você'} <span class="count">${myCards.length}</span></h2>
        <span class="meta">arrasta entre colunas · In Progress · Sandbox · Blocked</span>
      </div>
      <div class="kanban">
        <div class="kanban-col col-in-progress" data-list-id="${inProgListId}" data-list-name="In Progress (Max 2/dev)"><h3>In Progress <span class="count">${myInProgress.length}</span></h3><div class="cards-stack">${myInProgress.map(c => renderCardSmall(c, { draggable: true })).join('')}</div></div>
        <div class="kanban-col col-sandbox" data-list-id="${sandboxListId}" data-list-name="Testing / Sandbox"><h3>Sandbox <span class="count">${mySandbox.length}</span></h3><div class="cards-stack">${mySandbox.map(c => renderCardSmall(c, { draggable: true })).join('')}</div></div>
        <div class="kanban-col col-blocked" data-list-id="${blockedListId}" data-list-name="Blocked"><h3>Blocked <span class="count">${myBlocked.length}</span></h3><div class="cards-stack">${myBlocked.map(c => renderCardSmall(c, { draggable: true })).join('')}</div></div>
        ${myCards.length === 0 ? '<div class="empty">Nenhum card atribuído a você no momento — vá para Kanban e arraste cards aqui, ou crie um novo</div>' : ''}
      </div>
    </section>
  `;

  // Atividade GitHub do usuário
  const userPRs = cur ? getUserPRs(cur) : { open: [], merged: [], conflicting: [], total: 0 };
  const ghHtml = (cur && cur.githubLogin) ? `
    <section class="section">
      <div class="section-header">
        <h2>🐙 Atividade GitHub de ${escapeHtml(cur.name.split(' ')[0])} <span class="count">${userPRs.total}</span></h2>
        <span class="meta">login: <code>${cur.githubLogin}</code></span>
      </div>
      <div class="stats">
        <div class="stat ${userPRs.open.length > 0 ? '' : ''}"><div class="label">PRs abertos</div><div class="value">${userPRs.open.length}</div></div>
        <div class="stat ${userPRs.conflicting.length > 0 ? 'alert-stat' : ''}"><div class="label">Em conflito</div><div class="value">${userPRs.conflicting.length}</div></div>
        <div class="stat success-stat"><div class="label">Mergeados (14d)</div><div class="value">${userPRs.merged.length}</div></div>
      </div>
      ${userPRs.open.length ? `
        <div style="margin-top:12px">
          ${userPRs.open.slice(0, 5).map(pr => `
            <div class="pr-item" style="margin-bottom:6px">
              <span class="pr-state ${pr.isDraft ? 'DRAFT' : pr.state}">${pr.isDraft ? 'DRAFT' : pr.state}</span>
              <a href="${pr.url}" target="_blank" class="pr-num">${pr.repo}#${pr.number}</a>
              <span style="flex:1;color:var(--fg-muted)">${escapeHtml(pr.title.slice(0, 100))}</span>
              ${pr.mergeable === 'CONFLICTING' ? '<span class="conflict-tag">CONFLICT</span>' : ''}
              <span style="color:var(--fg-dim);font-size:11px">${timeAgo(pr.updatedAt)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </section>
  ` : '';

  return `
    <h1 class="page-title">📊 Overview</h1>
    <p class="page-subtitle">${cur ? `Olá, <strong style="color:${cur.color}">${escapeHtml(cur.name.split(' ')[0])}</strong> ${cur.emoji} · ` : ''}${state.derived.counts.activeCards} cards ativos · atualizado ${timeAgo(state.derived.refreshedAt)}</p>
    ${stats}
    ${renderMetrics()}
    ${notesHtml ? `<section class="section"><div class="section-header"><h2>📝 Minha Semana</h2><span class="meta">edita em <code>notes.md</code></span></div><div class="notes-card">${notesHtml}</div></section>` : ''}
    ${alerts}
    ${myCardsHtml}
    ${ghHtml}
  `;
}

function renderMetrics() {
  const m = state.derived.metrics;
  if (!m) return '';

  // Velocity bar chart
  const velocity = m.velocity || [];
  const maxVel = Math.max(1, ...velocity.map(v => v.count));
  const velocityBars = velocity.map(v => {
    const date = new Date(v.week);
    const label = `${date.getDate()}/${date.getMonth() + 1}`;
    const pct = (v.count / maxVel) * 100;
    return `<div class="bar ${v.count === 0 ? 'zero' : ''}" style="height:${Math.max(pct, 4)}%" data-value="${v.count}" data-label="${label}"></div>`;
  }).join('');

  // Age buckets horizontal bars
  const ageTotal = Object.values(m.ageBuckets || {}).reduce((s, c) => s + c, 0);
  const ageOrder = ['0-7d', '7-14d', '14-30d', '30-60d', '60d+'];
  const ageClass = { '0-7d': '', '7-14d': '', '14-30d': 'warn', '30-60d': 'warn', '60d+': 'critical' };
  const ageBars = ageOrder.map(b => {
    const count = m.ageBuckets[b] || 0;
    const pct = ageTotal > 0 ? (count / ageTotal) * 100 : 0;
    return `
      <div class="age-bar ${ageClass[b]}">
        <span class="age-label">${b}</span>
        <div class="age-track">
          <div class="age-fill" style="width:${Math.max(pct, count > 0 ? 4 : 0)}%">${count > 0 ? count : ''}</div>
        </div>
      </div>`;
  }).join('');

  // Top lead times
  const topLT = (m.leadTimes || []).slice(0, 8);
  const ltItems = topLT.map(l => {
    const cls = l.days > 30 ? 'critical' : l.days > 14 ? 'slow' : '';
    const card = state.cardsByIdShort[l.idShort];
    return `
      <div class="leadtime-item" ${card ? `data-card-id="${l.idShort}"` : ''}>
        <span class="lt-id">#${l.idShort}</span>
        <span class="lt-name">${escapeHtml(cleanTitle(l.name))}</span>
        <span class="lt-days ${cls}">${l.days}d</span>
      </div>`;
  }).join('');

  return `
    <section class="section">
      <div class="section-header">
        <h2>📈 Métricas do projeto</h2>
        <span class="meta">calculadas a partir do histórico do Trello</span>
      </div>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-title">⚡ Velocity</div>
          <div class="metric-big">${m.avgVelocity}<span style="font-size:14px;color:var(--fg-muted);font-weight:500"> cards/semana</span></div>
          <div class="metric-sub">Média das últimas ${velocity.length} semanas</div>
          <div class="bar-chart">${velocityBars}</div>
        </div>

        <div class="metric-card">
          <div class="metric-title">⏱️ Lead time médio</div>
          <div class="metric-big">${m.avgLeadTime}<span style="font-size:14px;color:var(--fg-muted);font-weight:500"> dias</span></div>
          <div class="metric-sub">Da criação até Done · ${(m.leadTimes || []).length} cards medidos</div>
          ${ltItems ? `<div class="leadtime-list">${ltItems}</div>` : ''}
        </div>

        <div class="metric-card">
          <div class="metric-title">📅 Distribuição por idade</div>
          <div class="metric-big">${ageTotal}<span style="font-size:14px;color:var(--fg-muted);font-weight:500"> cards ativos</span></div>
          <div class="metric-sub">Tempo desde a última atividade</div>
          <div class="age-bars">${ageBars}</div>
        </div>
      </div>
    </section>
  `;
}

function renderAlertsBlock(alerts) {
  if (!alerts.length) {
    return `
      <section class="section">
        <div class="section-header"><h2>🚦 Alertas</h2></div>
        <div class="empty">✅ Nenhum alerta — tudo em dia</div>
      </section>`;
  }
  const items = alerts.map(a => {
    const icon = { critical: '🚨', warning: '⚠️', info: 'ℹ️' }[a.severity] || '•';
    const link = a.url ? `<a href="${a.url}" target="_blank">${escapeHtml(a.text)}</a>` : escapeHtml(a.text);
    return `<div class="alert ${a.severity}"><span class="icon">${icon}</span><span class="text">${link}</span></div>`;
  }).join('');
  return `
    <section class="section">
      <div class="section-header"><h2>🚦 Alertas <span class="count">${alerts.length}</span></h2></div>
      <div class="alerts">${items}</div>
    </section>`;
}

// ═══════════════════════════ PAGE: EPICS ═══════════════════════════
function renderEpicsPage() {
  const d = state.derived;
  const epics = d.epics || [];

  // Aggregate stats
  const totalActive = d.cards.filter(c => !c.cardClosed && !c.listClosed).length;
  const totalDone = d.cards.filter(c => c.status === 'done').length;
  const totalBlocked = d.cards.filter(c => c.status === 'blocked').length;
  const overall = epics.reduce((acc, e) => acc + e.completionPct, 0) / (epics.length || 1);

  const cards = epics.map(e => `
    <div class="epic-card" data-epic-key="${e.key}" style="--epic-color: var(--epic-${e.key}, var(--accent))">
      <div class="epic-header">
        <span class="epic-icon">${e.icon || '📦'}</span>
        <div>
          <div class="epic-key">${e.key}</div>
          <div class="epic-name">${escapeHtml(e.name || '')}</div>
        </div>
        <span class="epic-priority ${e.priority || 'P3'}">${e.priority || 'P3'}</span>
      </div>
      <div class="epic-progress">
        <div class="epic-progress-bar">
          <div class="epic-progress-fill" style="width:${e.completionPct}%; background: var(--epic-${e.key}, var(--accent))"></div>
        </div>
        <span class="epic-progress-pct">${e.completionPct}%</span>
      </div>
      <div class="epic-stats">
        <span>📋 <span class="num">${e.total}</span> total</span>
        ${e.done > 0 ? `<span>✅ <span class="num">${e.done}</span></span>` : ''}
        ${e.testing > 0 ? `<span>🧪 <span class="num">${e.testing}</span></span>` : ''}
        ${e.inProgress > 0 ? `<span>🟡 <span class="num">${e.inProgress}</span></span>` : ''}
        ${e.blocked > 0 ? `<span style="color:var(--red)">⏸️ <span class="num">${e.blocked}</span></span>` : ''}
        ${e.todo > 0 ? `<span>📌 <span class="num">${e.todo}</span></span>` : ''}
        ${e.backlog > 0 ? `<span>📦 <span class="num">${e.backlog}</span></span>` : ''}
        ${e.icebox > 0 ? `<span>❄️ <span class="num">${e.icebox}</span></span>` : ''}
      </div>
      <div class="epic-status-tag">
        <span>${e.statusLabel}</span>
        <span style="color:var(--fg-dim);font-weight:500">ver cards →</span>
      </div>
    </div>
  `).join('');

  // Detalhe expandido se tem filter de epic
  const focusEpic = state.filter.epic;
  let detail = '';
  if (focusEpic) {
    const epicMeta = epics.find(e => e.key === focusEpic);
    // Mostra TODOS os cards do EPIC (ativos + arquivados/done)
    const epicCards = d.cards.filter(c => c.epic === focusEpic);
    const activeCount = epicCards.filter(c => !c.cardClosed && !c.listClosed).length;
    const archivedCount = epicCards.length - activeCount;
    detail = `
      <section class="section epic-drill-detail" id="epic-drill-detail" style="margin-top:32px">
        <div class="section-header">
          <h2>${epicMeta ? epicMeta.icon + ' ' : ''}EPIC ${focusEpic}: ${epicMeta ? escapeHtml(epicMeta.name) : ''} <span class="count">${epicCards.length}</span></h2>
          <button id="epic-clear-btn" style="padding: 4px 10px; font-size: 12px;">✕ limpar filtro</button>
        </div>
        <table class="list">
          <thead><tr><th>ID</th><th>Tipo</th><th>Título</th><th>Lista</th><th>Prioridade</th><th>PR</th><th>Devs</th><th>Idade</th></tr></thead>
          <tbody>${epicCards.sort((a, b) => a.priorityNum - b.priorityNum || (b.ageDays || 0) - (a.ageDays || 0)).map(c => {
            const prs = getPRsForCard(c.idShort);
            const openPR = prs.find(p => p.state === 'OPEN');
            const mergedPR = prs.find(p => p.state === 'MERGED');
            const prCell = openPR
              ? `<span class="pr-state OPEN">PR #${openPR.number}</span>${openPR.mergeable === 'CONFLICTING' ? '<span class="conflict-tag">CONFLICT</span>' : ''}`
              : mergedPR
              ? `<span class="pr-state MERGED">PR #${mergedPR.number}</span>`
              : '—';
            return `
              <tr data-card-id="${c.idShort}">
                <td><strong>#${c.idShort}</strong></td>
                <td><span style="color:var(--fg-muted);font-size:11px">${c.tipo}</span></td>
                <td>${escapeHtml(cleanTitle(c.name))}</td>
                <td><span style="color:var(--fg-muted);font-size:11px">${c.list === 'In Progress (Max 2/dev)' ? 'In Progress' : c.list}</span></td>
                <td>${c.priorityCode}</td>
                <td>${prCell}</td>
                <td><div style="display:flex;gap:2px">${c.members.map(m => `<span class="avatar" data-tooltip="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join('')}</div></td>
                <td class="age-cell ${ageColor(c.ageDays)}">${c.ageDays != null ? c.ageDays + 'd' : '—'}</td>
              </tr>
            `;
          }).join('')}</tbody>
        </table>
      </section>
    `;
  }

  return `
    <h1 class="page-title">🎯 EPICs do Roadmap</h1>
    <p class="page-subtitle">Painel de progresso por domínio — clique num EPIC pra ver os cards</p>

    <div class="stats">
      <div class="stat success-stat"><div class="label">Progresso geral</div><div class="value">${Math.round(overall)}%</div></div>
      <div class="stat"><div class="label">EPICs ativos</div><div class="value">${epics.length}</div></div>
      <div class="stat"><div class="label">Cards ativos</div><div class="value">${totalActive}</div></div>
      <div class="stat success-stat"><div class="label">Concluídos</div><div class="value">${totalDone}</div></div>
      <div class="stat ${totalBlocked > 0 ? 'alert-stat' : ''}"><div class="label">Bloqueados</div><div class="value">${totalBlocked}</div></div>
    </div>

    <div class="epics-grid">${cards}</div>

    ${detail}
  `;
}

// ═══════════════════════════ PAGE: KANBAN ═══════════════════════════
function renderKanban() {
  const d = state.derived;
  const active = d.cards.filter(c => !c.cardClosed && !c.listClosed && c.list !== 'Icebox');
  const filtered = applyFilters(active);

  const grouped = {};
  for (const c of filtered) (grouped[c.list] = grouped[c.list] || []).push(c);

  // Inclui TODAS as listas abertas do board (não só LIST_ORDER) pra suportar listas custom
  const allOpenLists = state.derived.lists
    .filter(l => !l.closed && l.name !== 'Icebox')
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  const cols = allOpenLists.map(list => {
    const listName = list.name;
    const cards = (grouped[listName] || []).sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
    const colCls = COL_CLASS[listName] || '';
    return `
      <div class="kanban-col ${colCls}" data-list-id="${list.id}" data-list-name="${escapeHtml(listName)}">
        <h3 class="list-header">
          <span class="list-name" data-list-id="${list.id}" title="click pra renomear">${SHORT_LIST[listName] || escapeHtml(listName)}</span>
          <span class="count">${cards.length}</span>
          <button class="list-menu-btn" data-list-id="${list.id}" title="ações da lista">⋮</button>
        </h3>
        <div class="cards-stack">${cards.map(c => renderCardSmall(c, { draggable: true })).join('')}</div>
        <button class="add-card-inline" data-list-id="${list.id}" data-list-name="${escapeHtml(listName)}">+ Adicionar card</button>
      </div>`;
  }).join('');

  const addListCol = `
    <div class="kanban-col add-list-col">
      <button class="add-list-btn" id="add-list-btn">+ Adicionar lista</button>
    </div>
  `;

  return `
    <h1 class="page-title">📋 Kanban</h1>
    <p class="page-subtitle">${filtered.length} cards · arrasta entre colunas · click no card pra editar · click no nome da lista pra renomear</p>
    ${renderFilters()}
    <div class="kanban">${cols}${addListCol}</div>`;
}

// ═══════════════════════════ PAGE: CARDS LIST ═══════════════════════════
function renderCardsList() {
  const d = state.derived;
  const active = d.cards.filter(c => !c.cardClosed && !c.listClosed && c.list !== 'Icebox');
  const filtered = applyFilters(active);
  const sorted = filtered.sort((a, b) => {
    // Critical priority first
    const aP = priorityOrder(a);
    const bP = priorityOrder(b);
    if (aP !== bP) return aP - bP;
    return (b.ageDays || 0) - (a.ageDays || 0);
  });

  const rows = sorted.map(c => {
    const epic = getEpic(c.name);
    const epicTag = epic ? `<span class="epic-tag" style="color:var(--epic-${epic})">${epic}</span>` : '';
    const prs = getPRsForCard(c.idShort);
    const openPR = prs.find(p => p.state === 'OPEN');
    const mergedPR = prs.find(p => p.state === 'MERGED');
    const prCell = openPR
      ? `<span class="pr-state OPEN">PR #${openPR.number}</span>${openPR.mergeable === 'CONFLICTING' ? '<span class="conflict-tag">CONFLICT</span>' : ''}`
      : mergedPR
      ? `<span class="pr-state MERGED">PR #${mergedPR.number}</span>`
      : '';
    const memberAvatars = c.members.map(m => `<span class="avatar" data-tooltip="${m.name}">${initials(m.name)}</span>`).join('');
    const ageClass = ageColor(c.ageDays);
    const priorityLabel = c.labels.find(l => /^\d /.test(l.name || ''));
    return `
      <tr data-card-id="${c.idShort}">
        <td><strong>#${c.idShort}</strong></td>
        <td>${epicTag}</td>
        <td>${escapeHtml(cleanTitle(c.name))}</td>
        <td><span style="color:var(--fg-muted);font-size:11px">${c.list === 'In Progress (Max 2/dev)' ? 'In Progress' : c.list}</span></td>
        <td>${priorityLabel ? `<span style="color:${COLOR_MAP[priorityLabel.color]}">●</span> ${priorityLabel.name.split(' ').slice(1).join(' ')}` : '—'}</td>
        <td>${prCell || '—'}</td>
        <td><div style="display:flex;gap:2px">${memberAvatars}</div></td>
        <td class="age-cell ${ageClass}">${c.ageDays != null ? c.ageDays + 'd' : '—'}</td>
      </tr>
    `;
  }).join('');

  return `
    <h1 class="page-title">🗂️ Cards ativos</h1>
    <p class="page-subtitle">${filtered.length} cards · ordenados por prioridade e idade · clique numa linha pra ver detalhes</p>
    ${renderFilters()}
    <table class="list">
      <thead>
        <tr>
          <th>ID</th><th>EPIC</th><th>Título</th><th>Lista</th><th>Prioridade</th><th>PR</th><th>Devs</th><th>Idade</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function priorityOrder(c) {
  const p = c.labels.find(l => /^\d /.test(l.name || ''));
  if (!p) return 5;
  return parseInt(p.name[0], 10);
}

// ═══════════════════════════ PAGE: DEVS ═══════════════════════════
function renderDevs() {
  const d = state.derived;
  const g = state.github;
  const devs = Object.entries(d.byDev).sort((a, b) => {
    const aT = a[1].inProgress.length + a[1].sandbox.length + a[1].blocked.length;
    const bT = b[1].inProgress.length + b[1].sandbox.length + b[1].blocked.length;
    return bT - aT;
  });

  const cards = devs.map(([name, work]) => {
    const overWip = work.inProgress.length > 2;
    // PRs por dev
    const prs = g ? Object.values(g.repos).flatMap(r => r.prs.filter(p => p.author && p.state === 'OPEN')) : [];
    return `
      <div class="dev-card ${overWip ? 'over-wip' : ''}">
        <div class="dev-header">
          <span class="avatar-lg">${initials(name)}</span>
          <div>
            <div class="dev-name">${name}</div>
            <div class="dev-meta">${work.inProgress.length + work.sandbox.length + work.blocked.length} cards ativos</div>
          </div>
        </div>
        <div class="row"><span class="label-tag">In Progress</span><span class="count ${overWip ? 'warn' : ''}">${work.inProgress.length}/2</span></div>
        ${work.inProgress.length ? `<ul class="cards-list">${work.inProgress.map(c => `<li data-card-id="${c.idShort}">#${c.idShort} ${escapeHtml(cleanTitle(c.name))}</li>`).join('')}</ul>` : ''}
        <div class="row"><span class="label-tag">Sandbox</span><span class="count">${work.sandbox.length}</span></div>
        ${work.sandbox.length ? `<ul class="cards-list">${work.sandbox.map(c => `<li data-card-id="${c.idShort}">#${c.idShort} ${escapeHtml(cleanTitle(c.name))}</li>`).join('')}</ul>` : ''}
        <div class="row"><span class="label-tag">Blocked</span><span class="count">${work.blocked.length}</span></div>
        ${work.blocked.length ? `<ul class="cards-list">${work.blocked.map(c => `<li data-card-id="${c.idShort}">#${c.idShort} ${escapeHtml(cleanTitle(c.name))}</li>`).join('')}</ul>` : ''}
      </div>`;
  }).join('');

  return `
    <h1 class="page-title">👥 Carga por dev</h1>
    <p class="page-subtitle">${devs.length} devs com cards ativos · In Progress + Sandbox + Blocked</p>
    <div class="devs">${cards}</div>`;
}

// ═══════════════════════════ PAGE: GITHUB ═══════════════════════════
function renderGithub() {
  const g = state.github;
  if (!g) {
    return `
      <div class="empty">
        Sem dados do GitHub. Rode <code>node gh-sync.js</code>.
        <div class="hint">Precisa do <code>gh</code> CLI autenticado como <code>lukasvilela</code>.</div>
      </div>`;
  }

  let html = `
    <h1 class="page-title">🐙 GitHub</h1>
    <p class="page-subtitle">PRs, deploys e commits dos repos do projeto · sync ${timeAgo(g.fetchedAt)}</p>`;

  for (const [key, repo] of Object.entries(g.repos)) {
    const open = repo.prs.filter(p => p.state === 'OPEN');
    const conflicting = open.filter(p => p.mergeable === 'CONFLICTING');
    const draft = open.filter(p => p.isDraft);
    const lastSuccess = repo.stats.runsLastSuccess;
    const lastFailure = repo.stats.runsLastFailure;
    const deployBroken = lastFailure && (!lastSuccess || new Date(lastSuccess.createdAt) < new Date(lastFailure.createdAt));

    html += `
      <section class="section">
        <div class="section-header">
          <h2>${repo.full} ${deployBroken ? '<span style="color:var(--red);font-size:13px;font-weight:500">⚠ deploy quebrado</span>' : ''}</h2>
          <a href="${repo.url}" target="_blank" class="ext-link">abrir →</a>
        </div>
        <div class="stats" style="margin-bottom:14px">
          <div class="stat"><div class="label">PRs abertos</div><div class="value">${open.length}</div><div class="sub">${draft.length} draft</div></div>
          <div class="stat ${conflicting.length ? 'alert-stat' : ''}"><div class="label">Conflicting</div><div class="value">${conflicting.length}</div></div>
          <div class="stat"><div class="label">Mergeados (7d)</div><div class="value" style="color:var(--purple)">${repo.stats.mergedRecent}</div></div>
          <div class="stat ${deployBroken ? 'alert-stat' : ''}"><div class="label">Último deploy</div><div class="value" style="font-size:14px">${deployBroken ? '🔴' : '🟢'} ${timeAgo((lastSuccess || lastFailure || {}).createdAt)}</div></div>
        </div>
        ${renderPRTable(open, repo.full)}
      </section>`;
  }

  return html;
}

function renderPRTable(prs, repoFull) {
  if (!prs.length) {
    return `<div class="empty">Nenhum PR aberto neste repo</div>`;
  }
  const rows = prs.map(pr => {
    const cardId = (pr.title.match(/#(\d+)/) || [])[1];
    const card = cardId ? state.cardsByIdShort[parseInt(cardId, 10)] : null;
    return `
      <tr ${card ? `data-card-id="${card.idShort}"` : ''}>
        <td><a href="${pr.url}" target="_blank">#${pr.number}</a></td>
        <td>${escapeHtml(pr.title)}</td>
        <td><span class="pr-state ${pr.isDraft ? 'DRAFT' : pr.state}">${pr.isDraft ? 'DRAFT' : pr.state}</span>${pr.mergeable === 'CONFLICTING' ? '<span class="conflict-tag">CONFLICT</span>' : ''}</td>
        <td><span style="color:var(--fg-muted);font-size:11px">${pr.author || '—'}</span></td>
        <td>+${pr.additions || 0}/-${pr.deletions || 0}</td>
        <td class="age-cell ${ageColor(Math.floor((Date.now() - new Date(pr.updatedAt).getTime()) / 86400000))}">${timeAgo(pr.updatedAt)}</td>
        <td>${card ? `→ #${card.idShort}` : '—'}</td>
      </tr>
    `;
  }).join('');
  return `
    <table class="list">
      <thead><tr><th>PR</th><th>Título</th><th>Estado</th><th>Autor</th><th>Δ</th><th>Atualizado</th><th>Card</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ═══════════════════════════ PAGE: TIMELINE ═══════════════════════════
function renderTimeline() {
  const events = [];
  const g = state.github;

  if (g) {
    for (const repo of Object.values(g.repos)) {
      for (const pr of repo.prs) {
        if (pr.mergedAt) {
          events.push({ type: 'pr_merged', date: pr.mergedAt, pr, repo: repo.full });
        } else if (pr.state === 'CLOSED' && pr.closedAt) {
          events.push({ type: 'pr_closed', date: pr.closedAt, pr, repo: repo.full });
        } else if (pr.state === 'OPEN') {
          events.push({ type: 'pr_open', date: pr.createdAt, pr, repo: repo.full });
        }
      }
      for (const c of repo.commits.slice(0, 15)) {
        events.push({ type: 'commit', date: c.date, commit: c, repo: repo.full });
      }
      for (const r of repo.runs.slice(0, 5)) {
        events.push({ type: 'run', date: r.createdAt, run: r, repo: repo.full });
      }
    }
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = events.slice(0, 80);

  const items = recent.map(ev => {
    const cardId = ev.pr ? (ev.pr.title.match(/#(\d+)/) || [])[1]
                : ev.commit ? (ev.commit.message.match(/#(\d+)/) || [])[1]
                : null;
    const card = cardId ? state.cardsByIdShort[parseInt(cardId, 10)] : null;

    if (ev.type === 'pr_merged') {
      return `<div class="timeline-item">
        <span class="timeline-icon">🟣</span>
        <div class="timeline-content">
          <div><a href="${ev.pr.url}" target="_blank">PR #${ev.pr.number}</a> mergeado em <code>${ev.repo.split('/')[1]}</code> — ${escapeHtml(ev.pr.title.slice(0, 100))}</div>
          <div class="who-when">${ev.pr.author || '—'} · ${formatDate(ev.date)} · ${timeAgo(ev.date)}${card ? ` · <a href="#" data-card-id="${card.idShort}">→ card</a>` : ''}</div>
        </div>
      </div>`;
    }
    if (ev.type === 'pr_open') {
      return `<div class="timeline-item">
        <span class="timeline-icon">🟢</span>
        <div class="timeline-content">
          <div><a href="${ev.pr.url}" target="_blank">PR #${ev.pr.number}</a> aberto em <code>${ev.repo.split('/')[1]}</code> — ${escapeHtml(ev.pr.title.slice(0, 100))}</div>
          <div class="who-when">${ev.pr.author || '—'} · ${timeAgo(ev.date)}${card ? ` · <a href="#" data-card-id="${card.idShort}">→ card</a>` : ''}</div>
        </div>
      </div>`;
    }
    if (ev.type === 'pr_closed') {
      return `<div class="timeline-item">
        <span class="timeline-icon">⚫</span>
        <div class="timeline-content">
          <div><a href="${ev.pr.url}" target="_blank">PR #${ev.pr.number}</a> fechado sem merge — ${escapeHtml(ev.pr.title.slice(0, 100))}</div>
          <div class="who-when">${timeAgo(ev.date)}</div>
        </div>
      </div>`;
    }
    if (ev.type === 'commit') {
      return `<div class="timeline-item">
        <span class="timeline-icon">📝</span>
        <div class="timeline-content">
          <div><a href="${ev.commit.url}" target="_blank"><code class="commit-sha">${ev.commit.sha.slice(0,7)}</code></a> em <code>${ev.repo.split('/')[1]}</code>: ${escapeHtml(ev.commit.message.split('\n')[0].slice(0, 100))}</div>
          <div class="who-when">${ev.commit.author} · ${timeAgo(ev.date)}${card ? ` · <a href="#" data-card-id="${card.idShort}">→ card</a>` : ''}</div>
        </div>
      </div>`;
    }
    if (ev.type === 'run') {
      const icon = ev.run.conclusion === 'success' ? '✅' : ev.run.conclusion === 'failure' ? '🔴' : '⏳';
      return `<div class="timeline-item">
        <span class="timeline-icon">${icon}</span>
        <div class="timeline-content">
          <div><a href="${ev.run.url}" target="_blank">${escapeHtml(ev.run.workflowName || 'workflow')}</a> em <code>${ev.repo.split('/')[1]}</code> — ${ev.run.conclusion || ev.run.status}</div>
          <div class="who-when">${escapeHtml(ev.run.headBranch || '')} · ${timeAgo(ev.date)}</div>
        </div>
      </div>`;
    }
    return '';
  }).join('');

  return `
    <h1 class="page-title">⏱️ Timeline</h1>
    <p class="page-subtitle">${recent.length} eventos recentes · PRs, commits e runs do GitHub</p>
    ${recent.length ? `<div class="timeline">${items}</div>` : '<div class="empty">Sem dados — rode <code>node gh-sync.js</code></div>'}`;
}

// ═══════════════════════════ PAGE: NOTES ═══════════════════════════
function renderNotes() {
  const html = state.notes && window.marked ? window.marked.parse(state.notes) : '';
  return `
    <h1 class="page-title">📝 Notas executivas</h1>
    <p class="page-subtitle">Edita o arquivo <code>notes.md</code> · salva e recarrega esta página</p>
    <div class="notes-card">${html || '<div class="empty">Sem notas. Edita o arquivo <code>notes.md</code>.</div>'}</div>`;
}

// ═══════════════════════════ PAGE: DOCS ═══════════════════════════
const DOCS_INDEX = [
  { num: '00', file: 'README.md',                  title: 'Índice', icon: '📚' },
  { num: '01', file: '01-visao-geral.md',          title: 'Visão Geral', icon: '🎯' },
  { num: '02', file: '02-arquitetura.md',          title: 'Arquitetura', icon: '🏗️' },
  { num: '03', file: '03-modulos-prontos.md',      title: 'Módulos Prontos', icon: '✅' },
  { num: '04', file: '04-modulos-pendentes.md',    title: 'Módulos Pendentes', icon: '⏳' },
  { num: '05', file: '05-infraestrutura.md',       title: 'Infraestrutura', icon: '🐳' },
  { num: '06', file: '06-multi-perfil.md',         title: 'Multi-perfil PJ/PF/Admin', icon: '👥' },
  { num: '07', file: '07-feature-flags.md',        title: 'Feature Flags', icon: '🚩' },
  { num: '08', file: '08-epics-user-stories.md',   title: 'EPICs e User Stories', icon: '📋' },
  { num: '09', file: '09-pendencias.md',           title: 'Pendências', icon: '🔥' },
  { num: '10', file: '10-guia-desenvolvimento.md', title: 'Guia de Desenvolvimento', icon: '🛠️' },
  { num: '11', file: '11-convencoes.md',           title: 'Convenções e Padrões', icon: '📐' },
  { num: '12', file: '12-glossario.md',            title: 'Glossário', icon: '📖' },
];

let docsCache = {};
let currentDocFile = null;

function renderDocsPage() {
  const hash = location.hash;
  const m = hash.match(/^#\/docs\/?([^?]*)/);
  const slug = m && m[1] ? decodeURIComponent(m[1].split('#')[0]) : 'README.md';
  currentDocFile = slug;

  // Search input
  const searchHtml = `
    <div class="docs-search-wrap">
      <input type="search" id="docs-search" class="docs-search" placeholder="🔎 Buscar nas docs (todos os arquivos)…" autocomplete="off">
      <div class="docs-search-results" id="docs-search-results"></div>
    </div>
  `;

  const navItems = DOCS_INDEX.map(d => {
    const active = d.file === slug;
    return `
      <a href="#/docs/${encodeURIComponent(d.file)}" class="docs-nav-item ${active ? 'active' : ''}">
        <span class="docs-nav-num">${d.num}</span>
        <span class="docs-nav-icon">${d.icon}</span>
        <span class="docs-nav-title">${escapeHtml(d.title)}</span>
      </a>`;
  }).join('');

  // Breadcrumbs
  const currentDoc = DOCS_INDEX.find(d => d.file === slug);
  const breadcrumbs = `
    <nav class="docs-breadcrumb">
      <a href="#/docs/README.md">📚 Docs</a>
      <span class="sep">/</span>
      <span class="current">${currentDoc ? `${currentDoc.icon} ${escapeHtml(currentDoc.title)}` : escapeHtml(slug)}</span>
    </nav>
  `;

  // Carrega o doc atual (lazy)
  loadDocAndRender(slug);

  return `
    <div class="docs-progress-bar" id="docs-progress"></div>
    <h1 class="page-title">📚 Documentação</h1>
    <p class="page-subtitle">Centro de comando · 13 documentos navegáveis · busca, scroll-spy e cross-links</p>
    ${searchHtml}
    <div class="docs-layout">
      <aside class="docs-sidebar">
        <div class="docs-sidebar-title">📖 Índice</div>
        ${navItems}
        <div class="docs-source-link">
          <a href="${(CONFIG && CONFIG.project && CONFIG.project.repoUrl) || '#'}/tree/main/docs" target="_blank">📂 Editar no GitHub</a>
        </div>
      </aside>
      <article class="docs-main">
        ${breadcrumbs}
        <div class="docs-content" id="docs-content">
          <div class="loading">Carregando…</div>
        </div>
      </article>
    </div>`;
}

async function loadDocAndRender(slug) {
  const tryFetch = async (url) => {
    try {
      const r = await fetch(url + '?_=' + Date.now());
      if (!r.ok) return null;
      return await r.text();
    } catch { return null; }
  };

  let raw = docsCache[slug];
  if (!raw) {
    raw = await tryFetch(`docs/${slug}`);
    if (raw) docsCache[slug] = raw;
  }

  // Wait for DOM
  await new Promise(r => setTimeout(r, 0));
  const target = document.getElementById('docs-content');
  if (!target) return;
  if (currentDocFile !== slug) return; // user changed page meanwhile

  if (!raw) {
    target.innerHTML = `<div class="empty">Documento não encontrado: <code>${escapeHtml(slug)}</code></div>`;
    return;
  }

  // Render markdown
  const html = window.marked
    ? window.marked.parse(raw, { mangle: false, headerIds: true })
    : `<pre>${escapeHtml(raw)}</pre>`;

  // Build TOC from h2/h3
  const tocItems = [];
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  let idCounter = 0;
  tempDiv.querySelectorAll('h2, h3').forEach(h => {
    const text = h.textContent;
    const id = `doc-h-${idCounter++}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    h.id = id;
    tocItems.push({ level: h.tagName === 'H2' ? 2 : 3, text, id });
  });

  // Rewrite cross-links between docs
  tempDiv.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) return;
    if (href.endsWith('.md') || href.match(/^\d+-/)) {
      // Doc interno → SPA link
      const target = href.replace(/^\.\//, '').split('#')[0];
      const anchor = href.includes('#') ? href.substring(href.indexOf('#')) : '';
      a.setAttribute('href', `#/docs/${encodeURIComponent(target)}${anchor}`);
      a.removeAttribute('target');
    } else if (href.startsWith('../')) {
      // Link external relativo (CLAUDE_NEW_DEV.md, _BOARD_INDEX.md, etc.)
      a.setAttribute('href', `${(CONFIG && CONFIG.project && CONFIG.project.repoUrl) || '#'}/blob/main/docs/${href.replace(/^\.\.\//, '../')}`);
      a.setAttribute('target', '_blank');
    }
  });

  const tocHtml = tocItems.length > 1
    ? `<aside class="docs-toc">
        <div class="docs-toc-title">Nesta página</div>
        ${tocItems.map(t => `<a href="#${t.id}" class="docs-toc-link toc-${t.level}">${escapeHtml(t.text)}</a>`).join('')}
      </aside>`
    : '';

  // Prev / Next navigation
  const idx = DOCS_INDEX.findIndex(d => d.file === slug);
  const prev = idx > 0 ? DOCS_INDEX[idx - 1] : null;
  const next = idx >= 0 && idx < DOCS_INDEX.length - 1 ? DOCS_INDEX[idx + 1] : null;
  const prevNextHtml = `
    <nav class="docs-prevnext">
      ${prev ? `
        <a href="#/docs/${encodeURIComponent(prev.file)}" class="docs-prevnext-link prev">
          <span class="dpn-label">← Anterior</span>
          <span class="dpn-title">${prev.icon} ${escapeHtml(prev.title)}</span>
        </a>` : '<span></span>'}
      ${next ? `
        <a href="#/docs/${encodeURIComponent(next.file)}" class="docs-prevnext-link next">
          <span class="dpn-label">Próximo →</span>
          <span class="dpn-title">${next.icon} ${escapeHtml(next.title)}</span>
        </a>` : '<span></span>'}
    </nav>
  `;

  // Reading time estimate
  const wordCount = (raw.match(/\w+/g) || []).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));
  const meta = `
    <div class="docs-meta-line">
      <span>📄 ${slug}</span>
      <span>·</span>
      <span>📝 ${wordCount.toLocaleString('pt-BR')} palavras</span>
      <span>·</span>
      <span>⏱️ ~${readingTime} min de leitura</span>
    </div>
  `;

  target.innerHTML = `${tocHtml}<div class="docs-body" id="docs-body">${meta}<div class="docs-body-content">${tempDiv.innerHTML}</div>${prevNextHtml}</div>`;

  // Animate fade-in
  requestAnimationFrame(() => {
    const body = document.getElementById('docs-body');
    if (body) body.classList.add('visible');
  });

  // Setup scroll-spy on TOC links
  setupTocScrollSpy(tocItems);
  setupReadingProgress();

  // Smooth scroll to anchor if hash includes #
  const fullHash = location.hash;
  const anchorMatch = fullHash.match(/#\/docs\/[^#]*#(.+)$/);
  if (anchorMatch) {
    setTimeout(() => {
      const el = document.getElementById(anchorMatch[1]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  } else {
    // scroll to top of body when entering doc
    document.querySelector('.page')?.scrollTo({ top: 0, behavior: 'auto' });
  }
}

let tocObserver = null;
function setupTocScrollSpy(tocItems) {
  if (tocObserver) tocObserver.disconnect();
  if (!tocItems || !tocItems.length) return;
  const tocLinks = $$('.docs-toc-link');
  tocObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        tocLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id));
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  tocItems.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) tocObserver.observe(el);
  });
}

let progressRafId = null;
function setupReadingProgress() {
  const bar = $('#docs-progress');
  const page = document.querySelector('.page');
  if (!bar || !page) return;
  const update = () => {
    const max = page.scrollHeight - page.clientHeight;
    const pct = max > 0 ? Math.min(100, (page.scrollTop / max) * 100) : 0;
    bar.style.width = pct + '%';
    progressRafId = null;
  };
  if (page._docsProgressBound) return;
  page._docsProgressBound = true;
  page.addEventListener('scroll', () => {
    if (progressRafId) return;
    progressRafId = requestAnimationFrame(update);
  });
  update();
}

// ═══════════ Docs cross-doc search ═══════════
let docsSearchDebounce;
async function setupDocsSearch() {
  const input = $('#docs-search');
  const results = $('#docs-search-results');
  if (!input || !results) return;

  // Pre-load all docs (cached)
  for (const d of DOCS_INDEX) {
    if (!docsCache[d.file]) {
      try {
        const r = await fetch(`docs/${d.file}?_=` + Date.now());
        if (r.ok) docsCache[d.file] = await r.text();
      } catch {}
    }
  }

  input.addEventListener('input', e => {
    clearTimeout(docsSearchDebounce);
    docsSearchDebounce = setTimeout(() => doDocsSearch(e.target.value), 200);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => results.classList.remove('show'), 200);
  });
  input.addEventListener('focus', e => {
    if (e.target.value) doDocsSearch(e.target.value);
  });
}

function doDocsSearch(q) {
  const results = $('#docs-search-results');
  q = q.trim().toLowerCase();
  if (!q || q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }

  const matches = [];
  for (const d of DOCS_INDEX) {
    const text = (docsCache[d.file] || '').toLowerCase();
    let from = 0;
    let count = 0;
    while ((from = text.indexOf(q, from)) !== -1 && count < 3) {
      const start = Math.max(0, from - 40);
      const end = Math.min(text.length, from + q.length + 60);
      const snippet = text.slice(start, end).replace(/\n+/g, ' ');
      matches.push({ doc: d, snippet, pos: from });
      from += q.length;
      count++;
    }
  }
  matches.sort((a, b) => DOCS_INDEX.indexOf(a.doc) - DOCS_INDEX.indexOf(b.doc));

  if (!matches.length) {
    results.innerHTML = '<div class="docs-search-result"><span style="color:var(--fg-muted)">Nada encontrado</span></div>';
    results.classList.add('show');
    return;
  }

  results.innerHTML = matches.slice(0, 15).map(m => {
    const highlighted = escapeHtml(m.snippet).replace(
      new RegExp(escapeRegex(q), 'gi'),
      match => `<mark>${match}</mark>`
    );
    return `
      <a class="docs-search-result" href="#/docs/${encodeURIComponent(m.doc.file)}">
        <span class="kind">${m.doc.icon} ${m.doc.num}</span>
        <span class="title">${escapeHtml(m.doc.title)}</span>
        <span class="snippet">…${highlighted}…</span>
      </a>
    `;
  }).join('');
  results.classList.add('show');
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ═══════════════════════════ FILTERS ═══════════════════════════
function applyFilters(cards) {
  return cards.filter(c => {
    if (state.filter.dev && !c.members.some(m => m.name === state.filter.dev)) return false;
    if (state.filter.label && !c.labels.some(l => l.name === state.filter.label)) return false;
    if (state.filter.epic && getEpic(c.name) !== state.filter.epic) return false;
    if (state.filter.search) {
      const q = state.filter.search.toLowerCase();
      const hay = `${c.idShort} ${c.name} ${c.members.map(m => m.name).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilters() {
  const d = state.derived;
  const devs = d.members.map(m => m.name).sort();
  const epics = [...new Set(d.cards.filter(c => !c.cardClosed && !c.listClosed).map(c => getEpic(c.name)).filter(Boolean))].sort();
  const priorityLabels = ['1 Critico', '2 Alta', '3 Média', '4 Baixa'];
  const f = state.filter;
  const active = !!(f.dev || f.label || f.epic);
  return `
    <div class="filters">
      <span class="filter-pill ${!active ? 'active' : ''}" data-clear="1">Todos</span>
      <span class="sep">| dev:</span>
      ${devs.map(n => `<span class="filter-pill ${f.dev === n ? 'active' : ''}" data-dev="${escapeHtml(n)}">${initials(n)} ${escapeHtml(n.split(' ')[0])}</span>`).join('')}
      <span class="sep">| epic:</span>
      ${epics.map(e => `<span class="filter-pill ${f.epic === e ? 'active' : ''}" data-epic="${e}" style="border-color:var(--epic-${e})">${e}</span>`).join('')}
      <span class="sep">| prioridade:</span>
      ${priorityLabels.map(l => `<span class="filter-pill ${f.label === l ? 'active' : ''}" data-label="${l}">${l}</span>`).join('')}
    </div>`;
}

function bindFilterClicks() {
  $$('.filter-pill').forEach(p => {
    p.addEventListener('click', () => {
      if (p.dataset.clear) {
        state.filter.dev = null; state.filter.label = null; state.filter.epic = null;
      } else if (p.dataset.dev !== undefined) {
        state.filter.dev = state.filter.dev === p.dataset.dev ? null : p.dataset.dev;
      } else if (p.dataset.label !== undefined) {
        state.filter.label = state.filter.label === p.dataset.label ? null : p.dataset.label;
      } else if (p.dataset.epic !== undefined) {
        state.filter.epic = state.filter.epic === p.dataset.epic ? null : p.dataset.epic;
      }
      render();
    });
  });
}

// ═══════════════════════════ CARD RENDERING ═══════════════════════════
function renderCardSmall(c, opts = {}) {
  const epic = getEpic(c.name);
  const epicCls = epic ? `epic-${epic}` : '';
  const labelDots = c.labels
    .filter(l => l.color)
    .map(l => `<span class="label-dot" style="background:${COLOR_MAP[l.color] || '#888'}" data-tooltip="${escapeHtml(l.name || l.color)}"></span>`)
    .join('');
  const memberAvatars = c.members.map(m => `<span class="avatar" data-tooltip="${escapeHtml(m.name)}">${initials(m.name)}</span>`).join('');
  const ageClass = ageColor(c.ageDays);
  const ageStr = c.ageDays != null ? `${c.ageDays}d` : '';

  // PR badge
  const prs = getPRsForCard(c.idShort);
  const openPR = prs.find(p => p.state === 'OPEN');
  const mergedPR = prs.find(p => p.state === 'MERGED');
  let prBadge = '';
  if (openPR) {
    const cls = openPR.isDraft ? 'draft' : 'open';
    prBadge = `<span class="pr-badge ${cls}" data-tooltip="${escapeHtml(openPR.title)}">PR #${openPR.number}${openPR.mergeable === 'CONFLICTING' ? ' ⚠' : ''}</span>`;
  } else if (mergedPR) {
    prBadge = `<span class="pr-badge merged" data-tooltip="${escapeHtml(mergedPR.title)}">✓ #${mergedPR.number}</span>`;
  }

  const draggable = opts.draggable !== false;
  return `
    <div class="card ${epicCls}" data-card-id="${c.idShort}" data-card-mongoid="${c.id}" ${draggable ? 'draggable="true"' : ''}>
      <div class="card-id">
        #${c.idShort}
        ${epic ? `<span class="epic-tag" style="color:var(--epic-${epic})">${epic}</span>` : ''}
        ${prBadge}
      </div>
      <div class="card-title">${escapeHtml(cleanTitle(c.name))}</div>
      <div class="card-footer">
        ${labelDots}
        ${ageStr ? `<span class="age ${ageClass}" data-tooltip="Última atividade: ${formatDate(c.dateLastActivity)}">${ageStr}</span>` : ''}
        <span class="members">${memberAvatars}</span>
      </div>
    </div>`;
}

function bindCardClicks() {
  $$('[data-card-id]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', e => {
      // Não abre modal se está em drag
      if (el.classList.contains('dragging')) return;
      e.preventDefault();
      const id = parseInt(el.dataset.cardId, 10);
      const card = state.cardsByIdShort[id];
      if (card) showCardModal(card);
    });
  });
  $$('[data-epic-key]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => {
      state.filter.epic = el.dataset.epicKey;
      render();
      setTimeout(() => {
        const detail = document.getElementById('epic-drill-detail');
        if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
  });
  // Epic clear filter button
  $('#epic-clear-btn')?.addEventListener('click', () => {
    state.filter.epic = null;
    render();
  });
  setupDragAndDrop();
  setupListHandlers();
}

function setupListHandlers() {
  // Renomear lista (click no nome)
  $$('.list-name').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', e => {
      e.stopPropagation();
      const listId = el.dataset.listId;
      const current = el.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'list-rename-input';
      el.replaceWith(input);
      input.focus(); input.select();
      const restore = (val) => {
        const span = document.createElement('span');
        span.className = 'list-name';
        span.dataset.listId = listId;
        span.textContent = val;
        span.title = 'click pra renomear';
        input.replaceWith(span);
        span.dataset.bound = '1';
        span.addEventListener('click', () => el.click());
      };
      const save = async () => {
        const newName = input.value.trim();
        if (!newName || newName === current) { restore(current); return; }
        try {
          await trelloWrite('renameList', { id: listId, name: newName });
          showToast(`📋 Lista renomeada pra "${newName}"`, 'success');
          restore(newName);
          // Atualiza state
          const list = state.derived.lists.find(l => l.id === listId);
          if (list) list.name = newName;
        } catch (err) {
          showToast(`❌ ${err.message}`, 'error');
          restore(current);
        }
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') restore(current);
      });
    });
  });

  // Botão menu (arquivar lista)
  $$('.list-menu-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const listId = btn.dataset.listId;
      const list = state.derived.lists.find(l => l.id === listId);
      if (!list) return;
      if (!confirm(`Arquivar a lista "${list.name}"?\n\nOs cards dentro dela ficam intactos. Pode ser desarquivada pelo Trello.`)) return;
      try {
        await trelloWrite('archiveList', { id: listId });
        showToast(`📦 Lista "${list.name}" arquivada`, 'success');
        list.closed = true;
        render();
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // Add card inline
  $$('.add-card-inline').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const listId = btn.dataset.listId;
      const listName = btn.dataset.listName;
      const name = prompt(`Novo card em "${listName}":\n\nFormato sugerido: [MÓDULO] tipo: descrição`);
      if (!name) return;
      try {
        const res = await trelloWrite('createCard', { idList: listId, name });
        showToast(`✨ Card #${res.result.idShort} criado`, 'success');
        setTimeout(() => loadData(true), 1500);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // Add list
  $('#add-list-btn')?.addEventListener('click', async () => {
    const name = prompt('Nome da nova lista:');
    if (!name || !name.trim()) return;
    try {
      await trelloWrite('createList', { name: name.trim(), pos: 'bottom' });
      showToast(`📋 Lista "${name}" criada`, 'success');
      setTimeout(() => loadData(true), 1500);
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
}

// ═══════════════════════════ DRAG & DROP (desktop + touch mobile) ═══════════════════════════
let draggingCard = null;
let touchClone = null;
let touchHoverCol = null;

function setupDragAndDrop() {
  // Cards arrastáveis (desktop drag-drop nativo)
  $$('.card[draggable="true"]').forEach(card => {
    if (card.dataset.dndBound) return;
    card.dataset.dndBound = '1';

    // ─── Desktop drag-and-drop ───
    card.addEventListener('dragstart', e => {
      draggingCard = {
        idShort: card.dataset.cardId,
        mongoId: card.dataset.cardMongoid,
        fromListEl: card.closest('[data-list-id]'),
      };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.cardMongoid);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      $$('.drag-over').forEach(c => c.classList.remove('drag-over'));
      draggingCard = null;
    });

    // ─── Touch drag-and-drop (mobile) ───
    let touchStartTimer = null;
    let touchStarted = false;

    card.addEventListener('touchstart', e => {
      // Long press 300ms ativa o drag
      touchStartTimer = setTimeout(() => {
        touchStarted = true;
        if (navigator.vibrate) navigator.vibrate(40);
        startTouchDrag(card, e.touches[0]);
      }, 300);
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      if (!touchStarted) {
        clearTimeout(touchStartTimer);
        return;
      }
      e.preventDefault();
      moveTouchClone(e.touches[0]);
      highlightTouchCol(e.touches[0]);
    }, { passive: false });

    card.addEventListener('touchend', e => {
      clearTimeout(touchStartTimer);
      if (touchStarted) {
        touchStarted = false;
        endTouchDrag();
      }
    });

    card.addEventListener('touchcancel', () => {
      clearTimeout(touchStartTimer);
      touchStarted = false;
      endTouchDrag(true);
    });
  });

  // Colunas drop targets
  $$('[data-list-id]').forEach(col => {
    if (col.dataset.dndBound) return;
    col.dataset.dndBound = '1';
    col.addEventListener('dragover', e => {
      e.preventDefault();
      if (!draggingCard) return;
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      handleDropOnCol(col);
    });
  });
}

function handleDropOnCol(col) {
  if (!draggingCard) return;
  const cardMongoId = draggingCard.mongoId;
  const newListId = col.dataset.listId;
  const newListName = col.dataset.listName;
  if (!newListId) return;

  const cardEl = document.querySelector(`.card[data-card-mongoid="${cardMongoId}"]`);
  const oldCol = draggingCard.fromListEl;
  if (!cardEl || !oldCol || oldCol === col) return;

  const stack = col.querySelector('.cards-stack');
  if (stack) stack.prepend(cardEl); else col.appendChild(cardEl);

  const card = Object.values(state.cardsByIdShort).find(c => c.id === cardMongoId);
  if (card) {
    card.list = newListName;
    updateColCounts();
  }
  moveCardOnTrello(card, newListId, newListName, oldCol);
}

// ─── Touch drag helpers ───
function startTouchDrag(card, touch) {
  draggingCard = {
    idShort: card.dataset.cardId,
    mongoId: card.dataset.cardMongoid,
    fromListEl: card.closest('[data-list-id]'),
  };
  card.classList.add('dragging');

  // Cria clone visual que segue o dedo
  touchClone = card.cloneNode(true);
  touchClone.classList.add('touch-clone');
  touchClone.style.position = 'fixed';
  touchClone.style.pointerEvents = 'none';
  touchClone.style.zIndex = '9999';
  touchClone.style.width = card.offsetWidth + 'px';
  document.body.appendChild(touchClone);
  moveTouchClone(touch);
}

function moveTouchClone(touch) {
  if (!touchClone) return;
  touchClone.style.left = (touch.clientX - 100) + 'px';
  touchClone.style.top = (touch.clientY - 30) + 'px';
}

function highlightTouchCol(touch) {
  // Remove highlight anterior
  if (touchHoverCol) touchHoverCol.classList.remove('drag-over');

  // Encontra coluna sob o dedo
  if (touchClone) touchClone.style.display = 'none'; // pra elementFromPoint não pegar o clone
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  if (touchClone) touchClone.style.display = '';

  const col = el ? el.closest('[data-list-id]') : null;
  if (col) {
    col.classList.add('drag-over');
    touchHoverCol = col;
  } else {
    touchHoverCol = null;
  }
}

function endTouchDrag(cancelled = false) {
  if (touchClone) { touchClone.remove(); touchClone = null; }
  $$('.dragging').forEach(c => c.classList.remove('dragging'));

  if (!cancelled && touchHoverCol && draggingCard && touchHoverCol !== draggingCard.fromListEl) {
    handleDropOnCol(touchHoverCol);
  }
  if (touchHoverCol) touchHoverCol.classList.remove('drag-over');
  touchHoverCol = null;
  draggingCard = null;
}

function updateColCounts() {
  $$('.kanban-col').forEach(col => {
    const count = col.querySelectorAll('.cards-stack .card').length;
    const span = col.querySelector('h3 .count');
    if (span) span.textContent = count;
  });
}

async function moveCardOnTrello(card, newListId, newListName, oldCol) {
  if (!card || !newListId) return;

  // Verifica secret antes (evita revert silencioso)
  if (!getStoredSecret()) {
    revertMove(card, oldCol);
    showSecretPrompt();
    showToast('🔐 Cole o secret pra mover cards', 'error');
    return;
  }

  try {
    showToast(`📦 Movendo #${card.idShort} → ${newListName}…`, 'info');
    await trelloWrite('moveCard', { id: card.id, idList: newListId });
    showToast(`✅ #${card.idShort} movido pra ${newListName}`, 'success');
    setTimeout(() => loadData(true), 3000);
  } catch (e) {
    revertMove(card, oldCol);
    showToast(`❌ Não consegui mover: ${e.message}`, 'error');
  }
}

function revertMove(card, oldCol) {
  if (!card || !oldCol) return;
  const cardEl = document.querySelector(`.card[data-card-mongoid="${card.id}"]`);
  const stack = oldCol.querySelector('.cards-stack');
  if (cardEl && stack) {
    stack.prepend(cardEl);
    card.list = oldCol.dataset.listName;
    updateColCounts();
  }
}

// ═══════════════════════════ CARD MODAL ═══════════════════════════
let modalCardId = null;
let modalChecklists = null;
let modalComments = null;

async function showCardModal(c) {
  modalCardId = c.id;
  modalChecklists = null;
  modalComments = null;

  const prs = getPRsForCard(c.idShort);
  const commits = getCommitsForCard(c.idShort);
  const epic = getEpic(c.name);

  // Render imediato com placeholders pra checklists e comments
  renderCardModal(c, prs, commits);
  $('#modal').hidden = false;
  document.addEventListener('keydown', escClose);

  // Lazy load checklists e comments via Function (com secret) — read-only fetch via proxy não precisa secret na verdade, mas reusa a Function
  if (getStoredSecret()) {
    try {
      const [cl, co] = await Promise.all([
        trelloWrite('getChecklists', { id: c.id }).catch(() => null),
        trelloWrite('getComments', { id: c.id }).catch(() => null),
      ]);
      if (modalCardId !== c.id) return; // user fechou ou trocou
      modalChecklists = (cl && cl.result) || [];
      modalComments = (co && co.result) || [];
      renderCardModal(c, prs, commits);
    } catch {}
  }
}

function renderCardModal(c, prs, commits) {
  const epic = getEpic(c.name);
  const labels = c.labels.map(l =>
    `<span class="card-label" data-label-name="${escapeHtml(l.name || '')}" style="background:${COLOR_MAP[l.color] || '#444'}">${escapeHtml(l.name || l.color)} <span class="lbl-x">×</span></span>`
  ).join('');
  const members = c.members.map(m => `<span class="card-member" data-member-id="${m.id}"><span class="avatar">${initials(m.name)}</span> ${escapeHtml(m.name)} <span class="m-x">×</span></span>`).join('');

  // Members do board não atribuídos no card
  const allMembers = state.derived.members || [];
  const cardMemberIds = new Set(c.members.map(m => m.id));
  const availableMembers = allMembers.filter(m => !cardMemberIds.has(m.id));

  // Labels do board não aplicadas
  const allLabels = (state.derived.labels || []).filter(l => l.name);
  const cardLabelNames = new Set(c.labels.map(l => l.name));
  const availableLabels = allLabels.filter(l => !cardLabelNames.has(l.name));

  // Listas pra mover
  const lists = state.derived.lists.filter(l => !l.closed);

  // Checklists carregadas?
  const checklistsHtml = renderChecklistsBlock(c);

  // Comentários
  const commentsHtml = renderCommentsBlock(c);

  // PRs/commits do GitHub
  const prsHtml = prs.length ? `
    <h3>Pull Requests (${prs.length})</h3>
    <div class="pr-list">
      ${prs.map(pr => `
        <div class="pr-item">
          <span class="pr-state ${pr.isDraft ? 'DRAFT' : pr.state}">${pr.isDraft ? 'DRAFT' : pr.state}</span>
          <a href="${pr.url}" target="_blank" class="pr-num">${pr.repo}#${pr.number}</a>
          <span style="flex:1;color:var(--fg-muted)">${escapeHtml(pr.title.slice(0, 100))}</span>
          ${pr.mergeable === 'CONFLICTING' ? '<span class="conflict-tag">CONFLICT</span>' : ''}
          <span style="color:var(--fg-dim);font-size:11px">${pr.author || ''} · ${timeAgo(pr.updatedAt)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';
  const commitsHtml = commits.length ? `
    <h3>Commits (${commits.length})</h3>
    <div class="commit-list">
      ${commits.slice(0, 8).map(c => `
        <div class="commit-item">
          <a href="${c.url}" target="_blank"><span class="commit-sha">${c.sha}</span></a>
          <span style="flex:1">${escapeHtml(c.message)}</span>
          <span style="color:var(--fg-dim);font-size:11px">${c.author} · ${timeAgo(c.date)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  $('#modal-content').innerHTML = `
    <button class="modal-close" id="modal-close">×</button>

    <!-- Title (editable) -->
    <h2 class="card-title-edit" data-field="name" title="click pra editar"><span class="ed-text">${escapeHtml(cleanTitle(c.name))}</span></h2>
    <div class="modal-meta">
      <span class="epic-tag" style="background:var(--epic-${epic || 'OUTROS'});color:white">${epic || 'OUTROS'}</span>
      ${c.priorityCode ? `<span class="priority-tag ${c.priorityCode}">${c.priorityCode}</span>` : ''}
      <span style="color:var(--fg-muted)">#${c.idShort}</span>
      <span style="color:var(--fg-muted)">📅 ${formatDate(c.dateLastActivity)} <span style="color:var(--fg-dim)">(${c.ageDays}d)</span></span>
      <a href="${c.url}" target="_blank">📌 Trello</a>
    </div>

    <div class="modal-grid">
      <div class="modal-main">

        <!-- Lista (movível) -->
        <h3>📋 Lista</h3>
        <select class="card-list-select" id="card-list-select">
          ${lists.map(l => `<option value="${l.id}" ${l.name === c.list ? 'selected' : ''}>${escapeHtml(l.name === 'In Progress (Max 2/dev)' ? 'In Progress' : l.name)}</option>`).join('')}
        </select>

        <!-- Members -->
        <h3>👥 Members</h3>
        <div class="card-members" id="card-members-block">
          ${members || '<span style="color:var(--fg-dim);font-size:12px">ninguém atribuído</span>'}
        </div>
        ${availableMembers.length ? `
          <details class="add-something">
            <summary>+ Adicionar member</summary>
            <div class="qa-pills">
              ${availableMembers.map(m => `<span class="qa-pill add-member-pill" data-member-id="${m.id}" data-member-name="${escapeHtml(m.fullName)}">${initials(m.fullName)} ${escapeHtml(m.fullName.split(' ')[0])}</span>`).join('')}
            </div>
          </details>` : ''}

        <!-- Labels -->
        <h3>🏷️ Labels</h3>
        <div class="card-labels" id="card-labels-block">
          ${labels || '<span style="color:var(--fg-dim);font-size:12px">sem labels</span>'}
        </div>
        ${availableLabels.length ? `
          <details class="add-something">
            <summary>+ Adicionar label</summary>
            <div class="qa-pills">
              ${availableLabels.map(l => `<span class="qa-pill add-label-pill" data-label-id="${l.id}" data-label-name="${escapeHtml(l.name)}" style="border-color:${COLOR_MAP[l.color] || '#888'}">${escapeHtml(l.name)}</span>`).join('')}
            </div>
          </details>` : ''}

        <!-- Description -->
        <h3>📝 Descrição <button class="mini-btn" id="edit-desc-btn">✏️ editar</button></h3>
        <div class="desc card-desc-display" id="card-desc-display">${c.desc ? escapeHtml(c.desc) : '<em style="color:var(--fg-dim)">sem descrição</em>'}</div>
        <div class="card-desc-edit" id="card-desc-edit" hidden>
          <textarea class="qa-input" id="card-desc-textarea" rows="8">${escapeHtml(c.desc || '')}</textarea>
          <div style="display:flex;gap:8px;margin-top:6px;justify-content:flex-end">
            <button id="cancel-desc">Cancelar</button>
            <button id="save-desc" style="background:var(--accent);color:var(--bg);font-weight:600">💾 Salvar</button>
          </div>
        </div>

        <!-- Due date -->
        <h3>📅 Data de entrega</h3>
        <div class="due-block">
          <input type="date" id="card-due-input" class="qa-input" style="max-width:200px" value="${c.due ? c.due.slice(0, 10) : ''}">
          ${c.due ? '<button id="clear-due">×</button>' : ''}
          ${c.due ? `<label style="margin-left:auto;font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="due-complete" ${c.dueComplete ? 'checked' : ''}> Concluída</label>` : ''}
        </div>

        <!-- Checklists -->
        ${checklistsHtml}

        <!-- Comments -->
        ${commentsHtml}

        <!-- GitHub -->
        ${prsHtml}
        ${commitsHtml}
      </div>

      <div class="modal-side">
        <h3>⚡ Ações</h3>
        <button class="side-btn" id="archive-card-btn">📦 Arquivar card</button>
        <button class="side-btn danger" id="delete-card-btn">🗑️ Deletar (sem volta)</button>
      </div>
    </div>
  `;

  bindCardModalEvents(c);
}

function bindCardModalEvents(c) {
  $('#modal-close').onclick = closeModal;

  // ─── Title edit (click to edit) ───
  const titleEl = $('.card-title-edit');
  if (titleEl) {
    titleEl.addEventListener('click', () => {
      const span = titleEl.querySelector('.ed-text');
      if (!span || titleEl.querySelector('input')) return;
      const current = span.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'title-edit-input';
      input.value = current;
      span.replaceWith(input);
      input.focus();
      input.select();
      const save = async () => {
        const newName = input.value.trim();
        if (!newName || newName === current) {
          // Restore
          const newSpan = document.createElement('span');
          newSpan.className = 'ed-text';
          newSpan.textContent = current;
          input.replaceWith(newSpan);
          return;
        }
        // Manter o prefixo [EPIC] tipo: do nome original se foi removido por cleanTitle
        const epicPrefix = c.name.match(/^(#?\d+\s*)?\[\w+\]\s*\w+:\s*/);
        const fullName = epicPrefix ? epicPrefix[0] + newName : newName;
        try {
          await trelloWrite('updateCard', { id: c.id, name: fullName });
          c.name = fullName;
          showToast('✏️ Título atualizado', 'success');
          const newSpan = document.createElement('span');
          newSpan.className = 'ed-text';
          newSpan.textContent = newName;
          input.replaceWith(newSpan);
          updateCardInList(c);
        } catch (e) {
          showToast(`❌ ${e.message}`, 'error');
          const newSpan = document.createElement('span');
          newSpan.className = 'ed-text';
          newSpan.textContent = current;
          input.replaceWith(newSpan);
        }
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
          const newSpan = document.createElement('span');
          newSpan.className = 'ed-text';
          newSpan.textContent = current;
          input.replaceWith(newSpan);
        }
      });
    });
  }

  // ─── Lista move ───
  $('#card-list-select')?.addEventListener('change', async (e) => {
    const newListId = e.target.value;
    const newListName = state.derived.lists.find(l => l.id === newListId)?.name || '';
    try {
      await trelloWrite('moveCard', { id: c.id, idList: newListId });
      c.list = newListName;
      showToast(`📦 Movido pra ${newListName}`, 'success');
      updateCardInList(c);
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    }
  });

  // ─── Members add/remove ───
  $$('.add-member-pill').forEach(p => {
    p.addEventListener('click', async () => {
      const idMember = p.dataset.memberId;
      const name = p.dataset.memberName;
      try {
        await trelloWrite('addMember', { id: c.id, idMember });
        c.members.push({ id: idMember, name, username: '' });
        showToast(`👤 ${name.split(' ')[0]} adicionado`, 'success');
        showCardModal(c); // re-render
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });
  $$('.card-member').forEach(el => {
    el.addEventListener('click', async () => {
      const idMember = el.dataset.memberId;
      if (!confirm('Remover este member?')) return;
      try {
        await trelloWrite('removeMember', { id: c.id, idMember });
        c.members = c.members.filter(m => m.id !== idMember);
        showToast('👤 Member removido', 'success');
        showCardModal(c);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // ─── Labels add/remove ───
  $$('.add-label-pill').forEach(p => {
    p.addEventListener('click', async () => {
      const idLabel = p.dataset.labelId;
      const name = p.dataset.labelName;
      try {
        await trelloWrite('addLabel', { id: c.id, idLabel });
        const lbl = state.derived.labels.find(l => l.id === idLabel);
        c.labels.push({ name: lbl?.name || name, color: lbl?.color });
        showToast(`🏷️ ${name} adicionada`, 'success');
        showCardModal(c);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });
  $$('.card-label').forEach(el => {
    el.addEventListener('click', async () => {
      const labelName = el.dataset.labelName;
      const lbl = state.derived.labels.find(l => l.name === labelName);
      if (!lbl) return;
      try {
        await trelloWrite('removeLabel', { id: c.id, idLabel: lbl.id });
        c.labels = c.labels.filter(x => x.name !== labelName);
        showToast(`🏷️ Label removida`, 'success');
        showCardModal(c);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // ─── Description edit ───
  $('#edit-desc-btn')?.addEventListener('click', () => {
    $('#card-desc-display').hidden = true;
    $('#card-desc-edit').hidden = false;
    $('#card-desc-textarea').focus();
  });
  $('#cancel-desc')?.addEventListener('click', () => {
    $('#card-desc-display').hidden = false;
    $('#card-desc-edit').hidden = true;
  });
  $('#save-desc')?.addEventListener('click', async () => {
    const newDesc = $('#card-desc-textarea').value;
    try {
      await trelloWrite('updateCard', { id: c.id, desc: newDesc });
      c.desc = newDesc;
      $('#card-desc-display').innerHTML = newDesc ? escapeHtml(newDesc) : '<em style="color:var(--fg-dim)">sem descrição</em>';
      $('#card-desc-display').hidden = false;
      $('#card-desc-edit').hidden = true;
      showToast('📝 Descrição atualizada', 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });

  // ─── Due date ───
  $('#card-due-input')?.addEventListener('change', async (e) => {
    const dateValue = e.target.value;
    const due = dateValue ? new Date(dateValue + 'T18:00:00').toISOString() : null;
    try {
      await trelloWrite('setDue', { id: c.id, due });
      c.due = due;
      showToast(due ? '📅 Data salva' : '📅 Data removida', 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
  $('#clear-due')?.addEventListener('click', async () => {
    try {
      await trelloWrite('setDue', { id: c.id, due: null });
      c.due = null;
      showCardModal(c);
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
  $('#due-complete')?.addEventListener('change', async (e) => {
    try {
      await trelloWrite('setDue', { id: c.id, due: c.due, dueComplete: e.target.checked });
      c.dueComplete = e.target.checked;
      showToast(e.target.checked ? '✅ Marcada como concluída' : '⚪ Desmarcada', 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });

  // ─── Checklists handlers ───
  bindChecklistsEvents(c);

  // ─── Comments ───
  bindCommentsEvents(c);

  // ─── Archive / Delete ───
  $('#archive-card-btn')?.addEventListener('click', async () => {
    if (!confirm(`Arquivar o card #${c.idShort}?\n\nPode ser desarquivado depois pelo Trello.`)) return;
    try {
      await trelloWrite('archiveCard', { id: c.id });
      showToast(`📦 Card arquivado`, 'success');
      closeModal();
      setTimeout(() => loadData(true), 1500);
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
  $('#delete-card-btn')?.addEventListener('click', async () => {
    if (!confirm(`⚠️ DELETAR PERMANENTEMENTE #${c.idShort}?\n\nEsta ação NÃO pode ser desfeita.`)) return;
    if (!confirm(`Tem certeza absoluta? Confirmar deletar #${c.idShort} pra sempre.`)) return;
    try {
      await trelloWrite('deleteCard', { id: c.id });
      showToast(`🗑️ Card deletado`, 'success');
      closeModal();
      setTimeout(() => loadData(true), 1500);
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
}

function updateCardInList(c) {
  // Atualiza visual do card no kanban (título, member, label) sem refresh full
  const cardEl = document.querySelector(`.card[data-card-mongoid="${c.id}"]`);
  if (cardEl) {
    const titleEl = cardEl.querySelector('.card-title');
    if (titleEl) titleEl.textContent = cleanTitle(c.name);
  }
}

function renderChecklistsBlock(c) {
  if (!modalChecklists) {
    return `<h3>☑️ Checklists</h3><div class="checklist-empty"><em style="color:var(--fg-dim)">Carregando…</em></div>`;
  }
  const checklistsHtml = modalChecklists.map(cl => {
    const items = (cl.checkItems || []).sort((a, b) => a.pos - b.pos);
    const total = items.length;
    const done = items.filter(i => i.state === 'complete').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `
      <div class="checklist-block" data-checklist-id="${cl.id}">
        <div class="checklist-header">
          <strong>${escapeHtml(cl.name)}</strong>
          <span style="font-size:11px;color:var(--fg-muted)">${done}/${total} (${pct}%)</span>
          <button class="mini-btn delete-checklist" data-id="${cl.id}" title="Apagar checklist">🗑️</button>
        </div>
        <div class="checklist-progress">
          <div class="checklist-progress-fill" style="width:${pct}%"></div>
        </div>
        <ul class="checklist-items">
          ${items.map(i => `
            <li class="${i.state === 'complete' ? 'done' : ''}" data-item-id="${i.id}" data-checklist-id="${cl.id}">
              <input type="checkbox" class="check-toggle" ${i.state === 'complete' ? 'checked' : ''}>
              <span class="check-text">${escapeHtml(i.name)}</span>
              <button class="mini-btn delete-checkitem" title="Apagar item">×</button>
            </li>
          `).join('')}
        </ul>
        <div class="add-checkitem-row">
          <input type="text" class="qa-input add-item-input" placeholder="+ Adicionar item…" data-checklist-id="${cl.id}">
        </div>
      </div>
    `;
  }).join('');
  return `
    <h3>☑️ Checklists ${modalChecklists.length > 0 ? `(${modalChecklists.length})` : ''}</h3>
    ${checklistsHtml || '<div style="color:var(--fg-dim);font-size:12px">nenhuma checklist</div>'}
    <details class="add-something">
      <summary>+ Nova checklist</summary>
      <div style="display:flex;gap:6px;margin-top:8px">
        <input type="text" class="qa-input" id="new-checklist-name" placeholder="Nome (ex: DOR, DOD, Tasks)">
        <button id="add-checklist-btn" style="background:var(--accent);color:var(--bg);font-weight:600">Criar</button>
      </div>
    </details>
  `;
}

function bindChecklistsEvents(c) {
  // Toggle item
  $$('.check-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const li = cb.closest('li');
      const itemId = li.dataset.itemId;
      const newState = cb.checked ? 'complete' : 'incomplete';
      try {
        await trelloWrite('toggleCheckItem', { idCard: c.id, idCheckItem: itemId, state: newState });
        li.classList.toggle('done', cb.checked);
        // Atualiza percentual
        const cl = li.closest('.checklist-block');
        const total = cl.querySelectorAll('li').length;
        const done = cl.querySelectorAll('li.done').length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        cl.querySelector('.checklist-progress-fill').style.width = pct + '%';
      } catch (err) {
        cb.checked = !cb.checked;
        showToast(`❌ ${err.message}`, 'error');
      }
    });
  });

  // Delete item
  $$('.delete-checkitem').forEach(btn => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const idCheckItem = li.dataset.itemId;
      const idChecklist = li.dataset.checklistId;
      try {
        await trelloWrite('deleteCheckItem', { idChecklist, idCheckItem });
        li.remove();
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // Add item
  $$('.add-item-input').forEach(input => {
    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const name = input.value.trim();
      if (!name) return;
      const idChecklist = input.dataset.checklistId;
      try {
        await trelloWrite('addCheckItem', { idChecklist, name });
        input.value = '';
        // Re-fetch checklists
        const cl = await trelloWrite('getChecklists', { id: c.id });
        modalChecklists = cl.result || [];
        renderCardModal(c, getPRsForCard(c.idShort), getCommitsForCard(c.idShort));
        bindCardModalEvents(c);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // Delete checklist
  $$('.delete-checklist').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Apagar checklist inteira?')) return;
      try {
        await trelloWrite('deleteChecklist', { id });
        modalChecklists = modalChecklists.filter(c => c.id !== id);
        renderCardModal(c, getPRsForCard(c.idShort), getCommitsForCard(c.idShort));
        bindCardModalEvents(c);
      } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    });
  });

  // New checklist
  $('#add-checklist-btn')?.addEventListener('click', async () => {
    const name = $('#new-checklist-name').value.trim();
    if (!name) return;
    try {
      const res = await trelloWrite('createChecklist', { idCard: c.id, name });
      modalChecklists.push(res.result);
      renderCardModal(c, getPRsForCard(c.idShort), getCommitsForCard(c.idShort));
      bindCardModalEvents(c);
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
}

function renderCommentsBlock(c) {
  if (!modalComments) {
    return `<h3>💬 Comentários</h3><div><em style="color:var(--fg-dim)">Carregando…</em></div>`;
  }
  return `
    <h3>💬 Comentários ${modalComments.length > 0 ? `(${modalComments.length})` : ''}</h3>
    <div class="add-comment-row">
      <textarea class="qa-input" id="new-comment-text" rows="2" placeholder="Escreva um comentário…"></textarea>
      <button id="add-comment-btn" style="background:var(--accent);color:var(--bg);font-weight:600">💬 Comentar</button>
    </div>
    <div class="comments-list">
      ${modalComments.length === 0 ? '<div style="color:var(--fg-dim);font-size:12px">sem comentários</div>' :
        modalComments.map(co => `
          <div class="comment-item">
            <div class="comment-meta">
              <span class="avatar">${initials(co.memberCreator?.fullName || '?')}</span>
              <strong>${escapeHtml(co.memberCreator?.fullName || 'unknown')}</strong>
              <span style="color:var(--fg-dim);font-size:11px">${timeAgo(co.date)}</span>
            </div>
            <div class="comment-text">${escapeHtml(co.data?.text || '')}</div>
          </div>
        `).join('')}
    </div>
  `;
}

function bindCommentsEvents(c) {
  $('#add-comment-btn')?.addEventListener('click', async () => {
    const text = $('#new-comment-text').value.trim();
    if (!text) return;
    try {
      await trelloWrite('comment', { id: c.id, text });
      $('#new-comment-text').value = '';
      const co = await trelloWrite('getComments', { id: c.id });
      modalComments = co.result || [];
      renderCardModal(c, getPRsForCard(c.idShort), getCommitsForCard(c.idShort));
      bindCardModalEvents(c);
      showToast('💬 Comentário adicionado', 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  });
}

function closeModal() {
  $('#modal').hidden = true;
  modalCardId = null;
  modalChecklists = null;
  modalComments = null;
  document.removeEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }

document.addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
});

// ═══════════════════════════ SEARCH ═══════════════════════════
let searchDebounce;
function setupSearch() {
  $('#search').addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => doSearch(e.target.value), 150);
  });
  $('#search').addEventListener('blur', () => {
    setTimeout(() => $('#search-results').classList.remove('show'), 200);
  });
  $('#search').addEventListener('focus', e => {
    if (e.target.value) doSearch(e.target.value);
  });
}

function doSearch(q) {
  const box = $('#search-results');
  q = q.trim().toLowerCase();
  if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }

  const cards = state.derived.cards.filter(c => !c.cardClosed && !c.listClosed && c.list !== 'Icebox');
  const results = [];

  // Match cards
  for (const c of cards) {
    const hay = `#${c.idShort} ${c.name}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({ kind: 'card', card: c, score: hay.indexOf(q) });
    }
  }

  // Match PRs
  if (state.github) {
    for (const repo of Object.values(state.github.repos)) {
      for (const pr of repo.prs.filter(p => p.state === 'OPEN').slice(0, 30)) {
        const hay = `#${pr.number} ${pr.title}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({ kind: 'pr', pr, repo: repo.full });
        }
      }
    }
  }

  results.sort((a, b) => (a.score || 100) - (b.score || 100));
  const top = results.slice(0, 12);
  if (!top.length) {
    box.innerHTML = '<div class="search-result"><span style="color:var(--fg-muted)">Nenhum resultado</span></div>';
    box.classList.add('show');
    return;
  }

  box.innerHTML = top.map(r => {
    if (r.kind === 'card') {
      const epic = getEpic(r.card.name);
      return `
        <div class="search-result" data-card-id="${r.card.idShort}">
          <span class="id">#${r.card.idShort}</span>
          ${epic ? `<span class="kind">${epic}</span>` : ''}
          <span style="flex:1">${escapeHtml(cleanTitle(r.card.name))}</span>
          <span style="color:var(--fg-dim);font-size:11px">${r.card.list === 'In Progress (Max 2/dev)' ? 'In Progress' : r.card.list}</span>
        </div>`;
    } else {
      return `
        <div class="search-result" data-pr-url="${r.pr.url}">
          <span class="id">#${r.pr.number}</span>
          <span class="kind pr">PR ${r.repo.split('/')[1]}</span>
          <span style="flex:1">${escapeHtml(r.pr.title.slice(0, 80))}</span>
        </div>`;
    }
  }).join('');
  box.classList.add('show');

  $$('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.cardId) {
        const card = state.cardsByIdShort[parseInt(el.dataset.cardId, 10)];
        if (card) showCardModal(card);
      } else if (el.dataset.prUrl) {
        window.open(el.dataset.prUrl, '_blank');
      }
      box.classList.remove('show');
      $('#search').value = '';
    });
  });
}

// ═══════════════════════════ QUICK ADD CARD ═══════════════════════════
function getStoredSecret() {
  return localStorage.getItem('tcc_dash_secret') || '';
}
function setStoredSecret(s) {
  localStorage.setItem('tcc_dash_secret', s);
}
function getApiBase() {
  // Em prod (Netlify) → /.netlify/functions/...
  // Em dev local sem Netlify CLI → endpoint não existe, mostra aviso
  return '/.netlify/functions';
}

async function trelloWrite(action, data) {
  const secret = getStoredSecret();
  if (!secret) {
    showSecretPrompt();
    throw new Error('Secret não configurado');
  }
  const res = await fetch(`${getApiBase()}/trello-write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TCC-Secret': secret,
    },
    body: JSON.stringify({ action, data }),
  });
  if (res.status === 401) {
    localStorage.removeItem('tcc_dash_secret');
    showSecretPrompt();
    throw new Error('Secret inválido');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function showSecretPrompt() {
  $('#quick-add-content').innerHTML = `
    <button class="modal-close" id="qa-close">×</button>
    <h2>🔐 Autenticação necessária</h2>
    <p style="color:var(--fg-muted);margin-bottom:18px">
      Pra adicionar/editar/mover cards no Trello, você precisa do <strong>secret compartilhado</strong> do time.<br>
      Pede pro admin do projeto.
    </p>
    <input type="password" id="qa-secret" class="search" placeholder="Cole o secret aqui…" style="width:100%;margin-bottom:14px" autocomplete="off">
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="qa-cancel">Cancelar</button>
      <button id="qa-save" style="background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:600">Salvar</button>
    </div>
    <p style="font-size:11.5px;color:var(--fg-dim);margin-top:14px">
      O secret fica salvo no localStorage do seu browser (não vai pro servidor).
    </p>
  `;
  $('#quick-add-modal').hidden = false;
  $('#qa-close').onclick = closeQuickAdd;
  $('#qa-cancel').onclick = closeQuickAdd;
  $('#qa-save').onclick = () => {
    const v = $('#qa-secret').value.trim();
    if (!v) return;
    setStoredSecret(v);
    closeQuickAdd();
    showToast('🔓 Secret salvo. Tente novamente.', 'success');
  };
  setTimeout(() => $('#qa-secret').focus(), 50);
}

function closeQuickAdd() {
  $('#quick-add-modal').hidden = true;
}

function showQuickAddCard() {
  if (!getStoredSecret()) { showSecretPrompt(); return; }

  const lists = state.derived.lists.filter(l => !l.closed && !/icebox|guia|prioridades/i.test(l.name));
  const members = state.derived.members;
  const labels = state.derived.labels.filter(l => l.name);

  $('#quick-add-content').innerHTML = `
    <button class="modal-close" id="qa-close">×</button>
    <h2>✨ Novo card no Trello</h2>
    <div class="qa-form">
      <label class="qa-label">📋 Lista
        <select id="qa-list" class="qa-input">
          ${lists.map(l => `<option value="${l.id}" ${/to-?do/i.test(l.name) ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </label>
      <label class="qa-label">📝 Título <span style="color:var(--red)">*</span>
        <input id="qa-title" class="qa-input" placeholder="Ex: [INFRA] feat: adicionar Sentry pra error tracking" autocomplete="off">
      </label>
      <label class="qa-label">📄 Descrição
        <textarea id="qa-desc" class="qa-input" rows="6" placeholder="Cole o template POP/DOR/DOD aqui se quiser, ou só descreva."></textarea>
      </label>
      <label class="qa-label">🏷️ Labels
        <div class="qa-pills" id="qa-labels-pills">
          ${labels.map(l => `<span class="qa-pill" data-label="${l.id}" style="border-color:${COLOR_MAP[l.color] || '#888'}">${escapeHtml(l.name)}</span>`).join('')}
        </div>
      </label>
      <label class="qa-label">👥 Members
        <div class="qa-pills" id="qa-members-pills">
          ${members.map(m => `<span class="qa-pill" data-member="${m.id}">${initials(m.name)} ${escapeHtml(m.name.split(' ')[0])}</span>`).join('')}
        </div>
      </label>
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px">
        <button id="qa-template" style="background:var(--bg-3);font-size:11.5px">📋 Aplicar template POP+DOR+DOD</button>
        <div style="display:flex;gap:8px">
          <button id="qa-cancel">Cancelar</button>
          <button id="qa-submit" style="background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:700">✨ Criar card</button>
        </div>
      </div>
    </div>
  `;
  $('#quick-add-modal').hidden = false;

  $('#qa-close').onclick = closeQuickAdd;
  $('#qa-cancel').onclick = closeQuickAdd;

  // Toggle labels/members pills
  $$('.qa-pill').forEach(p => {
    p.addEventListener('click', () => p.classList.toggle('selected'));
  });

  // Apply template
  $('#qa-template').onclick = () => {
    const persona = 'Usuário do sistema';
    const title = $('#qa-title').value.trim() || '[Título do card]';
    const tpl = `**Como** ${persona},
**Quero** ${title.replace(/^\[\w+\]\s*\w+:\s*/, '').toLowerCase()},
**Para** [valor de negócio].

---

**Goal:** [o que precisa ser entregue]

**Critérios de Aceitação:**
- [ ] Critério 1
- [ ] Critério 2

**Tasks técnicas:**
- [ ] Task 1
- [ ] Task 2

**Files (manter atualizado):**
- \`src/modules/<dominio>/...\`

**Size:** Small (2-3h) | Medium (4-6h) | Large (1-2 dias)
**Dependências:** —
**DoR:** [ ] verificado | **DoD:** [ ] verificado`;
    $('#qa-desc').value = tpl;
  };

  // Submit
  $('#qa-submit').onclick = async () => {
    const idList = $('#qa-list').value;
    const name = $('#qa-title').value.trim();
    const desc = $('#qa-desc').value.trim();
    const idLabels = $$('#qa-labels-pills .qa-pill.selected').map(p => p.dataset.label);
    const idMembers = $$('#qa-members-pills .qa-pill.selected').map(p => p.dataset.member);

    if (!name) {
      showToast('Título é obrigatório', 'error');
      $('#qa-title').focus();
      return;
    }

    const btn = $('#qa-submit');
    btn.disabled = true;
    btn.textContent = '⏳ Criando…';

    try {
      const res = await trelloWrite('createCard', { idList, name, desc, idLabels, idMembers });
      if (res.ok) {
        const card = res.result;
        showToast(`✅ Card #${card.idShort} criado!`, 'success', card.shortUrl);
        closeQuickAdd();
        // Trigger refresh dos dados em ~3s pra pegar o card novo
        setTimeout(() => loadData(), 3000);
      } else {
        showToast(`❌ ${res.erro || 'Erro desconhecido'}`, 'error');
      }
    } catch (e) {
      showToast(`❌ ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Criar card';
    }
  };

  setTimeout(() => $('#qa-title').focus(), 50);
}

function setupFab() {
  $('#fab-add').addEventListener('click', showQuickAddCard);
  $('#user-badge').addEventListener('click', showUserPicker);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
      e.preventDefault();
      showQuickAddCard();
    }
    if (e.key === 'Escape' && !$('#quick-add-modal').hidden) closeQuickAdd();
  });
  document.addEventListener('click', e => {
    if (e.target.id === 'quick-add-modal') closeQuickAdd();
  });
}

function ensureUserOnBoot() {
  if (!getCurrentUser()) {
    setTimeout(() => showUserPicker(), 600);
  } else {
    updateUserBadge();
  }
}

// ═══════════════════════════ TOAST ═══════════════════════════
function showToast(msg, type = 'info', linkUrl = null) {
  const stack = $('#toast-stack');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${escapeHtml(msg)}</span>${linkUrl ? `<a href="${linkUrl}" target="_blank" style="margin-left:8px">abrir →</a>` : ''}`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, linkUrl ? 6000 : 4000);
}

// ═══════════════════════════ INIT ═══════════════════════════
function setupRefreshBtn() {
  $('#refresh-btn').addEventListener('click', async () => {
    const btn = $('#refresh-btn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Carregando…';
    await loadData();
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Recarregar';
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.shiftKey) {
      e.preventDefault();
      $('#refresh-btn').click();
    }
  });
}

async function init() {
  const cfg = await loadConfig();
  if (!cfg) return; // erro já mostrado
  navigate();
  setupSearch();
  setupRefreshBtn();
  setupFab();
  ensureUserOnBoot();
  await loadData();
  setupPolling();
}

init();

// Setup docs search após carregar (re-bound em cada navigate)
const observer = new MutationObserver(() => {
  if ($('#docs-search') && !$('#docs-search').dataset.bound) {
    $('#docs-search').dataset.bound = '1';
    setupDocsSearch();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

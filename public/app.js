const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseDate = d => new Date(d.replace(' ', 'T') + 'Z');
const fmt = d => parseDate(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
function ago(d) {
  const s = (Date.now() - parseDate(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return fmt(d);
}
const readTime = n => Math.max(1, Math.round(n / 1000)) + ' min read';
const COLORS = ['#5a48e0','#d6457a','#e07a2f','#1f9d78','#2f7fd6','#9b49d6','#c9a21c'];
const avatar = (name, cls = '') => `<span class="av ${cls}" style="background:${COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]}" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let token = localStorage.getItem('token'), user = null;
let theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
}
function confirmBox(msg, yes = 'Delete') {
  return new Promise(res => {
    $('#dmsg').textContent = msg; $('#dyes').textContent = yes;
    const d = $('#dlg'); d.showModal();
    const done = v => { d.close(); res(v); };
    $('#dyes').onclick = () => done(true); $('#dno').onclick = () => done(false); d.oncancel = () => res(false);
  });
}
async function api(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  let data = {}; try { data = await res.json(); } catch {}
  if (res.status === 401 && token && !url.startsWith('/auth/login')) logout(false);
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function setSession(d) { token = d.token; user = d.user; localStorage.setItem('token', token); }
function logout(go = true) { token = null; user = null; localStorage.removeItem('token'); renderNav(); if (go) { toast('Logged out'); location.hash = '#/'; } }
const errBox = m => `<div class="msg" role="alert">${esc(m)}</div>`;
const skeleton = `<div class="card"><div class="sk" style="width:60%;height:24px"></div><div class="sk"></div><div class="sk" style="width:85%"></div></div>`.repeat(3);

function renderNav() {
  $('#nav').innerHTML = `<a class="logo" href="#/">Ink<span>well</span></a>
    <button class="ghost icon" id="th" aria-label="Toggle dark mode">${theme === 'dark' ? '☀️' : '🌙'}</button>` + (user
    ? `<a class="btn" href="#/new">✏️ <span>Write</span></a>${avatar(user.username)}<button class="ghost" id="lo">Log out</button>`
    : `<a class="btn ghost" href="#/login">Log in</a><a class="btn" href="#/register">Sign up</a>`);
  $('#th').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); renderNav(); };
  const lo = $('#lo'); if (lo) lo.onclick = () => logout();
}

// ---------- Views ----------
async function homeView(params) {
  const page = Number(params.get('page')) || 1, q = params.get('q') || '';
  const mine = params.get('tab') === 'mine' && user;
  $('#app').innerHTML = skeleton;
  const d = await api('GET', `/posts?page=${page}&q=${encodeURIComponent(q)}${mine ? '&author=' + encodeURIComponent(user.username) : ''}`);
  const base = `#/?${mine ? 'tab=mine&' : ''}`;
  $('#app').innerHTML = `
    ${page === 1 && !q && !mine ? `<section class="hero"><div class="nib">✒️</div>
      <h1>Stories worth talking about.</h1>
      <p>Publish your thoughts, read what others write, and keep the conversation going in the comments.</p>
      ${user ? '<a class="btn" href="#/new">Write a post</a>' : '<div class="row"><a class="btn" href="#/register">Start writing</a><a class="btn ghost" href="#/login">Log in</a></div>'}
    </section>` : ''}
    ${user ? `<div class="tabs"><a class="tab ${mine ? '' : 'on'}" href="#/">All posts</a><a class="tab ${mine ? 'on' : ''}" href="#/?tab=mine">My posts</a></div>` : ''}
    <form id="sf" class="search"><input name="q" type="search" placeholder="Search posts…" aria-label="Search posts" value="${esc(q)}"><button>Search</button></form>
    ${q ? `<p class="meta">${plural(d.total, 'result')} for “${esc(q)}” · <a href="${base}">clear</a></p>` : ''}
    ${d.posts.length ? d.posts.map(p => `
      <a class="card post-card" href="#/post/${p.id}">
        <div class="who">${avatar(p.author)}<div><strong>${esc(p.author)}</strong><div class="meta">${ago(p.created_at)} · ${readTime(p.len)}</div></div></div>
        <div class="t">${esc(p.title)}</div>
        <p>${esc(p.excerpt)}${p.len > 200 ? '…' : ''}</p>
        <span class="chip">💬 ${plural(p.comment_count, 'comment')}</span>
      </a>`).join('') : `<div class="empty"><div class="big">${q ? '🔍' : '📝'}</div><p>${q ? 'No posts match your search.' : mine ? "You haven't written anything yet." : 'No posts yet. Be the first to write one.'}</p>${user && !q ? '<a class="btn" href="#/new">Write a post</a>' : ''}</div>`}
    ${d.pages > 1 ? `<div class="row" style="justify-content:center;margin-top:8px">
      ${page > 1 ? `<a class="btn ghost" href="${base}page=${page - 1}&q=${encodeURIComponent(q)}">← Newer</a>` : ''}
      <span class="meta">Page ${page} of ${d.pages}</span>
      ${page < d.pages ? `<a class="btn ghost" href="${base}page=${page + 1}&q=${encodeURIComponent(q)}">Older →</a>` : ''}</div>` : ''}`;
  $('#sf').onsubmit = e => { e.preventDefault(); location.hash = `#/?${mine ? 'tab=mine&' : ''}q=` + encodeURIComponent(new FormData(e.target).get('q').trim()); };
}

async function postView(id) {
  $('#app').innerHTML = skeleton;
  const [{ post }, { comments }] = await Promise.all([api('GET', `/posts/${id}`), api('GET', `/posts/${id}/comments`)]);
  document.title = post.title + ' — Inkwell';
  const mine = user && user.id === post.user_id;
  $('#app').innerHTML = `
    <p><a href="#/">← All posts</a></p>
    <article class="card article">
      <h1>${esc(post.title)}</h1>
      <div class="who">${avatar(post.author)}<div><strong>${esc(post.author)}</strong>
        <div class="meta">${fmt(post.created_at)} · ${readTime(post.content.length)}${post.updated_at !== post.created_at ? ' · edited' : ''}</div></div></div>
      <div class="content">${esc(post.content)}</div>
      ${mine ? `<div class="row" style="margin-top:20px"><a class="btn ghost" href="#/edit/${post.id}">✏️ Edit</a><button class="danger" id="dp">🗑 Delete</button></div>` : ''}
    </article>
    <section class="card" id="comments">
      <h2 style="margin-bottom:6px">${plural(comments.length, 'comment')}</h2>
      ${user ? `<form id="cf"><div id="ce"></div>
        <textarea id="cc" maxlength="1000" required placeholder="Share your thoughts…" aria-label="Comment" style="min-height:90px"></textarea>
        <div class="row" style="justify-content:space-between;margin-top:8px"><span class="meta" id="cn">0 / 1000</span><button>Post comment</button></div></form>`
        : `<p class="meta"><a href="#/login">Log in</a> or <a href="#/register">sign up</a> to join the discussion.</p>`}
      <div style="margin-top:12px">${comments.length ? comments.map(c => `
        <div class="comment">${avatar(c.author, 'sm')}<div class="body">
          <div class="meta"><strong style="color:var(--ink)">${esc(c.author)}</strong>${c.user_id === post.user_id ? ' <span class="chip">Author</span>' : ''} · ${ago(c.created_at)}</div>
          <div class="content" style="font-size:.97rem;line-height:1.6">${esc(c.content)}</div></div>
          ${user && (user.id === c.user_id || mine) ? `<button class="danger icon" data-cid="${c.id}" aria-label="Delete comment" title="Delete comment">🗑</button>` : ''}
        </div>`).join('') : '<div class="empty" style="padding:24px 0">No comments yet. Start the conversation.</div>'}</div>
    </section>`;
  if (mine) $('#dp').onclick = async () => {
    if (!await confirmBox('Delete this post and all its comments? This cannot be undone.')) return;
    try { await api('DELETE', `/posts/${id}`); toast('Post deleted'); location.hash = '#/'; } catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-cid]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Delete this comment?')) return;
    try { await api('DELETE', `/comments/${b.dataset.cid}`); toast('Comment deleted'); postView(id); } catch (e) { toast(e.message, true); }
  });
  const cf = $('#cf');
  if (cf) {
    $('#cc').oninput = e => $('#cn').textContent = e.target.value.length + ' / 1000';
    cf.onsubmit = async e => {
      e.preventDefault(); const btn = cf.querySelector('button'); btn.disabled = true;
      try { await api('POST', `/posts/${id}/comments`, { content: $('#cc').value }); toast('Comment posted'); await postView(id); }
      catch (err) { $('#ce').innerHTML = errBox(err.message); btn.disabled = false; }
    };
  }
}

function editorView(post) {
  $('#app').innerHTML = `
    <h1 style="margin-bottom:16px">${post ? 'Edit post' : 'Write a post'}</h1>
    <form id="pf" class="card"><div id="pe"></div>
      <label for="t" style="margin-top:0">Title</label><input id="t" maxlength="150" required minlength="3" placeholder="A title that makes people curious" value="${post ? esc(post.title) : ''}">
      <label for="c">Content</label><textarea id="c" maxlength="20000" required placeholder="Write your story…" style="min-height:300px">${post ? esc(post.content) : ''}</textarea>
      <div class="meta" id="cc2" style="text-align:right"></div>
      <div class="row" style="margin-top:12px"><button>${post ? 'Save changes' : 'Publish'}</button><a class="btn ghost" href="#/${post ? 'post/' + post.id : ''}">Cancel</a></div>
    </form>`;
  const upd = () => $('#cc2').textContent = `${$('#c').value.length} / 20000 characters`;
  $('#c').oninput = upd; upd();
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const body = { title: $('#t').value, content: $('#c').value };
      const d = post ? await api('PUT', `/posts/${post.id}`, body) : await api('POST', '/posts', body);
      toast(post ? 'Changes saved' : 'Post published'); location.hash = '#/post/' + d.post.id;
    } catch (err) { $('#pe').innerHTML = errBox(err.message); btn.disabled = false; }
  };
}

function authView(mode) {
  const reg = mode === 'register';
  $('#app').innerHTML = `<div style="max-width:420px;margin:20px auto">
    <h1 style="margin-bottom:6px">${reg ? 'Create your account' : 'Welcome back'}</h1>
    <p class="meta" style="margin:0 0 16px">${reg ? 'Join to write posts and comment.' : 'Log in to write and comment.'}</p>
    <form id="af" class="card"><div id="ae"></div>
      ${reg ? '<label for="u" style="margin-top:0">Username</label><input id="u" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" title="Letters, numbers and underscore only">' : ''}
      <label for="e" ${reg ? '' : 'style="margin-top:0"'}>Email</label><input id="e" type="email" autocomplete="email" required>
      <label for="p">Password</label><div class="pw"><input id="p" type="password" minlength="6" maxlength="72" autocomplete="${reg ? 'new' : 'current'}-password" required><button type="button" class="ghost" id="sp">Show</button></div>
      ${reg ? '<div class="meta">At least 6 characters.</div>' : ''}
      <div style="margin-top:18px"><button style="width:100%;justify-content:center">${reg ? 'Sign up' : 'Log in'}</button></div>
      <p class="meta" style="text-align:center;margin-bottom:0">${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
    </form></div>`;
  $('#sp').onclick = () => { const p = $('#p'), s = p.type === 'password'; p.type = s ? 'text' : 'password'; $('#sp').textContent = s ? 'Hide' : 'Show'; };
  $('#af').onsubmit = async e => {
    e.preventDefault(); const btn = e.target.querySelector('button[type=submit], button:not([type])'); btn.disabled = true;
    try {
      const d = await api('POST', '/auth/' + mode, { ...(reg && { username: $('#u').value }), email: $('#e').value, password: $('#p').value });
      setSession(d); renderNav(); toast(reg ? `Welcome, ${d.user.username}!` : `Welcome back, ${d.user.username}`); location.hash = '#/';
    } catch (err) { $('#ae').innerHTML = errBox(err.message); btn.disabled = false; }
  };
}

// ---------- Router ----------
async function route() {
  document.title = 'Inkwell — Write. Share. Discuss.';
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || ''), parts = path.split('/').filter(Boolean);
  try {
    if (!parts.length) await homeView(params);
    else if (parts[0] === 'post' && parts[1]) await postView(parts[1]);
    else if (parts[0] === 'login' || parts[0] === 'register') user ? (location.hash = '#/') : authView(parts[0]);
    else if (parts[0] === 'new') user ? editorView() : (toast('Please log in first', true), location.hash = '#/login');
    else if (parts[0] === 'edit' && parts[1]) {
      if (!user) return (location.hash = '#/login');
      const { post } = await api('GET', `/posts/${parts[1]}`);
      if (post.user_id !== user.id) throw new Error('You can edit only your own posts');
      editorView(post);
    } else $('#app').innerHTML = '<div class="empty"><div class="big">🧭</div><p>Page not found.</p><a class="btn" href="#/">Go home</a></div>';
  } catch (e) { $('#app').innerHTML = `${errBox(e.message)}<a href="#/">← Back to posts</a>`; }
  window.scrollTo(0, 0);
}

(async function init() {
  if (token) { try { user = (await api('GET', '/auth/me')).user; } catch { token = null; } }
  renderNav(); route();
  window.addEventListener('hashchange', route);
})();

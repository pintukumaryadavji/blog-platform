const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'blog.db');

// JWT secret: use env var if given, otherwise generate once and keep it in a file (so logins survive restarts)
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = DB_FILE + '.secret';
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch { /* read-only FS: secret lasts for this run only */ }
  return secret;
}
const SECRET = loadSecret();

// ---------- Database ----------
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
`);

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, username, email FROM users WHERE id = ?'),
  userExists: db.prepare('SELECT 1 FROM users WHERE email = ? OR username = ?'),
  insertUser: db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'),
  postById: db.prepare(`SELECT p.*, u.username AS author FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`),
  insertPost: db.prepare('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)'),
  updatePost: db.prepare("UPDATE posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
  deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
  commentById: db.prepare('SELECT * FROM comments WHERE id = ?'),
  comments: db.prepare(`SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.username AS author
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC, c.id ASC`),
  insertComment: db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'),
  deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
};

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const str = v => (typeof v === 'string' ? v.trim() : '');
const toId = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id'); return n; };
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });

function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Login required'));
  try {
    const { id } = jwt.verify(token, SECRET);
    const user = q.userById.get(id);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch { next(new HttpError(401, 'Invalid or expired token')); }
}

// Simple in-memory rate limit for auth endpoints (brute-force protection)
const hits = new Map();
function authLimiter(req, _res, next) {
  const now = Date.now(), key = req.ip, win = 15 * 60 * 1000, max = process.env.NODE_ENV === 'test' ? 1e9 : 30;
  const arr = (hits.get(key) || []).filter(t => now - t < win);
  arr.push(now); hits.set(key, arr);
  if (arr.length > max) return next(new HttpError(429, 'Too many attempts. Try again later.'));
  next();
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // needed behind Render/Heroku/Nginx for correct rate limiting
app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.get('/api/health', wrap((_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true, uptime: Math.round(process.uptime()) }); }));

// ----- Auth -----
app.post('/api/auth/register', authLimiter, wrap((req, res) => {
  const username = str(req.body.username), email = str(req.body.email).toLowerCase(), password = req.body.password;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Username must be 3-20 letters, numbers or underscore');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new HttpError(400, 'Enter a valid email');
  if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72) throw new HttpError(400, 'Password must be 6-72 characters (letters/numbers/symbols)');
  if (q.userExists.get(email, username)) throw new HttpError(409, 'Username or email already registered');
  const info = q.insertUser.run(username, email, bcrypt.hashSync(password, 10));
  const user = q.userById.get(info.lastInsertRowid);
  res.status(201).json({ token: sign(user), user });
}));

app.post('/api/auth/login', authLimiter, wrap((req, res) => {
  const email = str(req.body.email).toLowerCase(), password = req.body.password;
  const row = typeof password === 'string' ? q.userByEmail.get(email) : null;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) throw new HttpError(401, 'Wrong email or password');
  const user = { id: row.id, username: row.username, email: row.email };
  res.json({ token: sign(user), user });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ----- Posts -----
app.get('/api/posts', wrap((req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const search = str(req.query.q), author = str(req.query.author);
  const conds = [], params = {};
  if (search) { conds.push("(p.title LIKE @s ESCAPE '\\' OR p.content LIKE @s ESCAPE '\\')"); params.s = '%' + search.replace(/[\\%_]/g, '\\$&') + '%'; }
  if (author) { conds.push('u.username = @author'); params.author = author; }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id ${where}`).get(params).n;
  const posts = db.prepare(`
    SELECT p.id, p.user_id, p.title, substr(p.content, 1, 200) AS excerpt, length(p.content) AS len, p.created_at, p.updated_at, u.username AS author,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.user_id ${where}
    ORDER BY p.created_at DESC, p.id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset: (page - 1) * limit });
  res.json({ posts, page, pages: Math.max(1, Math.ceil(total / limit)), total });
}));

app.get('/api/posts/:id', wrap((req, res) => {
  const post = q.postById.get(toId(req.params.id));
  if (!post) throw new HttpError(404, 'Post not found');
  res.json({ post });
}));

function postBody(req) {
  const title = str(req.body.title), content = str(req.body.content);
  if (title.length < 3 || title.length > 150) throw new HttpError(400, 'Title must be 3-150 characters');
  if (content.length < 1 || content.length > 20000) throw new HttpError(400, 'Content must be 1-20000 characters');
  return { title, content };
}

app.post('/api/posts', auth, wrap((req, res) => {
  const { title, content } = postBody(req);
  const info = q.insertPost.run(req.user.id, title, content);
  res.status(201).json({ post: q.postById.get(info.lastInsertRowid) });
}));

app.put('/api/posts/:id', auth, wrap((req, res) => {
  const id = toId(req.params.id), post = q.postById.get(id);
  if (!post) throw new HttpError(404, 'Post not found');
  if (post.user_id !== req.user.id) throw new HttpError(403, 'You can edit only your own posts');
  const { title, content } = postBody(req);
  q.updatePost.run(title, content, id);
  res.json({ post: q.postById.get(id) });
}));

app.delete('/api/posts/:id', auth, wrap((req, res) => {
  const id = toId(req.params.id), post = q.postById.get(id);
  if (!post) throw new HttpError(404, 'Post not found');
  if (post.user_id !== req.user.id) throw new HttpError(403, 'You can delete only your own posts');
  q.deletePost.run(id);
  res.json({ ok: true });
}));

// ----- Comments -----
app.get('/api/posts/:id/comments', wrap((req, res) => {
  const id = toId(req.params.id);
  if (!q.postById.get(id)) throw new HttpError(404, 'Post not found');
  res.json({ comments: q.comments.all(id) });
}));

app.post('/api/posts/:id/comments', auth, wrap((req, res) => {
  const id = toId(req.params.id);
  if (!q.postById.get(id)) throw new HttpError(404, 'Post not found');
  const content = str(req.body.content);
  if (content.length < 1 || content.length > 1000) throw new HttpError(400, 'Comment must be 1-1000 characters');
  const info = q.insertComment.run(id, req.user.id, content);
  const comment = q.comments.all(id).find(c => c.id === info.lastInsertRowid);
  res.status(201).json({ comment });
}));

app.delete('/api/comments/:id', auth, wrap((req, res) => {
  const c = q.commentById.get(toId(req.params.id));
  if (!c) throw new HttpError(404, 'Comment not found');
  const post = q.postById.get(c.post_id);
  if (c.user_id !== req.user.id && post.user_id !== req.user.id) throw new HttpError(403, 'Not allowed');
  q.deleteComment.run(c.id);
  res.json({ ok: true });
}));

// ----- Errors -----
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route not found')));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON');
  if (err.type === 'entity.too.large') err = new HttpError(413, 'Payload too large');
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

if (require.main === module) {
  const server = app.listen(PORT, () => console.log(`Blog running at http://localhost:${PORT}`));
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Run with another port: PORT=4000 npm start` : e);
    process.exit(1);
  });
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = app;
module.exports.db = db;

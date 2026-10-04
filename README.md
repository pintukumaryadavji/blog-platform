# Inkwell — Blog Platform with Comments

Full-stack blog: users register/login, create/edit/delete posts, and comment.
**Stack:** Node.js (18+), Express, SQLite (better-sqlite3), JWT + bcrypt, vanilla JS frontend.

## Quick start
    npm install
    npm run seed      # optional: demo users/posts (password: demo123)
    npm start         # open http://localhost:3000
    npm test          # automated API tests

No config needed. A JWT secret is auto-generated and saved next to the DB.
Optional env vars: `PORT`, `JWT_SECRET`, `DB_FILE`, `TRUST_PROXY=1` (when behind a proxy/host).
If port 3000 is busy: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).

## Project structure
    server.js        Express app, REST API, SQLite schema
    public/          Frontend (index.html, style.css, app.js)
    seed.js          Demo data
    test.js          API tests
    Dockerfile       Container deploy

## REST API
| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | /api/health | - | Health check |
| POST | /api/auth/register | - | Register |
| POST | /api/auth/login | - | Login (returns JWT) |
| GET | /api/auth/me | yes | Current user |
| GET | /api/posts?page=&q=&author= | - | List / search / filter (paginated) |
| GET | /api/posts/:id | - | Single post |
| POST | /api/posts | yes | Create post |
| PUT | /api/posts/:id | owner | Edit post |
| DELETE | /api/posts/:id | owner | Delete post (and its comments) |
| GET | /api/posts/:id/comments | - | List comments |
| POST | /api/posts/:id/comments | yes | Add comment |
| DELETE | /api/comments/:id | author or post owner | Delete comment |

## Security
bcrypt hashing, JWT (7 days), parameterized SQL, input validation, owner-only edit/delete,
XSS-safe rendering + strict Content-Security-Policy, auth rate limiting, request size limit, security headers.

## Deploy
Any Node host (Render, Railway, etc.): build `npm install`, start `npm start`, set `JWT_SECRET` and `TRUST_PROXY=1`,
and attach a persistent disk for `DB_FILE`. Or: `docker build -t inkwell . && docker run -p 3000:3000 -v inkwell:/data inkwell`.

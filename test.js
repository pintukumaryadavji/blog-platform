// Run: npm test  (uses a temp DB, checks every feature + permission rules)
process.env.NODE_ENV = 'test';
process.env.DB_FILE = require('os').tmpdir() + '/blog-test-' + Date.now() + '.db';
const assert = require('assert');
const app = require('./server');
const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await call('GET', '/health')).data.ok, true);
    assert.equal((await call('POST', '/auth/register', { username: 'emoji', email: 'e@x.com', password: '🔥'.repeat(20) })).status, 400); // >72 bytes
    let r = await call('POST', '/auth/register', { username: 'alice', email: 'a@x.com', password: 'secret1' });
    assert.equal(r.status, 201); const A = r.data.token;
    r = await call('POST', '/auth/register', { username: 'bob', email: 'b@x.com', password: 'secret2' });
    const B = r.data.token;
    assert.equal((await call('POST', '/auth/register', { username: 'ALICE', email: 'z@x.com', password: 'secret1' })).status, 409);
    assert.equal((await call('POST', '/auth/register', { username: 'a', email: 'bad', password: '1' })).status, 400);
    assert.equal((await call('POST', '/auth/login', { email: 'a@x.com', password: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/auth/login', { email: 'a@x.com', password: 'secret1' })).status, 200);
    assert.equal((await call('GET', '/auth/me', null, A)).data.user.username, 'alice');
    assert.equal((await call('POST', '/posts', { title: 'Hello', content: 'World' })).status, 401);
    assert.equal((await call('POST', '/posts', { title: 'x', content: '' }, A)).status, 400);
    r = await call('POST', '/posts', { title: 'Hello', content: 'World <b>x</b>' }, A);
    assert.equal(r.status, 201); const pid = r.data.post.id;
    assert.equal((await call('GET', '/posts')).data.total, 1);
    assert.equal((await call('GET', '/posts?q=100%25')).data.total, 0);
    assert.equal((await call('GET', '/posts?q=hello')).data.total, 1);
    assert.equal((await call('GET', '/posts?author=alice')).data.total, 1);
    assert.equal((await call('GET', '/posts?author=bob')).data.total, 0);
    assert.equal((await call('GET', '/posts?author=alice&q=zzz')).data.total, 0);
    assert.equal((await call('GET', '/posts/abc')).status, 400);
    assert.equal((await call('GET', '/posts/999')).status, 404);
    assert.equal((await call('PUT', `/posts/${pid}`, { title: 'Hacked', content: 'x' }, B)).status, 403);
    assert.equal((await call('PUT', `/posts/${pid}`, { title: 'Edited', content: 'new' }, A)).data.post.title, 'Edited');
    r = await call('POST', `/posts/${pid}/comments`, { content: 'Nice!' }, B);
    assert.equal(r.status, 201); const cid = r.data.comment.id;
    assert.equal((await call('POST', `/posts/${pid}/comments`, { content: '' }, B)).status, 400);
    assert.equal((await call('POST', `/posts/${pid}/comments`, { content: 'hi' })).status, 401);
    assert.equal((await call('GET', `/posts/${pid}/comments`)).data.comments.length, 1);
    assert.equal((await call('GET', '/posts')).data.posts[0].comment_count, 1);
    assert.equal((await call('DELETE', `/posts/${pid}`, null, B)).status, 403);
    assert.equal((await call('DELETE', `/comments/${cid}`, null, A)).status, 200); // post owner can moderate
    r = await call('POST', `/posts/${pid}/comments`, { content: 'again' }, B);
    assert.equal((await call('DELETE', `/posts/${pid}`, null, A)).status, 200);
    assert.equal((await call('GET', `/comments/${r.data.comment.id}`)).status, 404); // cascade
    assert.equal((await call('GET', '/nope')).status, 404);
    console.log('ALL TESTS PASSED');
  } catch (e) { console.error('TEST FAILED:', e); process.exitCode = 1; }
  server.close();
});

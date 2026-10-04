// Adds demo users, posts and comments. Safe to run more than once.  Usage: npm run seed
const bcrypt = require('bcryptjs');
const { db } = require('./server');
const hash = bcrypt.hashSync('demo123', 10);
const user = n => db.prepare('INSERT OR IGNORE INTO users (username,email,password_hash) VALUES (?,?,?)').run(n, n + '@demo.com', hash)
  && db.prepare('SELECT id FROM users WHERE username=?').get(n).id;
const [a, b, c] = ['asha', 'ravi', 'meera'].map(user);
if (db.prepare('SELECT COUNT(*) n FROM posts').get().n === 0) {
  const post = db.prepare('INSERT INTO posts (user_id,title,content) VALUES (?,?,?)');
  const com = db.prepare('INSERT INTO comments (post_id,user_id,content) VALUES (?,?,?)');
  const p1 = post.run(a, 'Why I started learning full-stack development', 'Frontend showed me what users see, but the backend is where the real logic lives.\n\nIn this series I will share what I learn about REST APIs, databases and authentication, one small project at a time.').lastInsertRowid;
  const p2 = post.run(b, 'REST API design: 5 rules I follow', '1. Use nouns for URLs, verbs for HTTP methods.\n2. Return correct status codes.\n3. Validate every input.\n4. Never trust the client.\n5. Keep errors consistent and helpful.').lastInsertRowid;
  post.run(c, 'JWT vs sessions: what should a beginner use?', 'Both work. Sessions are simple and server-controlled; JWTs are stateless and great for APIs and mobile apps. Start with the one your project needs, not the one that sounds cooler.');
  com.run(p1, b, 'Great start! Looking forward to the next post.');
  com.run(p1, c, 'Relatable. Databases were the turning point for me too.');
  com.run(p2, a, 'Rule 4 is the one beginners forget the most.');
  console.log('Demo data added.');
} else console.log('Posts already exist, skipped.');
console.log('Demo logins: asha@demo.com / ravi@demo.com / meera@demo.com  (password: demo123)');

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db, init } = require('./db');
const helmet = require('helmet');

init();

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"]
    }
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: 'feng-shui-secret-change-me',
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers: user/permissions
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, name, email, role, favorites FROM users WHERE id = ?').get(req.session.userId);
}

function isAuthenticated(req) {
  return !!req.session.userId;
}

function hasPerm(user, action) {
  if (!user) return false;
  const role = user.role;
  // Unified ability mapping
  const can = {
    manageUsers: role === 'admin' || role === 'owner',
    manageAdmins: role === 'admin',
    manageContent: ['admin','owner','editor'].includes(role),
    manageProducts: ['admin','owner','editor'].includes(role),
    manageSystem: ['admin','owner'].includes(role),
    viewAdmin: ['admin','owner','editor'].includes(role)
  };
  return can[action] || false;
}

// Put current user in locals
app.use((req, res, next) => {
  res.locals.user = currentUser(req);
  next();
});

// Routes
app.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const tip = db.prepare('SELECT * FROM tips WHERE date = ?').get(today);
  const nav = db.prepare('SELECT * FROM navigation ORDER BY orderIndex ASC').all();
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 6').all();
  res.render('index', {
    tip,
    nav,
    products
  });
});

app.get('/register', (req, res) => {
  res.render('auth/register', { error: null });
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.render('auth/register', { error: 'Email and password required' });
  const exists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (exists) return res.render('auth/register', { error: 'Email already registered' });
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, passwordHash, role, favorites, createdAt)
    VALUES (?, ?, ?, 'subscriber', '[]', ?)
  `).run(name || '', email, passwordHash, new Date().toISOString());
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  req.session.userId = user.id;
  res.redirect('/account');
});

app.get('/login', (req, res) => {
  res.render('auth/login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.render('auth/login', { error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.passwordHash)) return res.render('auth/login', { error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.redirect('/account');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('products', { products });
});

app.post('/favorites/toggle', (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).send('Unauthorized');
  const user = currentUser(req);
  const { productId } = req.body;
  const favorites = JSON.parse(user.favorites || '[]');
  const idx = favorites.indexOf(Number(productId));
  if (idx === -1) favorites.push(Number(productId));
  else favorites.splice(idx, 1);
  db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(favorites), user.id);
  res.json({ ok: true, favorites });
});

app.get('/account', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/login');
  const user = currentUser(req);
  const favorites = JSON.parse(user.favorites || '[]');
  const products = db.prepare(`SELECT * FROM products WHERE id IN (${favorites.map(()=>'?').join(',') || 'NULL'})`).all(...favorites);
  res.render('account', { products });
});

app.get('/book', (req, res) => {
  res.render('book');
});

app.post('/book', (req, res) => {
  const user = currentUser(req);
  const { name, email, service, date, time, message } = req.body;
  db.prepare(`
    INSERT INTO appointments (userId, name, email, service, date, time, message, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(user?.id || null, name || user?.name || '', email || user?.email || '', service, date, time, message, new Date().toISOString());
  res.render('book_success');
});

app.get('/services', (req, res) => {
  res.render('services');
});

app.get('/tips', (req, res) => {
  const tips = db.prepare('SELECT * FROM tips ORDER BY date DESC').all();
  res.render('tips', { tips });
});

// CMS - Tips
app.get('/admin/tips', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const tips = db.prepare('SELECT * FROM tips ORDER BY date DESC').all();
  res.render('admin/tips', { tips });
});

app.post('/admin/tips', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { title, body, date, videoUrl } = req.body;
  db.prepare('INSERT INTO tips (title, body, date, videoUrl) VALUES (?, ?, ?, ?)').run(title, body, date, videoUrl);
  res.redirect('/admin/tips');
});

app.post('/admin/tips/:id/update', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  const { title, body, date, videoUrl } = req.body;
  db.prepare('UPDATE tips SET title=?, body=?, date=?, videoUrl=? WHERE id=?').run(title, body, date, videoUrl, id);
  res.redirect('/admin/tips');
});

app.post('/admin/tips/:id/delete', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  db.prepare('DELETE FROM tips WHERE id = ?').run(id);
  res.redirect('/admin/tips');
});

// CMS - Products
app.get('/admin/products', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageProducts')) return res.status(403).send('Forbidden');
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('admin/products', { products });
});

app.post('/admin/products', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageProducts')) return res.status(403).send('Forbidden');
  const { name, description, price, stock, imageUrl } = req.body;
  db.prepare('INSERT INTO products (name, description, price, stock, imageUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, description, parseFloat(price), parseInt(stock || 0), imageUrl, new Date().toISOString()
  );
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/update', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageProducts')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  const { name, description, price, stock, imageUrl } = req.body;
  db.prepare('UPDATE products SET name=?, description=?, price=?, stock=?, imageUrl=? WHERE id=?').run(
    name, description, parseFloat(price), parseInt(stock || 0), imageUrl, id
  );
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageProducts')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.redirect('/admin/products');
});

// CMS - Users (cannot manage admins by owner)
app.get('/admin/users', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageUsers')) return res.status(403).send('Forbidden');
  const users = db.prepare('SELECT id, name, email, role, createdAt FROM users ORDER BY id DESC').all();
  res.render('admin/users', { users });
});

app.post('/admin/users', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageUsers')) return res.status(403).send('Forbidden');
  const { name, email, password, role } = req.body;
  if (role === 'admin' && user.role !== 'admin') return res.status(403).send('Only Admin can create Admin accounts');
  const passwordHash = bcrypt.hashSync(password || Math.random().toString(36).slice(2), 10);
  try {
    db.prepare('INSERT INTO users (name, email, passwordHash, role, favorites, createdAt) VALUES (?, ?, ?, ?, "[]", ?)').run(
      name, email, passwordHash, role, new Date().toISOString()
    );
  } catch (e) {
    return res.status(400).send('Error creating user (email may be in use)');
  }
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/update', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageUsers')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  const { name, email, role } = req.body;
  if (role === 'admin' && user.role !== 'admin') return res.status(403).send('Only Admin can assign Admin role');
  if (user.id === Number(id) && role !== 'admin' && user.role === 'admin') {
    // Prevent admin demoting themselves in a way that leaves no admin: soft block for simplicity
    return res.status(400).send('Cannot change role of the last Admin here.');
  }
  db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(name, email, role, id);
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/delete', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageUsers')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (target.role === 'admin' && user.role !== 'admin') return res.status(403).send('Only Admin can delete Admin accounts');
  if (user.id === Number(id)) return res.status(400).send('Cannot delete yourself.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.redirect('/admin/users');
});

// CMS - Pages (simple content pages)
app.get('/admin/pages', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const pages = db.prepare('SELECT * FROM pages ORDER BY id DESC').all();
  res.render('admin/pages', { pages });
});

app.post('/admin/pages', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { slug, title, body } = req.body;
  db.prepare('INSERT INTO pages (slug, title, body) VALUES (?, ?, ?)').run(slug, title, body);
  res.redirect('/admin/pages');
});

app.post('/admin/pages/:id/update', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  const { slug, title, body } = req.body;
  db.prepare('UPDATE pages SET slug=?, title=?, body=? WHERE id=?').run(slug, title, body, id);
  res.redirect('/admin/pages');
});

app.post('/admin/pages/:id/delete', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageContent')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  db.prepare('DELETE FROM pages WHERE id=?').run(id);
  res.redirect('/admin/pages');
});

// Simple public page viewer
app.get('/p/:slug', (req, res) => {
  const { slug } = req.params;
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
  if (!page) return res.status(404).send('Page not found');
  res.render('page', { page });
});

// CMS - Settings (System Management)
app.get('/admin/settings', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageSystem')) return res.status(403).send('Forbidden');
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(s => settings[s.key] = s.value);
  res.render('admin/settings', { settings });
});

app.post('/admin/settings', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageSystem')) return res.status(403).send('Forbidden');
  const pairs = [
    'contactAddress','contactEmail',
    'socialFacebook','socialInstagram','socialPinterest',
    'smtpHost','smtpPort','smtpUser','smtpPass'
  ];
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => {
    for (const k of pairs) {
      const val = (req.body[k] || '').toString();
      stmt.run(k, val);
    }
  });
  tx();
  res.redirect('/admin/settings');
});

// CMS - Navigation
app.get('/admin/navigation', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageSystem')) return res.status(403).send('Forbidden');
  const nav = db.prepare('SELECT * FROM navigation ORDER BY orderIndex ASC').all();
  res.render('admin/navigation', { nav });
});

app.post('/admin/navigation', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageSystem')) return res.status(403).send('Forbidden');
  const { label, url } = req.body;
  const max = db.prepare('SELECT COALESCE(MAX(orderIndex), -1) as m FROM navigation').get().m;
  db.prepare('INSERT INTO navigation (label, url, orderIndex) VALUES (?, ?, ?)').run(label, url, max + 1);
  res.redirect('/admin/navigation');
});

app.post('/admin/navigation/:id/delete', (req, res) => {
  const user = currentUser(req);
  if (!user || !hasPerm(user, 'manageSystem')) return res.status(403).send('Forbidden');
  const { id } = req.params;
  db.prepare('DELETE FROM navigation WHERE id = ?').run(id);
  res.redirect('/admin/navigation');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Feng Shui Fortune Shop running at http://localhost:${PORT}`);
});

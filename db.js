const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('data.db');
db.pragma('journal_mode = WAL');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      passwordHash TEXT,
      role TEXT CHECK(role IN ('admin','owner','editor','subscriber')) NOT NULL,
      favorites TEXT DEFAULT '[]',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      imageUrl TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      date TEXT UNIQUE NOT NULL,
      videoUrl TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      name TEXT,
      email TEXT,
      service TEXT,
      date TEXT,
      time TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      body TEXT
    );

    CREATE TABLE IF NOT EXISTS navigation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      orderIndex INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed admin user
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@fengshuifortuneshop.com');
  if (!admin) {
    const passwordHash = bcrypt.hashSync('admin1234', 10);
    db.prepare(`
      INSERT INTO users (name, email, passwordHash, role, favorites, createdAt)
      VALUES (?, ?, ?, 'admin', '[]', ?)
    `).run('Site Admin', 'admin@fengshuifortuneshop.com', passwordHash, new Date().toISOString());
    console.log('Seeded admin user: admin@fengshuifortuneshop.com / admin1234');
  }

  // Seed products if empty
  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (productCount === 0) {
    const insert = db.prepare(`
      INSERT INTO products (name, description, price, stock, imageUrl, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const sample = [
      ['Prosperity Citrine Crystal Tree', 'A small artificial tree adorned with polished Citrine crystals, believed to attract wealth and abundance.', 49.99, 25, 'https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1200&auto=format&fit=crop', now],
      ['Five-Element Pagoda Keychain', 'A miniature metal pagoda designed to counter negative energy and protect against misfortune.', 14.99, 80, 'https://images.unsplash.com/photo-1518544801976-3e188c2db53a?q=80&w=1200&auto=format&fit=crop', now],
      ['Laughing Buddha Statue', 'A classic figurine, often placed in the living room to bring joy, happiness, and prosperity.', 29.99, 40, 'https://images.unsplash.com/photo-1603037231493-4e1b27cd7b3a?q=80&w=1200&auto=format&fit=crop', now],
      ['Harmony Himalayan Salt Lamp', 'A natural salt lamp providing warm light to purify the surrounding energy (chi) and create a calming environment.', 39.99, 35, 'https://images.unsplash.com/photo-1572451479139-6a0c5b4d1c97?q=80&w=1200&auto=format&fit=crop', now],
      ['Bagua Mirror (Convex)', 'A traditional feng shui tool used externally above the front door to deflect negative energy.', 24.99, 50, 'https://images.unsplash.com/photo-1579541827273-8a36f02d18b1?q=80&w=1200&auto=format&fit=crop', now],
      ['Dragon & Phoenix Art Print', 'A set of framed art symbolizing marital harmony, balance, and successful relationships.', 34.99, 20, 'https://images.unsplash.com/photo-1512427691650-1b9f26a0c5a2?q=80&w=1200&auto=format&fit=crop', now]
    ];
    const tx = db.transaction(() => {
      for (const p of sample) insert.run(...p);
    });
    tx();
    console.log('Seeded sample products');
  }

  // Seed tips if empty (31 sample tips)
  const tipCount = db.prepare('SELECT COUNT(*) as c FROM tips').get().c;
  if (tipCount === 0) {
    const insert = db.prepare(`
      INSERT INTO tips (title, body, date, videoUrl) VALUES (?, ?, ?, ?)
    `);
    const now = new Date();
    const fmt = (d) => d.toISOString().slice(0,10);
    for (let i = 0; i < 31; i++) {
      const date = new Date(now.getFullYear(), now.getMonth(), (i+1));
      insert.run(
        `Daily Tip #${i+1}`,
        `Feng Shui guidance for ${fmt(date)}. Example: Keep your entryway bright and clutter-free to invite positive energy.`,
        fmt(date),
        ''
      );
    }
    console.log('Seeded sample daily tips');
  }

  // Seed basic navigation if empty
  const navCount = db.prepare('SELECT COUNT(*) as c FROM navigation').get().c;
  if (navCount === 0) {
    const nav = [
      ['Home', '/', 0],
      ['Shop', '/products', 1],
      ['Services', '/services', 2],
      ['Tips', '/tips', 3],
      ['Book Appointment', '/book', 4],
      ['Account', '/account', 5]
    ];
    const ins = db.prepare(`INSERT INTO navigation (label, url, orderIndex) VALUES (?, ?, ?)`);
    const tx = db.transaction(() => nav.forEach(n => ins.run(...n)));
    tx();
  }

  // Seed default settings if empty
  const settingsDefaults = {
    contactAddress: '123 Nova Central',
    contactEmail: 'info@fengshuifortuneshop.com',
    socialFacebook: 'https://facebook.com',
    socialInstagram: 'https://instagram.com',
    socialPinterest: 'https://pinterest.com',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: ''
  };
  const insSet = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(settingsDefaults)) insSet.run(k, v);
}

module.exports = { db, init };

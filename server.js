const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();
const PORT = 3737;
const DB_PATH = path.join(__dirname, 'serversstatus.db');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const SERVERS = [
  { id: 'sundadigi',        label: 'SundaDigi',              url: 'https://sundadigi.com',            group: 'SundaDigi' },
  { id: 'webpanel_sunda',   label: 'WebPanel SundaDigi',     url: 'https://webpanel.sundadigi.com',   group: 'SundaDigi' },
  { id: 'lopian_sunda',     label: 'Lopian SundaDigi',       url: 'https://lopian.sundadigi.com',     group: 'SundaDigi' },
  { id: 'lopian_unpad',     label: 'Lopian Unpad',           url: 'https://lopian-unpad.sundadigi.com', group: 'SundaDigi' },
  { id: 'cloud_sunda',      label: 'Cloud SundaDigi',        url: 'https://cloud.sundadigi.com',      group: 'SundaDigi' },
  { id: 'vps_sunda',        label: 'VPS SundaDigi',          url: 'https://vps.sundadigi.com',        group: 'SundaDigi' },
  { id: 'gapura',           label: 'Gapura',                 url: 'https://gapura.org',               group: 'Gapura' },
  { id: 'ajiprosidi',       label: 'Aji Rosidi Library',     url: 'https://ajiprosidi.gapura.org',    group: 'Gapura' },
  { id: 'vps_gapura',       label: 'VPS Gapura',             url: 'https://vps.gapura.org',           group: 'Gapura' },
  { id: 'pustakajaya',      label: 'Pustaka Jaya',           url: 'https://pustakajaya.com',          group: 'Pustaka Jaya' },
  { id: 'vps_pustaka',      label: 'VPS Pustaka Jaya',       url: 'https://vps.pustakajaya.com',      group: 'Pustaka Jaya' },
  { id: 'islamika',         label: 'Islamika',               url: 'https://islamika.co',              group: 'Islamika & Rancage' },
  { id: 'rancage',          label: 'Rancage',                url: 'https://rancage.co',               group: 'Islamika & Rancage' },
];

let db = null;
let SQL = null;

async function initDB() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS uptime_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      server_url TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS server_stats (
      server_id TEXT PRIMARY KEY,
      total_checks INTEGER DEFAULT 0,
      up_checks INTEGER DEFAULT 0,
      last_status TEXT,
      last_status_code INTEGER,
      last_response_time_ms INTEGER,
      last_checked_at DATETIME,
      uptime_percent REAL DEFAULT 0
    )
  `);

  saveDB();
  console.log('✅ Database initialized:', DB_PATH);
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function checkServer(server) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(server.url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'PustakaJaya-UptimeMonitor/1.0' }
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    const status = res.status < 500 ? 'UP' : 'DOWN';
    return { status, statusCode: res.status, responseTime: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { status: 'DOWN', statusCode: null, responseTime: elapsed, error: err.message };
  }
}

async function runAllChecks() {
  console.log(`[${new Date().toISOString()}] Running uptime checks...`);
  const results = await Promise.all(SERVERS.map(async (server) => {
    const result = await checkServer(server);
    return { server, result };
  }));

  for (const { server, result } of results) {
    db.run(
      `INSERT INTO uptime_checks (server_id, server_url, status, status_code, response_time_ms) VALUES (?, ?, ?, ?, ?)`,
      [server.id, server.url, result.status, result.statusCode, result.responseTime]
    );

    const existing = db.exec(`SELECT total_checks, up_checks FROM server_stats WHERE server_id = ?`, [server.id]);
    if (existing.length === 0 || existing[0].values.length === 0) {
      const upCount = result.status === 'UP' ? 1 : 0;
      db.run(
        `INSERT INTO server_stats (server_id, total_checks, up_checks, last_status, last_status_code, last_response_time_ms, last_checked_at, uptime_percent)
         VALUES (?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [server.id, upCount, result.status, result.statusCode, result.responseTime, upCount * 100]
      );
    } else {
      const [totalChecks, upChecks] = existing[0].values[0];
      const newTotal = totalChecks + 1;
      const newUp = upChecks + (result.status === 'UP' ? 1 : 0);
      db.run(
        `UPDATE server_stats SET total_checks = ?, up_checks = ?, last_status = ?, last_status_code = ?,
         last_response_time_ms = ?, last_checked_at = CURRENT_TIMESTAMP, uptime_percent = ?
         WHERE server_id = ?`,
        [newTotal, newUp, result.status, result.statusCode, result.responseTime, (newUp / newTotal) * 100, server.id]
      );
    }
  }

  // Prune old records (keep last 30 days)
  db.run(`DELETE FROM uptime_checks WHERE checked_at < datetime('now', '-30 days')`);
  saveDB();

  console.log(`[${new Date().toISOString()}] Checks complete. Saved to DB.`);
  return results;
}

// Routes
app.get('/api/servers', (req, res) => {
  res.json(SERVERS);
});

app.get('/api/status', (req, res) => {
  const stats = db.exec(`SELECT * FROM server_stats`);
  const history = db.exec(`
    SELECT server_id, status, status_code, response_time_ms, checked_at
    FROM uptime_checks
    ORDER BY checked_at DESC
    LIMIT 260
  `);

  const statsMap = {};
  if (stats.length > 0) {
    const cols = stats[0].columns;
    for (const row of stats[0].values) {
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      statsMap[obj.server_id] = obj;
    }
  }

  const historyMap = {};
  if (history.length > 0) {
    const cols = history[0].columns;
    for (const row of history[0].values) {
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      if (!historyMap[obj.server_id]) historyMap[obj.server_id] = [];
      if (historyMap[obj.server_id].length < 20) historyMap[obj.server_id].push(obj);
    }
  }

  res.json({ stats: statsMap, history: historyMap, servers: SERVERS });
});

app.post('/api/check-now', async (req, res) => {
  const results = await runAllChecks();
  res.json({ success: true, checked: results.length });
});

app.get('/api/history/:serverId', (req, res) => {
  const { serverId } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  const rows = db.exec(
    `SELECT * FROM uptime_checks WHERE server_id = ? ORDER BY checked_at DESC LIMIT ?`,
    [serverId, limit]
  );
  if (rows.length === 0) return res.json([]);
  const cols = rows[0].columns;
  res.json(rows[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  }));
});

// Start
initDB().then(() => {
  runAllChecks();
  setInterval(runAllChecks, 3 * 60 * 1000); // every 3 minutes

  app.listen(PORT, () => {
    console.log(`🚀 Pustaka Jaya Uptime Monitor running at http://localhost:${PORT}`);
    console.log(`📁 Database: ${DB_PATH}`);
  });
});

/**
 * app.js — Entry point untuk cPanel Passenger
 */

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();

console.log('[BOOT] Starting...');
console.log('[BOOT] Node:', process.version);
console.log('[BOOT] Dir:', __dirname);

const DB_PATH = path.join(__dirname, 'serversstatus.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVERS = [
  { id: 'sundadigi', label: 'SundaDigi', url: 'https://sundadigi.com', group: 'SundaDigi' },
  { id: 'webpanel_sunda', label: 'WebPanel SundaDigi', url: 'https://webpanel.sundadigi.com', group: 'SundaDigi' },
  { id: 'lopian_sunda', label: 'Lopian SundaDigi', url: 'https://lopian.sundadigi.com', group: 'SundaDigi' },
  { id: 'lopian_unpad', label: 'Lopian Unpad', url: 'https://lopian-unpad.sundadigi.com', group: 'SundaDigi' },
  { id: 'cloud_sunda', label: 'Cloud SundaDigi', url: 'https://cloud.sundadigi.com', group: 'SundaDigi' },
  { id: 'vps_sunda', label: 'VPS SundaDigi', url: 'https://vps.sundadigi.com', group: 'SundaDigi' },
  { id: 'gapura', label: 'Gapura', url: 'https://gapura.org', group: 'Gapura' },
  { id: 'ajiprosidi', label: 'Aji Rosidi Library', url: 'https://ajiprosidi.gapura.org', group: 'Gapura' },
  { id: 'vps_gapura', label: 'VPS Gapura', url: 'https://vps.gapura.org', group: 'Gapura' },
  { id: 'pustakajaya', label: 'Pustaka Jaya', url: 'https://pustakajaya.com', group: 'Pustaka Jaya' },
  { id: 'vps_pustaka', label: 'VPS Pustaka Jaya', url: 'https://vps.pustakajaya.com', group: 'Pustaka Jaya' },
  { id: 'islamika', label: 'Islamika', url: 'https://islamika.co', group: 'Islamika & Rancage' },
  { id: 'rancage', label: 'Rancage', url: 'https://rancage.co', group: 'Islamika & Rancage' },
  { id: 'store', label: 'Pustaka Jaya Store', url: 'https://store.pustakajaya.com', group: 'Pustaka Jaya' },
  { id: 'community', label: 'Sua Pustaka Jaya', url: 'https://sua.pustakajaya.com', group: 'Pustaka Jaya' },
  { id: 'market', label: 'Pustaka Jaya Market', url: 'https://market.pustakajaya.com', group: 'Pustaka Jaya' },
  { id: 'dps', label: 'Digital Publishing System', url: 'https://dps.pustakajaya.com', group: 'Pustaka Jaya' }
];

let db = null;
let SQL = null;
let dbReady = false;
let isChecking = false;

async function initDB() {
  SQL = await initSqlJs({
    locateFile: file => require.resolve(`sql.js/dist/${file}`)
  });

  console.log('[DB] sql.js loaded');

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log('[DB] Loaded existing DB:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new DB:', DB_PATH);
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

  dbReady = true;
  console.log('[DB] Ready.');
}

function saveDB() {
  try {
    if (!db) return;

    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Save error:', err);
  }
}

async function checkServer(server) {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(server.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'PustakaJaya-UptimeMonitor/2.0',
        'Range': 'bytes=0-0'
      }
    });

    clearTimeout(timeout);

    const elapsed = Date.now() - start;
    const status = res.status < 500 ? 'UP' : 'DOWN';

    return {
      status,
      statusCode: res.status,
      responseTime: elapsed
    };
  } catch (err) {
    return {
      status: 'DOWN',
      statusCode: null,
      responseTime: Date.now() - start,
      error: err.message
    };
  }
}

async function runAllChecks() {
  if (!dbReady || isChecking) return;

  isChecking = true;

  try {
    console.log(`[CHECK] ${new Date().toISOString()} — running ${SERVERS.length} checks...`);

    const results = await Promise.all(
      SERVERS.map(async server => ({
        server,
        result: await checkServer(server)
      }))
    );

    for (const { server, result } of results) {
      db.run(
        `INSERT INTO uptime_checks
        (server_id, server_url, status, status_code, response_time_ms)
        VALUES (?,?,?,?,?)`,
        [
          server.id,
          server.url,
          result.status,
          result.statusCode ?? null,
          result.responseTime
        ]
      );

      const existing = db.exec(
        `SELECT total_checks, up_checks
         FROM server_stats
         WHERE server_id = ?`,
        [server.id]
      );

      if (!existing.length || !existing[0].values.length) {
        const up = result.status === 'UP' ? 1 : 0;

        db.run(
          `INSERT INTO server_stats
          (
            server_id,
            total_checks,
            up_checks,
            last_status,
            last_status_code,
            last_response_time_ms,
            last_checked_at,
            uptime_percent
          )
          VALUES (?,1,?,?,?,?,CURRENT_TIMESTAMP,?)`,
          [
            server.id,
            up,
            result.status,
            result.statusCode ?? null,
            result.responseTime,
            up * 100
          ]
        );
      } else {
        const [tot, ups] = existing[0].values[0];

        const newTot = tot + 1;
        const newUps = ups + (result.status === 'UP' ? 1 : 0);

        db.run(
          `UPDATE server_stats
           SET total_checks=?,
               up_checks=?,
               last_status=?,
               last_status_code=?,
               last_response_time_ms=?,
               last_checked_at=CURRENT_TIMESTAMP,
               uptime_percent=?
           WHERE server_id=?`,
          [
            newTot,
            newUps,
            result.status,
            result.statusCode ?? null,
            result.responseTime,
            (newUps / newTot) * 100,
            server.id
          ]
        );
      }
    }

    db.run(`
      DELETE FROM uptime_checks
      WHERE checked_at < datetime('now','-30 days')
    `);

    saveDB();

    console.log('[CHECK] Done.');

    return results;
  } catch (err) {
    console.error('[CHECK] Fatal:', err);
  } finally {
    isChecking = false;
  }
}

app.get('/api/servers', (_req, res) => {
  res.json(SERVERS);
});

app.get('/api/status', (_req, res) => {
  if (!dbReady) {
    return res.status(503).json({
      error: 'DB not ready'
    });
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  const monthStart = `${yyyy}-${mm}-01 00:00:00`;
  const monthLabel = now.toLocaleString('id-ID', {
    month: 'long',
    year: 'numeric'
  });

  const monthlyUptime = db.exec(`
    SELECT
      server_id,
      COUNT(*) AS total,
      SUM(CASE WHEN status='UP' THEN 1 ELSE 0 END) AS ups,
      ROUND(
        SUM(CASE WHEN status='UP' THEN 1 ELSE 0 END) * 100.0 / COUNT(*),
        2
      ) AS pct
    FROM uptime_checks
    WHERE checked_at >= '${monthStart}'
    GROUP BY server_id
  `);

  const stats = db.exec(`SELECT * FROM server_stats`);

  const history = db.exec(`
    SELECT
      server_id,
      status,
      status_code,
      response_time_ms,
      checked_at
    FROM uptime_checks
    ORDER BY checked_at DESC
    LIMIT 340
  `);

  const statsMap = {};

  if (stats.length) {
    const cols = stats[0].columns;

    for (const row of stats[0].values) {
      const obj = {};
      cols.forEach((c, i) => (obj[c] = row[i]));
      statsMap[obj.server_id] = obj;
    }
  }

  if (monthlyUptime.length) {
    const cols = monthlyUptime[0].columns;

    for (const row of monthlyUptime[0].values) {
      const obj = {};
      cols.forEach((c, i) => (obj[c] = row[i]));

      if (statsMap[obj.server_id]) {
        statsMap[obj.server_id].uptime_percent = obj.pct ?? 0;
        statsMap[obj.server_id].monthly_total_checks = obj.total;
        statsMap[obj.server_id].monthly_up_checks = obj.ups;
      }
    }
  }

  const historyMap = {};

  if (history.length) {
    const cols = history[0].columns;

    for (const row of history[0].values) {
      const obj = {};
      cols.forEach((c, i) => (obj[c] = row[i]));

      if (!historyMap[obj.server_id]) {
        historyMap[obj.server_id] = [];
      }

      if (historyMap[obj.server_id].length < 20) {
        historyMap[obj.server_id].push(obj);
      }
    }
  }

  res.json({
    stats: statsMap,
    history: historyMap,
    servers: SERVERS,
    monthLabel
  });
});

app.post('/api/check-now', async (_req, res) => {
  if (!dbReady) {
    return res.status(503).json({
      error: 'DB not ready'
    });
  }

  const results = await runAllChecks();

  res.json({
    success: true,
    checked: results?.length || 0
  });
});

app.get('/api/history/:serverId', (req, res) => {
  if (!dbReady) {
    return res.status(503).json({
      error: 'DB not ready'
    });
  }

  const limit = Math.min(
    parseInt(req.query.limit || '100', 10),
    500
  );

  const rows = db.exec(
    `SELECT *
     FROM uptime_checks
     WHERE server_id=?
     ORDER BY checked_at DESC
     LIMIT ?`,
    [req.params.serverId, limit]
  );

  if (!rows.length) {
    return res.json([]);
  }

  const cols = rows[0].columns;

  res.json(
    rows[0].values.map(row => {
      const obj = {};
      cols.forEach((c, i) => (obj[c] = row[i]));
      return obj;
    })
  );
});

(async () => {
  try {
    await initDB();

    await runAllChecks();

    setInterval(async () => {
      try {
        await runAllChecks();
      } catch (err) {
        console.error('[INTERVAL]', err);
      }
    }, 3 * 60 * 1000);

    console.log('[BOOT] Ready');
  } catch (err) {
    console.error('[BOOT] Fatal:', err);
  }
})();

module.exports = app;
/**
 * app.js — Entry point untuk cPanel Passenger
 * Version: better-sqlite3
 */

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();

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

let db;
let dbReady = false;
let isChecking = false;

function initDB() {
  db = new Database(DB_PATH);

  db.exec(`
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

  db.exec(`
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

  console.log('[DB] Ready:', DB_PATH);
}

async function checkServer(server) {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(server.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'PustakaJaya-UptimeMonitor/2.0',
        'Range': 'bytes=0-0'
      }
    });

    clearTimeout(timeout);

    return {
      status: resp.status < 500 ? 'UP' : 'DOWN',
      statusCode: resp.status,
      responseTime: Date.now() - start
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
    console.log(`[CHECK] ${new Date().toISOString()} running ${SERVERS.length} checks`);

    const results = await Promise.all(
      SERVERS.map(async server => ({
        server,
        result: await checkServer(server)
      }))
    );

    const insertCheck = db.prepare(`
      INSERT INTO uptime_checks
      (
        server_id,
        server_url,
        status,
        status_code,
        response_time_ms
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    const getStats = db.prepare(`
      SELECT total_checks, up_checks
      FROM server_stats
      WHERE server_id = ?
    `);

    const insertStats = db.prepare(`
      INSERT INTO server_stats
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
      VALUES (?,1,?,?,?,?,CURRENT_TIMESTAMP,?)
    `);

    const updateStats = db.prepare(`
      UPDATE server_stats
      SET
        total_checks=?,
        up_checks=?,
        last_status=?,
        last_status_code=?,
        last_response_time_ms=?,
        last_checked_at=CURRENT_TIMESTAMP,
        uptime_percent=?
      WHERE server_id=?
    `);

    const cleanupOld = db.prepare(`
      DELETE FROM uptime_checks
      WHERE checked_at < datetime('now','-30 days')
    `);

    const transaction = db.transaction(() => {
      for (const { server, result } of results) {
        insertCheck.run(
          server.id,
          server.url,
          result.status,
          result.statusCode,
          result.responseTime
        );

        const existing = getStats.get(server.id);

        if (!existing) {
          const up = result.status === 'UP' ? 1 : 0;

          insertStats.run(
            server.id,
            up,
            result.status,
            result.statusCode,
            result.responseTime,
            up * 100
          );
        } else {
          const newTot = existing.total_checks + 1;
          const newUps = existing.up_checks + (result.status === 'UP' ? 1 : 0);

          updateStats.run(
            newTot,
            newUps,
            result.status,
            result.statusCode,
            result.responseTime,
            (newUps / newTot) * 100,
            server.id
          );
        }
      }

      cleanupOld.run();
    });

    transaction();

    console.log('[CHECK] Done');

    return results;
  } catch (err) {
    console.error('[CHECK]', err);
    throw err;
  } finally {
    isChecking = false;
  }
}

app.get('/api/servers', (_req, res) => {
  res.json(SERVERS);
});

app.get('/api/status', (_req, res) => {
  try {
    const statsRows = db.prepare(`
      SELECT *
      FROM server_stats
    `).all();

    const historyRows = db.prepare(`
      SELECT
        server_id,
        status,
        status_code,
        response_time_ms,
        checked_at
      FROM uptime_checks
      ORDER BY checked_at DESC
      LIMIT 340
    `).all();

    const stats = {};

    for (const row of statsRows) {
      stats[row.server_id] = row;
    }

    const history = {};

    for (const row of historyRows) {
      if (!history[row.server_id]) {
        history[row.server_id] = [];
      }

      if (history[row.server_id].length < 20) {
        history[row.server_id].push(row);
      }
    }

    res.json({
      stats,
      history,
      servers: SERVERS,
      monthLabel: new Date().toLocaleString('id-ID', {
        month: 'long',
        year: 'numeric'
      })
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.post('/api/check-now', async (_req, res) => {
  try {
    const results = await runAllChecks();

    res.json({
      success: true,
      checked: results?.length || 0
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/api/history/:serverId', (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit || '100', 10),
      500
    );

    const rows = db.prepare(`
      SELECT *
      FROM uptime_checks
      WHERE server_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(req.params.serverId, limit);

    res.json(rows);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

(async () => {
  try {
    initDB();

    await runAllChecks();

    setInterval(() => {
      runAllChecks().catch(console.error);
    }, 3 * 60 * 1000);

    console.log('[BOOT] Ready');
  } catch (err) {
    console.error('[BOOT]', err);
  }
})();

module.exports = app;
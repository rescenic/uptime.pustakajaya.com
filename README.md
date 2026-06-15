# Pustaka Jaya Uptime Monitor — cPanel Edition

## Struktur File

```
uptime.pustakajaya.com/
├── app.js              ← Entry point Passenger (JANGAN rename)
├── package.json
├── serversstatus.db    ← Auto-dibuat saat pertama jalan
├── public/
│   └── index.html      ← Dashboard UI
└── node_modules/       ← Dibuat setelah npm install
```

## Deploy ke cPanel

### 1. Upload File
Upload semua file ini ke direktori aplikasi.
Contoh path: `/home/username/uptime.pustakajaya.com/`

Upload via File Manager cPanel atau SCP:
```bash
scp -r . username@server.com:/home/username/uptime.pustakajaya.com/
```

### 2. Setup Node.js App di cPanel
1. Buka cPanel → **Setup Node.js App**
2. Klik **Create Application**
3. Isi form:
   - **Node.js version**: 18.x atau 20.x (pilih yang tersedia)
   - **Application mode**: Production
   - **Application root**: `uptime.pustakajaya.com` (relatif dari home)
   - **Application URL**: `uptime.pustakajaya.com`
   - **Application startup file**: `app.js`
4. Klik **Create**

### 3. Install Dependencies
Setelah app dibuat, cPanel menampilkan tombol **Run NPM Install** — klik itu.

Atau via SSH:
```bash
cd /home/username/uptime.pustakajaya.com
source /home/username/nodevenv/uptime.pustakajaya.com/18/bin/activate
npm install
```

### 4. Start App
Klik **Start App** di cPanel, atau via SSH:
```bash
# Passenger otomatis jalan saat ada request
# Untuk restart manual:
touch tmp/restart.txt
```

### 5. Subdomain DNS
Pastikan `uptime.pustakajaya.com` sudah diarahkan ke server ini.
cPanel biasanya auto-setup subdomain saat setup Node.js App.

## Cara Kerja

- **Pengecekan otomatis** setiap 3 menit via `setInterval` di `app.js`
- **Database** disimpan di `serversstatus.db` (sql.js — pure JavaScript SQLite, tidak butuh native compile)
- **Dashboard** di `public/index.html` memanggil `/api/status` setiap 3 menit
- **⚡ Check Now** tersedia untuk pengecekan manual instan

## Endpoints API

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/status` | Status semua server + histori 20 check terakhir |
| GET | `/api/servers` | Daftar server yang dimonitor |
| POST | `/api/check-now` | Trigger pengecekan manual |
| GET | `/api/history/:id` | Histori lengkap per server |

## Troubleshooting

**App tidak start:**
- Cek error log di cPanel → Logs
- Pastikan `node_modules` sudah ada (npm install)

**DB permission error:**
```bash
chmod 755 /home/username/uptime.pustakajaya.com/
touch serversstatus.db && chmod 644 serversstatus.db
```

**Restart app setelah update:**
```bash
touch /home/username/uptime.pustakajaya.com/tmp/restart.txt
```

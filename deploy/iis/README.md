# Hosting the i-Map NextJS app on IIS

The app is a Node.js server (Next.js `output: "standalone"`), not static files. IIS runs it through
**HttpPlatformHandler**, which starts `node server.js`, restarts it if it stops, and forwards requests
to it. IIS keeps the host name and HTTPS certificate.

## 1. Build and package (on the build machine)

Settings fixed at build time must be right **before** building:

- `GEOMATICS_URL` - the py-Geomatics the demo uses (the `/geomatics` rewrite is compiled in).
- `NEXT_PUBLIC_BASE_PATH` - only if the site lives under a sub-path, e.g. `/imaps_demo`
  (leave unset when it's the root of its own host name).

```powershell
$env:GEOMATICS_URL = "https://ops-mz0075jf.cihs.ad.gov.on.ca/geomatics"
npm run build
npm run package:iis
```

This produces `dist-iis/` (server, static assets, `public/`, `web.config`, empty `logs/`). It refuses
a build whose `/geomatics` rewrite points at localhost, and it leaves out the build machine's `.env`.

## 2. One-time server setup

1. Install **Node.js 22** (LTS, x64) - `C:\Program Files\nodejs\node.exe`.
2. Install **HttpPlatformHandler v1.2** (x64) from Microsoft.
3. In IIS Manager, create an app pool: **.NET CLR version: No Managed Code**.
4. Create the site (or an application under an existing site, matching `NEXT_PUBLIC_BASE_PATH`)
   pointing at the folder you copy `dist-iis/` into, using that app pool, with your HTTPS binding.
5. Give the app pool identity (`IIS AppPool\<pool name>`) **Read & execute** on the folder and
   **Modify** on its `logs` subfolder.

## 3. Configure and start

Copy `dist-iis/` to the server, then edit its `web.config` placeholders:

| Setting | Value |
|---|---|
| `GEOMATICS_URL` | Same py-Geomatics as the build |
| `APP_ALLOWED_ORIGINS` | The demo's host name as users type it, e.g. `imaps-demo.cihs.ad.gov.on.ca` |
| `DATABASE_URL` | `ner_master` connection string |
| `NEXTAUTH_SECRET` | Any long random string |
| `NODE_EXTRA_CA_CERTS` | Only if server-side calls to py-Geomatics fail with a certificate error |

Recycle the app pool (or `iisreset`). The first request starts Node (a few seconds).

## Updating

Rebuild, re-run `npm run package:iis`, stop the app pool, replace the folder's contents
**except `web.config`** (keep your filled-in copy), start the app pool.

## Troubleshooting

- **502.3 / 502.5 from IIS** - Node didn't start: check `logs\node_*.log`, and that
  `processPath` in `web.config` points at `node.exe`.
- **Map loads but layers/login fail** - check `GEOMATICS_URL` and, if the logs show a certificate
  error, set `NODE_EXTRA_CA_CERTS`.
- **My Maps save returns 403** - `APP_ALLOWED_ORIGINS` doesn't match the host name in the browser.
- `[DB] Pool warmup error ... 1433` in the logs is harmless (unused County of Simcoe SQL Server
  features).

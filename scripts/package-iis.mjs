#!/usr/bin/env node
/**
 * Assemble the IIS deploy folder (dist-iis/) from a finished `npm run build`.
 *
 * `output: "standalone"` builds a Node server in .next/standalone but deliberately leaves out
 * .next/static and public/ - this copies them in, adds deploy/iis/web.config and a logs folder,
 * and drops the .env Next copies into the standalone output (this machine's dev settings and
 * secrets; the server gets its settings from web.config instead).
 *
 * It also refuses a build whose /geomatics rewrite points at localhost: that rewrite is fixed at
 * build time from GEOMATICS_URL, so a build made with a dev .env would send the demo's logins and
 * Spatial Tool calls to the build machine. Pass --allow-local to package it anyway.
 *
 * Usage: npm run build && npm run package:iis
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "dist-iis");
const allowLocal = process.argv.includes("--allow-local");

const fail = (msg) => {
  console.error(`\n[package-iis] ${msg}\n`);
  process.exit(1);
};

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  fail("No .next/standalone/server.js - run `npm run build` first.");
}

// Where does the built /geomatics rewrite point?
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".next", "routes-manifest.json"), "utf8"));
const rewrites = Array.isArray(manifest.rewrites) ? manifest.rewrites : Object.values(manifest.rewrites ?? {}).flat();
const geomatics = rewrites.find((r) => r.source?.includes("/geomatics"));
const geomaticsTarget = geomatics ? geomatics.destination.replace("/:path*", "") : "(none)";
if (/\/\/(localhost|127\.0\.0\.1)[:/]/i.test(geomaticsTarget) && !allowLocal) {
  fail(
    `This build's /geomatics rewrite points at ${geomaticsTarget}.\n` +
      "  Rebuild with GEOMATICS_URL set to the py-Geomatics the demo should use, e.g. (PowerShell):\n" +
      '    $env:GEOMATICS_URL="https://ops-mz0075jf.cihs.ad.gov.on.ca/geomatics"; npm run build\n' +
      "  or re-run with --allow-local if that's really intended.",
  );
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.copyFileSync(path.join(root, "deploy", "iis", "web.config"), path.join(out, "web.config"));
fs.mkdirSync(path.join(out, "logs"), { recursive: true });

// Never ship the build machine's .env files
for (const f of fs.readdirSync(out)) {
  if (f.startsWith(".env")) fs.rmSync(path.join(out, f), { force: true });
}

const basePath = manifest.basePath || "(site root)";
console.log(`
[package-iis] dist-iis/ is ready to copy to the IIS server.
  base path:        ${basePath}
  /geomatics ->     ${geomaticsTarget}
Next: fill in the placeholders in dist-iis/web.config (see deploy/iis/README.md).`);

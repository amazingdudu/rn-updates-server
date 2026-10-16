import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs/promises';
import mysql, { RowDataPacket } from 'mysql2/promise';
import path from 'path';

declare global {
  var otaDatabasePool: mysql.Pool | undefined;

  var otaSchemaReady: Promise<void> | undefined;
}

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;

export const pool =
  global.otaDatabasePool ??
  (global.otaDatabasePool = mysql.createPool({
    host: databaseUrl?.hostname,
    port: databaseUrl?.port ? Number(databaseUrl.port) : 3306,
    user: databaseUrl ? decodeURIComponent(databaseUrl.username) : undefined,
    password: databaseUrl ? decodeURIComponent(databaseUrl.password) : undefined,
    database: databaseUrl ? decodeURIComponent(databaseUrl.pathname.slice(1)) : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  }));

export async function ensureDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  global.otaSchemaReady ??= initializeDatabase();
  await global.otaSchemaReady;
}

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role ENUM('admin','publisher') NOT NULL DEFAULT 'publisher',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS applications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT fk_apps_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS updates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT UNSIGNED NOT NULL,
    runtime_version VARCHAR(100) NOT NULL,
    release_id VARCHAR(17) NOT NULL,
    update_id CHAR(36) NOT NULL,
    message VARCHAR(4000) NOT NULL DEFAULT '',
    directory VARCHAR(500) NOT NULL,
    status ENUM('pending','published','rejected','withdrawn') NOT NULL DEFAULT 'pending',
    uploaded_by BIGINT UNSIGNED NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL,
    reviewed_at TIMESTAMP NULL,
    UNIQUE KEY uq_release (application_id, runtime_version, release_id),
    KEY ix_active_update (application_id, runtime_version, status, release_id),
    CONSTRAINT fk_updates_app FOREIGN KEY (application_id) REFERENCES applications(id),
    CONSTRAINT fk_updates_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_updates_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS update_installations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT UNSIGNED NOT NULL,
    update_id CHAR(36) NOT NULL,
    device_id CHAR(36) NOT NULL,
    runtime_version VARCHAR(100) NOT NULL,
    platform ENUM('android','ios') NOT NULL,
    status ENUM('detected','downloaded','success','failure') NOT NULL DEFAULT 'detected',
    detected_at TIMESTAMP NULL,
    downloaded_at TIMESTAMP NULL,
    succeeded_at TIMESTAMP NULL,
    failed_at TIMESTAMP NULL,
    failure_code VARCHAR(80) NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_installation_update (application_id, update_id, device_id),
    KEY ix_installation_update_status (application_id, update_id, status),
    KEY ix_installation_seen (last_seen_at),
    CONSTRAINT fk_installations_app FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [detectedColumns] = await pool.query<RowDataPacket[]>(
    "SHOW COLUMNS FROM update_installations LIKE 'detected_at'",
  );
  if (!detectedColumns.length) {
    await pool.query(
      'ALTER TABLE update_installations ADD COLUMN detected_at TIMESTAMP NULL AFTER status',
    );
  }
  await pool.query(
    "ALTER TABLE update_installations MODIFY status ENUM('detected','downloaded','success','failure') NOT NULL DEFAULT 'detected'",
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_audit_created (created_at),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const adminUsername = process.env.OTA_ADMIN_USERNAME;
  const adminPassword = process.env.OTA_ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [
      adminUsername,
    ]);
    if (!rows.length) {
      await pool.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
        [adminUsername, await bcrypt.hash(adminPassword, 12)],
      );
    }
  }

  const defaultSlug = (process.env.OTA_DEFAULT_APP_SLUG ?? 'rntest').toLowerCase();
  const defaultName = process.env.OTA_DEFAULT_APP_NAME ?? 'RNTEST';
  await pool.execute('INSERT IGNORE INTO applications (slug, name) VALUES (?, ?)', [
    defaultSlug,
    defaultName,
  ]);
  await importLegacyReleases(defaultSlug);
}

async function importLegacyReleases(slug: string) {
  const [apps] = await pool.query<RowDataPacket[]>('SELECT id FROM applications WHERE slug = ?', [
    slug,
  ]);
  const appId = apps[0]?.id as number | undefined;
  if (!appId) return;
  const root = path.resolve('updates');
  const runtimes = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const runtime of runtimes.filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
  )) {
    const releases = await fs
      .readdir(path.join(root, runtime.name), { withFileTypes: true })
      .catch(() => []);
    for (const release of releases.filter(
      (entry) => entry.isDirectory() && /^\d{10,17}$/.test(entry.name),
    )) {
      const directory = path.join('updates', runtime.name, release.name);
      try {
        const rollback = await fs
          .access(path.join(directory, 'rollback'))
          .then(() => true)
          .catch(() => false);
        const metadataBytes = await fs.readFile(path.join(directory, 'metadata.json')).catch(() => {
          if (!rollback) throw new Error('No metadata or rollback marker.');
          return Buffer.from(directory);
        });
        const metadata = rollback ? {} : JSON.parse(metadataBytes.toString('utf8'));
        const info = metadata.updateInfo ?? {};
        const hash = crypto.createHash('sha256').update(metadataBytes).digest('hex');
        const updateId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
        await pool.execute(
          `INSERT IGNORE INTO updates (application_id, runtime_version, release_id, update_id, message, directory, status, published_at)
           VALUES (?, ?, ?, ?, ?, ?, 'published', FROM_UNIXTIME(? / 1000))`,
          [
            appId,
            runtime.name,
            release.name,
            updateId,
            String(info.message ?? (rollback ? 'Rollback to embedded update' : '')).slice(0, 4000),
            directory,
            Number(release.name),
          ],
        );
      } catch {
        // Ignore legacy staging, rollback, and incomplete export folders.
      }
    }
  }
}

export type SessionUser = { id: number; username: string; role: 'admin' | 'publisher' };
const SESSION_COOKIE = 'ota_session';

function sessionSecret() {
  const secret = process.env.OTA_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('OTA_SESSION_SECRET must contain at least 32 characters.');
  return secret;
}

export function createSessionToken(user: SessionUser) {
  const expires = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = Buffer.from(
    JSON.stringify({ id: user.id, username: user.username, role: user.role, expires }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function readSessionToken(token?: string): SessionUser | null {
  if (!token) return null;
  try {
    const [payload, supplied] = token.split('.');
    const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest();
    const actual = Buffer.from(supplied, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.expires < Date.now() / 1000 || !['admin', 'publisher'].includes(decoded.role))
      return null;
    return { id: Number(decoded.id), username: decoded.username, role: decoded.role };
  } catch {
    return null;
  }
}

export function getSessionUser(req: { headers: { cookie?: string; authorization?: string } }) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return readSessionToken(req.headers.authorization.slice(7));
  }
  const token = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return readSessionToken(token ? decodeURIComponent(token) : undefined);
}

export function setSessionCookie(
  res: { setHeader(name: string, value: string): void },
  token: string,
) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(res: { setHeader(name: string, value: string): void }) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
}

export async function audit(
  userId: number | null,
  action: string,
  targetType: string,
  targetId: string,
  details: unknown = null,
) {
  await pool.execute(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId, action, targetType, targetId, details ? JSON.stringify(details) : null],
  );
}

export async function getPublishedDirectory(appSlug: string, runtimeVersion: string) {
  await ensureDatabase();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.directory FROM updates u JOIN applications a ON a.id=u.application_id
     WHERE a.slug=? AND a.deleted_at IS NULL AND u.runtime_version=? AND u.status='published'
     ORDER BY CAST(u.release_id AS UNSIGNED) DESC LIMIT 1`,
    [appSlug, runtimeVersion],
  );
  if (!rows.length) throw new Error('No published update for this app and runtime.');
  const directory = path.resolve(String(rows[0].directory));
  const root = path.resolve('updates') + path.sep;
  if (!directory.startsWith(root)) throw new Error('Invalid update directory in database.');
  return directory;
}

import crypto from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { t as listTar, x as extractTar } from 'tar';

import { audit, ensureDatabase, getSessionUser, pool } from '../../common/database';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

class PublishError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isValidRuntime(value: string) {
  return /^[A-Za-z0-9._-]{1,100}$/.test(value) && value !== '.' && value !== '..';
}

function normalizedArchivePath(filename: string) {
  const pathWithoutDotPrefix = filename
    .replaceAll('\\', '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  if (!pathWithoutDotPrefix) return '';
  if (
    pathWithoutDotPrefix.startsWith('/') ||
    /^[A-Za-z]:/.test(pathWithoutDotPrefix) ||
    pathWithoutDotPrefix.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new PublishError(`Unsafe path in update archive: ${filename}`);
  }
  return pathWithoutDotPrefix;
}

async function validateArchive(archivePath: string) {
  const paths = new Set<string>();
  let totalBytes = 0;
  let count = 0;
  await listTar({
    file: archivePath,
    gzip: true,
    strict: true,
    onReadEntry(entry) {
      count += 1;
      if (count > MAX_ENTRIES) throw new PublishError('Too many files in update archive.', 413);
      if (!['File', 'Directory'].includes(entry.type)) {
        throw new PublishError(`Unsupported file type in update archive: ${entry.path}`);
      }
      const relativePath = normalizedArchivePath(entry.path);
      if (!relativePath) return;
      if (paths.has(relativePath))
        throw new PublishError(`Duplicate archive path: ${relativePath}`);
      paths.add(relativePath);
      if (entry.type === 'File') {
        if (entry.size > MAX_FILE_BYTES) {
          throw new PublishError(`Update file exceeds 128 MB: ${relativePath}`, 413);
        }
        totalBytes += entry.size;
        if (totalBytes > MAX_EXTRACTED_BYTES) {
          throw new PublishError('Expanded update exceeds 1 GB.', 413);
        }
      }
    },
  });
  return paths;
}

async function verifyExport(stagingDirectory: string) {
  const metadata = JSON.parse(
    await fs.readFile(path.join(stagingDirectory, 'metadata.json'), 'utf8'),
  );
  const expoConfig = JSON.parse(
    await fs.readFile(path.join(stagingDirectory, 'expoConfig.json'), 'utf8'),
  );
  const releaseInfo = JSON.parse(
    await fs.readFile(path.join(stagingDirectory, 'release.json'), 'utf8'),
  );
  if (typeof expoConfig.runtimeVersion !== 'string' || !isValidRuntime(expoConfig.runtimeVersion)) {
    throw new PublishError('Invalid runtimeVersion in Expo config.');
  }
  if (
    !releaseInfo ||
    typeof releaseInfo.release !== 'string' ||
    !/^\d{10,17}$/.test(releaseInfo.release) ||
    typeof releaseInfo.message !== 'string' ||
    releaseInfo.message.length > 4000
  ) {
    throw new PublishError('Invalid release.json.');
  }
  if (
    metadata.updateInfo?.release !== releaseInfo.release ||
    metadata.updateInfo?.message !== releaseInfo.message
  ) {
    throw new PublishError('Release information does not match metadata.json.');
  }
  for (const platform of ['android', 'ios']) {
    const entry = metadata.fileMetadata?.[platform];
    if (!entry?.bundle || !Array.isArray(entry.assets)) {
      throw new PublishError(`Missing ${platform} export metadata.`);
    }
    for (const filename of [
      entry.bundle,
      ...entry.assets.map((asset: { path: string }) => asset.path),
    ]) {
      const relativePath = normalizedArchivePath(filename);
      if (!relativePath) throw new PublishError(`Invalid ${platform} file path.`);
      const filePath = path.resolve(stagingDirectory, relativePath);
      if (!filePath.startsWith(`${stagingDirectory}${path.sep}`)) {
        throw new PublishError(`Invalid ${platform} file path: ${filename}`);
      }
      const file = await fs.stat(filePath).catch(() => null);
      if (!file?.isFile()) throw new PublishError(`Missing ${platform} export file: ${filename}`);
    }
  }
  return { metadata, expoConfig, releaseInfo };
}

export default async function publishEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Expected POST.' });
    return;
  }
  let actor;
  try {
    await ensureDatabase();
    actor = getSessionUser(req);
  } catch (error) {
    res
      .status(503)
      .json({ error: error instanceof Error ? error.message : 'Database unavailable.' });
    return;
  }
  if (!actor) {
    res.status(401).json({ error: 'A valid user login is required.' });
    return;
  }
  const appSlug = req.headers['x-app-slug'];
  if (typeof appSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(appSlug)) {
    res.status(400).json({ error: 'Missing or invalid x-app-slug header.' });
    return;
  }
  const [applicationRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM applications WHERE slug=? AND deleted_at IS NULL',
    [appSlug],
  );
  if (!applicationRows.length) {
    res.status(404).json({ error: 'Application not found.' });
    return;
  }
  const applicationId = Number(applicationRows[0].id);
  const contentType = req.headers['content-type']?.toLowerCase();
  if (contentType !== 'application/gzip' && contentType !== 'application/x-gzip') {
    res.status(415).json({ error: 'Expected a gzip-compressed tar archive.' });
    return;
  }

  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (contentLength > MAX_ARCHIVE_BYTES) {
    res.status(413).json({ error: 'Upload exceeds the 512 MB archive limit.' });
    return;
  }
  const expectedArchiveHash = req.headers['x-archive-sha256'];
  if (typeof expectedArchiveHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedArchiveHash)) {
    res.status(400).json({ error: 'Missing or invalid x-archive-sha256 header.' });
    return;
  }

  const updatesRoot = path.resolve('updates');
  const stagingRoot = path.join(updatesRoot, '.staging');
  const archivePath = path.join(stagingRoot, `upload-${crypto.randomUUID()}.tar.gz`);
  const stagingDirectory = path.join(stagingRoot, `extract-${crypto.randomUUID()}`);
  try {
    await fs.mkdir(stagingRoot, { recursive: true });
    let totalBytes = 0;
    const archiveHash = crypto.createHash('sha256');
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        archiveHash.update(chunk);
        callback(
          totalBytes > MAX_ARCHIVE_BYTES
            ? new PublishError('Upload exceeds the 512 MB archive limit.', 413)
            : null,
          chunk,
        );
      },
    });
    await pipeline(req, limiter, createWriteStream(archivePath, { flags: 'wx' }));
    const archiveStat = await fs.stat(archivePath);
    if (!archiveStat.size) throw new PublishError('The uploaded archive is empty.');
    const actualArchiveHash = archiveHash.digest('hex');
    const expectedHashBuffer = Buffer.from(expectedArchiveHash, 'hex');
    const actualHashBuffer = Buffer.from(actualArchiveHash, 'hex');
    if (!crypto.timingSafeEqual(expectedHashBuffer, actualHashBuffer)) {
      throw new PublishError('Archive SHA-256 checksum mismatch.');
    }

    await validateArchive(archivePath);
    await fs.mkdir(stagingDirectory, { recursive: true });
    await extractTar({
      file: archivePath,
      cwd: stagingDirectory,
      gzip: true,
      strict: true,
      preservePaths: false,
      unlink: false,
    });

    const { metadata, expoConfig, releaseInfo } = await verifyExport(stagingDirectory);
    if (typeof expoConfig.slug !== 'string' || expoConfig.slug.toLowerCase() !== appSlug) {
      throw new PublishError('Expo config slug does not match the selected application.');
    }
    const runtimeVersion = expoConfig.runtimeVersion as string;
    const { release, message } = releaseInfo;
    if (typeof release !== 'string' || !/^\d{10,17}$/.test(release)) {
      throw new PublishError('Invalid release timestamp.');
    }
    if (typeof message !== 'string' || message.length > 4000) {
      throw new PublishError('Invalid update message.');
    }
    if (metadata.updateInfo?.release !== release || metadata.updateInfo?.message !== message) {
      throw new PublishError('Release information does not match metadata.json.');
    }
    const [latestRows] = await pool.execute<RowDataPacket[]>(
      'SELECT MAX(CAST(release_id AS UNSIGNED)) AS latest FROM updates WHERE application_id=? AND runtime_version=?',
      [applicationId, runtimeVersion],
    );
    if (Number(release) <= Number(latestRows[0]?.latest ?? 0)) {
      throw new PublishError(
        'Release timestamp must be newer than existing uploads for this app and runtime.',
        409,
      );
    }
    const runtimeDirectory = path.join(updatesRoot, 'apps', appSlug, runtimeVersion);
    await fs.mkdir(runtimeDirectory, { recursive: true });
    const destination = path.join(runtimeDirectory, release);
    await fs.rename(stagingDirectory, destination);
    const updateHash = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(destination, 'metadata.json')))
      .digest('hex');
    const updateId = `${updateHash.slice(0, 8)}-${updateHash.slice(8, 12)}-${updateHash.slice(12, 16)}-${updateHash.slice(16, 20)}-${updateHash.slice(20, 32)}`;
    const relativeDirectory = path.relative(process.cwd(), destination);
    const [insertResult] = await pool.execute(
      `INSERT INTO updates (application_id, runtime_version, release_id, update_id, message, directory, status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [applicationId, runtimeVersion, release, updateId, message, relativeDirectory, actor.id],
    );
    const updateRecordId = Number((insertResult as { insertId: number }).insertId);
    await audit(actor.id, 'update.upload', 'update', String(updateRecordId), {
      app: appSlug,
      runtimeVersion,
      release,
      updateId,
    });
    res.status(201).json({
      status: 'pending',
      id: updateRecordId,
      app: appSlug,
      runtimeVersion,
      release,
      updateId,
      directory: relativeDirectory,
    });
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    console.error('Update publish failed:', error);
    const status = error instanceof PublishError ? error.statusCode : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Invalid upload.' });
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => {});
  }
}

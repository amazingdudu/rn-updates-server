import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';

import { ensureDatabase, getSessionUser, pool } from '../../../../common/database';

export default async function appUpdates(req: NextApiRequest, res: NextApiResponse) {
  await ensureDatabase();
  if (!getSessionUser(req)) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Expected GET.' });
    return;
  }
  const slug = req.query.slug;
  if (typeof slug !== 'string') {
    res.status(400).json({ error: 'Invalid app slug.' });
    return;
  }
  const [apps] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM applications WHERE slug=? AND deleted_at IS NULL',
    [slug],
  );
  if (!apps.length) {
    res.status(404).json({ error: 'App not found.' });
    return;
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.runtime_version AS runtimeVersion, u.release_id AS \`release\`,
    u.update_id AS updateId, u.message, u.status, u.directory, u.created_at AS createdAt,
    u.published_at AS publishedAt, uploader.username AS uploadedBy, reviewer.username AS reviewedBy,
    IF(u.id=(SELECT u2.id FROM updates u2 WHERE u2.application_id=u.application_id AND u2.runtime_version=u.runtime_version AND u2.status='published' ORDER BY CAST(u2.release_id AS UNSIGNED) DESC LIMIT 1), 1, 0) AS isCurrent,
    COALESCE(stats.androidDetected, 0) AS androidDetected,
    COALESCE(stats.androidDownloaded, 0) AS androidDownloaded,
    COALESCE(stats.androidSucceeded, 0) AS androidSucceeded,
    COALESCE(stats.androidFailed, 0) AS androidFailed,
    COALESCE(stats.iosDetected, 0) AS iosDetected,
    COALESCE(stats.iosDownloaded, 0) AS iosDownloaded,
    COALESCE(stats.iosSucceeded, 0) AS iosSucceeded,
    COALESCE(stats.iosFailed, 0) AS iosFailed
    FROM updates u LEFT JOIN users uploader ON uploader.id=u.uploaded_by LEFT JOIN users reviewer ON reviewer.id=u.reviewed_by
    LEFT JOIN (
      SELECT application_id, update_id,
        SUM(platform='android' AND detected_at IS NOT NULL) AS androidDetected,
        SUM(platform='android' AND downloaded_at IS NOT NULL) AS androidDownloaded,
        SUM(platform='android' AND status='success') AS androidSucceeded,
        SUM(platform='android' AND status='failure') AS androidFailed,
        SUM(platform='ios' AND detected_at IS NOT NULL) AS iosDetected,
        SUM(platform='ios' AND downloaded_at IS NOT NULL) AS iosDownloaded,
        SUM(platform='ios' AND status='success') AS iosSucceeded,
        SUM(platform='ios' AND status='failure') AS iosFailed
      FROM update_installations GROUP BY application_id, update_id
    ) stats ON stats.application_id=u.application_id AND stats.update_id=u.update_id
    WHERE u.application_id=? ORDER BY u.created_at DESC`,
    [apps[0].id],
  );
  res.status(200).json(rows);
}

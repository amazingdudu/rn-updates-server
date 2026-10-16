import { RowDataPacket } from 'mysql2/promise';
import type { NextApiRequest, NextApiResponse } from 'next';

import { ensureDatabase, pool } from '../../../common/database';

const updateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const runtimePattern = /^[A-Za-z0-9._-]{1,100}$/;
const failureCodePattern = /^[A-Za-z0-9_.-]{1,80}$/;

export default async function updateAnalytics(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Expected POST.' });
    return;
  }

  try {
    await ensureDatabase();
    const { app, updateId, deviceId, runtimeVersion, platform, event, failureCode } =
      req.body ?? {};
    if (
      typeof app !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{1,79}$/.test(app) ||
      typeof updateId !== 'string' ||
      !updateIdPattern.test(updateId) ||
      typeof deviceId !== 'string' ||
      !deviceIdPattern.test(deviceId) ||
      typeof runtimeVersion !== 'string' ||
      !runtimePattern.test(runtimeVersion) ||
      !['android', 'ios'].includes(platform) ||
      !['detected', 'downloaded', 'success', 'failure'].includes(event) ||
      (failureCode !== undefined &&
        (typeof failureCode !== 'string' || !failureCodePattern.test(failureCode)))
    ) {
      res.status(400).json({ error: 'Invalid update analytics event.' });
      return;
    }

    const [updates] = await pool.execute<RowDataPacket[]>(
      `SELECT u.application_id AS applicationId FROM updates u
       JOIN applications a ON a.id=u.application_id
       WHERE a.slug=? AND a.deleted_at IS NULL AND u.update_id=? AND u.runtime_version=? LIMIT 1`,
      [app, updateId, runtimeVersion],
    );
    if (!updates.length) {
      // Ignore events from builds or updates that are not managed by this server.
      res.status(202).json({ accepted: false });
      return;
    }

    await pool.execute(
      `INSERT INTO update_installations
       (application_id, update_id, device_id, runtime_version, platform, status,
        detected_at, downloaded_at, succeeded_at, failed_at, failure_code)
       VALUES (?, ?, ?, ?, ?, ?,
        IF(?='detected', CURRENT_TIMESTAMP, NULL),
        IF(? IN ('downloaded','success') OR (?='failure' AND ?='UpdateFailedToLoad'), CURRENT_TIMESTAMP, NULL),
        IF(?='success', CURRENT_TIMESTAMP, NULL),
        IF(?='failure', CURRENT_TIMESTAMP, NULL), ?)
       ON DUPLICATE KEY UPDATE
        status=CASE
          WHEN status='success' OR VALUES(status)='success' THEN 'success'
          WHEN status='failure' OR VALUES(status)='failure' THEN 'failure'
          WHEN status='downloaded' OR VALUES(status)='downloaded' THEN 'downloaded'
          ELSE 'detected'
        END,
        platform=VALUES(platform),
        runtime_version=VALUES(runtime_version),
        detected_at=IF(VALUES(status)='detected', COALESCE(detected_at, CURRENT_TIMESTAMP), detected_at),
        downloaded_at=IF(VALUES(status) IN ('downloaded','success') OR (VALUES(status)='failure' AND VALUES(failure_code)='UpdateFailedToLoad'), COALESCE(downloaded_at, CURRENT_TIMESTAMP), downloaded_at),
        succeeded_at=IF(VALUES(status)='success', CURRENT_TIMESTAMP, succeeded_at),
        failed_at=IF(VALUES(status)='failure' AND status<>'success', CURRENT_TIMESTAMP, failed_at),
        failure_code=IF(VALUES(status)='success', NULL, IF(VALUES(status)='failure' AND status<>'success', VALUES(failure_code), failure_code)),
        last_seen_at=CURRENT_TIMESTAMP`,
      [
        Number(updates[0].applicationId),
        updateId.toLowerCase(),
        deviceId.toLowerCase(),
        runtimeVersion,
        platform,
        event,
        event,
        event,
        event,
        failureCode ?? null,
        event,
        event,
        failureCode ?? null,
      ],
    );
    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error('Update analytics event failed:', error);
    res.status(503).json({ error: 'Analytics temporarily unavailable.' });
  }
}

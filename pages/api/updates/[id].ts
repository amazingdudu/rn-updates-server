import fs from 'fs/promises';
import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

import { audit, ensureDatabase, getSessionUser, pool } from '../../../common/database';

export default async function updateAction(req: NextApiRequest, res: NextApiResponse) {
  await ensureDatabase();
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Expected POST.' });
    return;
  }
  const id = Number(req.query.id);
  const action = req.body?.action;
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !['publish', 'withdraw', 'reject', 'delete'].includes(action)
  ) {
    res.status(400).json({ error: 'Invalid update action.' });
    return;
  }
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM updates WHERE id=?', [id]);
  const update = rows[0];
  if (!update) {
    res.status(404).json({ error: 'Update not found.' });
    return;
  }
  if (action === 'delete') {
    if (user.role !== 'admin' || update.status === 'published') {
      res
        .status(403)
        .json({ error: 'Only administrators can delete non-published update records.' });
      return;
    }
    const directory = path.resolve(String(update.directory));
    const updatesRoot = path.resolve('updates') + path.sep;
    if (!directory.startsWith(updatesRoot)) {
      res.status(400).json({ error: 'Unsafe update directory.' });
      return;
    }
    await pool.execute('DELETE FROM updates WHERE id=?', [id]);
    await fs.rm(directory, { recursive: true, force: true });
    await audit(user.id, 'update.delete', 'update', String(id));
    res.status(200).json({ ok: true });
    return;
  }
  const nextStatus =
    action === 'publish' ? 'published' : action === 'withdraw' ? 'withdrawn' : 'rejected';
  const allowed =
    action === 'publish' ? ['pending'] : action === 'withdraw' ? ['published'] : ['pending'];
  if (!allowed.includes(update.status)) {
    res.status(409).json({ error: `Cannot ${action} an update with status ${update.status}.` });
    return;
  }
  await pool.execute(
    "UPDATE updates SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, published_at=IF(?='published', CURRENT_TIMESTAMP, NULL) WHERE id=?",
    [nextStatus, user.id, nextStatus, id],
  );
  await audit(user.id, `update.${action}`, 'update', String(id), {
    runtimeVersion: update.runtime_version,
    release: update.release_id,
  });
  res.status(200).json({ ok: true, status: nextStatus });
}

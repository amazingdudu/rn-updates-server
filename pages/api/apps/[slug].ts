import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';

import { audit, ensureDatabase, getSessionUser, pool } from '../../../common/database';

export default async function appDetail(req: NextApiRequest, res: NextApiResponse) {
  await ensureDatabase();
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  const slug = req.query.slug;
  if (typeof slug !== 'string') {
    res.status(400).json({ error: 'Invalid app slug.' });
    return;
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, slug, name, description FROM applications WHERE slug=? AND deleted_at IS NULL',
    [slug],
  );
  const app = rows[0];
  if (!app) {
    res.status(404).json({ error: 'App not found.' });
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json(app);
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  if (req.method === 'PATCH') {
    const { name, description } = req.body ?? {};
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120 ||
      typeof description !== 'string' ||
      description.length > 500
    ) {
      res.status(400).json({ error: 'Invalid app name or description.' });
      return;
    }
    await pool.execute('UPDATE applications SET name=?, description=? WHERE id=?', [
      name.trim(),
      description,
      app.id,
    ]);
    await audit(user.id, 'app.update', 'app', slug, { name: name.trim() });
    res.status(200).json({ ...app, name: name.trim(), description });
    return;
  }
  if (req.method === 'DELETE') {
    await pool.execute('UPDATE applications SET deleted_at=CURRENT_TIMESTAMP WHERE id=?', [app.id]);
    await audit(user.id, 'app.delete', 'app', slug);
    res.status(200).json({ ok: true });
    return;
  }
  res.status(405).json({ error: 'Expected GET, PATCH, or DELETE.' });
}

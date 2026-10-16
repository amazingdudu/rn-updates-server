import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';

import { audit, ensureDatabase, getSessionUser, pool } from '../../../common/database';

export default async function apps(req: NextApiRequest, res: NextApiResponse) {
  await ensureDatabase();
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  if (req.method === 'GET') {
    const [rows] = await pool.query<
      RowDataPacket[]
    >(`SELECT a.id, a.slug, a.name, a.description, a.created_at AS createdAt,
      (SELECT COUNT(*) FROM updates u WHERE u.application_id=a.id) AS updateCount,
      (SELECT COUNT(*) FROM updates u WHERE u.application_id=a.id AND u.status='pending') AS pendingCount
      FROM applications a WHERE a.deleted_at IS NULL ORDER BY a.name`);
    res.status(200).json(rows);
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Expected GET or POST.' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  const { slug, name, description = '' } = req.body ?? {};
  if (
    typeof slug !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug) ||
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 120 ||
    typeof description !== 'string' ||
    description.length > 500
  ) {
    res.status(400).json({
      error:
        'Use a lowercase app slug (2–80 characters), name, and description under 500 characters.',
    });
    return;
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO applications (slug, name, description, created_by) VALUES (?, ?, ?, ?)',
      [slug, name.trim(), description, user.id],
    );
    const id = Number((result as { insertId: number }).insertId);
    await audit(user.id, 'app.create', 'app', slug, { name });
    res.status(201).json({ id, slug, name, description });
  } catch (error) {
    const code = (error as { code?: string }).code;
    res.status(code === 'ER_DUP_ENTRY' ? 409 : 500).json({
      error: code === 'ER_DUP_ENTRY' ? 'App slug already exists.' : 'Unable to create app.',
    });
  }
}

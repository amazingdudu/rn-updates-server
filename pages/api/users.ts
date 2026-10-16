import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';

import { audit, ensureDatabase, getSessionUser, pool } from '../../common/database';

export default async function users(req: NextApiRequest, res: NextApiResponse) {
  await ensureDatabase();
  const actor = getSessionUser(req);
  if (!actor || actor.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  if (req.method === 'GET') {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, role, created_at AS createdAt FROM users ORDER BY id',
    );
    res.status(200).json(rows);
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Expected GET or POST.' });
    return;
  }
  const { username, password, role = 'publisher' } = req.body ?? {};
  if (
    typeof username !== 'string' ||
    !/^[A-Za-z0-9_.-]{3,64}$/.test(username) ||
    typeof password !== 'string' ||
    password.length < 12 ||
    !['admin', 'publisher'].includes(role)
  ) {
    res.status(400).json({
      error:
        'Use a 3–64 character username, a password with at least 12 characters, and a valid role.',
    });
    return;
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, await bcrypt.hash(password, 12), role],
    );
    const id = Number((result as { insertId: number }).insertId);
    await audit(actor.id, 'user.create', 'user', String(id), { username, role });
    res.status(201).json({ id, username, role });
  } catch (error) {
    const code = (error as { code?: string }).code;
    res.status(code === 'ER_DUP_ENTRY' ? 409 : 500).json({
      error: code === 'ER_DUP_ENTRY' ? 'Username already exists.' : 'Unable to create user.',
    });
  }
}

import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2/promise';
import { NextApiRequest, NextApiResponse } from 'next';

import {
  createSessionToken,
  ensureDatabase,
  pool,
  setSessionCookie,
} from '../../../common/database';

export default async function login(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Expected POST.' });
    return;
  }
  try {
    await ensureDatabase();
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, username, password_hash, role FROM users WHERE username = ?',
      [username.trim()],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const session = {
      id: Number(user.id),
      username: user.username as string,
      role: user.role as 'admin' | 'publisher',
    };
    const token = createSessionToken(session);
    setSessionCookie(res, token);
    res.status(200).json({ user: session, token });
  } catch (error) {
    console.error('Login failed:', error);
    res
      .status(503)
      .json({ error: error instanceof Error ? error.message : 'Login service unavailable.' });
  }
}

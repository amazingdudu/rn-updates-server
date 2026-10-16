import { NextApiRequest, NextApiResponse } from 'next';

import { ensureDatabase, getSessionUser } from '../../../common/database';

export default async function currentUser(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureDatabase();
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Login required.' });
      return;
    }
    res.status(200).json({ user });
  } catch (error) {
    res
      .status(503)
      .json({ error: error instanceof Error ? error.message : 'Database unavailable.' });
  }
}

import { NextApiRequest, NextApiResponse } from 'next';

import { clearSessionCookie } from '../../../common/database';

export default function logout(_req: NextApiRequest, res: NextApiResponse) {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}

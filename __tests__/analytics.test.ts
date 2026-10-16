import { createMocks } from 'node-mocks-http';

const mockExecute = jest.fn();
jest.mock('../common/database', () => ({
  ensureDatabase: jest.fn(),
  pool: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import updateAnalytics from '../pages/api/analytics/update';

const payload = {
  app: 'rntest',
  updateId: '01234567-89ab-cdef-0123-456789abcdef',
  deviceId: '01234567-89ab-4def-8123-456789abcdef',
  runtimeVersion: 'native-1',
  platform: 'android',
  event: 'success',
};

beforeEach(() => mockExecute.mockReset());

test('stores a validated update event idempotently', async () => {
  mockExecute.mockResolvedValueOnce([[{ applicationId: 7 }]]).mockResolvedValueOnce([{}]);
  const { req, res } = createMocks({ method: 'POST', body: payload });

  await updateAnalytics(req, res);

  expect(res._getStatusCode()).toBe(202);
  expect(res._getJSONData()).toEqual({ accepted: true });
  expect(mockExecute).toHaveBeenCalledTimes(2);
  expect(mockExecute.mock.calls[1][0]).toContain('ON DUPLICATE KEY UPDATE');
  expect((mockExecute.mock.calls[1][0].match(/\?/g) ?? []).length).toBe(
    mockExecute.mock.calls[1][1].length,
  );
});

test('accepts a detected event from an automatic or manual update check', async () => {
  mockExecute.mockResolvedValueOnce([[{ applicationId: 7 }]]).mockResolvedValueOnce([{}]);
  const { req, res } = createMocks({ method: 'POST', body: { ...payload, event: 'detected' } });

  await updateAnalytics(req, res);

  expect(res._getStatusCode()).toBe(202);
  expect(res._getJSONData()).toEqual({ accepted: true });
});

test('rejects malformed device identifiers', async () => {
  const { req, res } = createMocks({
    method: 'POST',
    body: { ...payload, deviceId: 'not-a-uuid' },
  });

  await updateAnalytics(req, res);

  expect(res._getStatusCode()).toBe(400);
  expect(mockExecute).not.toHaveBeenCalled();
});

test('ignores update IDs not managed by the application', async () => {
  mockExecute.mockResolvedValueOnce([[]]);
  const { req, res } = createMocks({ method: 'POST', body: payload });

  await updateAnalytics(req, res);

  expect(res._getStatusCode()).toBe(202);
  expect(res._getJSONData()).toEqual({ accepted: false });
  expect(mockExecute).toHaveBeenCalledTimes(1);
});

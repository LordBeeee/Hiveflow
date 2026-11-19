import { openrouterError } from './openrouter-error';
it.each([
  [429, undefined, 'rate_limited', true],
  [503, undefined, 'unavailable', true],
  [502, undefined, 'unavailable', true],
  [408, undefined, 'unavailable', true],
  [401, undefined, 'unavailable', false],
  [402, undefined, 'insufficient_quota', false],
  [403, 'permission_denied', 'unavailable', false],
  [403, 'content_policy_violation', 'content_blocked', false],
  [403, 'refusal', 'content_blocked', false],
  [404, 'not_found', 'unavailable', false],
  [400, undefined, 'invalid_request', false],
  [200, 'rate_limit_exceeded', 'rate_limited', true],
] as const)(
  'maps documented status %s and type %s',
  (status, type, code, retryable) => {
    expect(
      openrouterError(
        status,
        { error: { message: 'safe message', metadata: { error_type: type } } },
        '2',
        'fixture-model',
      ),
    ).toMatchObject({ code, retryable });
  },
);
it('distinguishes moderation, permissions, budgets and temporary in-flight budget', () => {
  expect(
    openrouterError(403, { error: { metadata: { reasons: ['policy'] } } }).code,
  ).toBe('content_blocked');
  expect(
    openrouterError(403, {
      error: { metadata: { limit_source: 'openrouter_key_limit' } },
    }).code,
  ).toBe('insufficient_quota');
  expect(
    openrouterError(
      402,
      { error: { metadata: { limit_source: 'openrouter_in_flight_budget' } } },
      '3',
    ),
  ).toMatchObject({ code: 'rate_limited', retryAfterMs: 3000 });
  expect(openrouterError(401, {}).userMessage).toContain('credentials');
  expect(openrouterError(404, {}, null, 'chosen-model').userMessage).toContain(
    'chosen-model',
  );
  expect(
    openrouterError(400, {
      error: { message: 'bad https://private.example?key=secret Bearer abc' },
    }).userMessage,
  ).not.toContain('secret');
});

it('retains rate-limit and server HTTP status when upstream body code differs', () => {
  expect(openrouterError(429, { error: { code: 400 } })).toMatchObject({
    code: 'rate_limited',
    retryable: true,
  });
  expect(openrouterError(502, { error: { code: 400 } })).toMatchObject({
    code: 'unavailable',
    retryable: true,
  });
});

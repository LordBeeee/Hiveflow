import { describe, expect, it } from 'vitest';
import { inputHash, executionHash } from './runs';

describe('inputHash', () => {
  it('hashes JSON deterministically independent of nested key order', async () => {
    const a = await inputHash({
      type: 'image_generator',
      params: { count: 1, prompt: 'cabin' },
      inputs: [],
    });
    const b = await inputHash({
      inputs: [],
      params: { prompt: 'cabin', count: 1 },
      type: 'image_generator',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  it('changes when effective parameters or input order changes', async () => {
    expect(await inputHash({ prompt: 'a' })).not.toBe(
      await inputHash({ prompt: 'b' }),
    );
    expect(await inputHash([1, 2])).not.toBe(await inputHash([2, 1]));
  });
});
it('hashes effective input values independently of metadata and object key order', async () => {
  const a = await executionHash(
    'image_generator',
    { prompt: 'local', count: 1 },
    { prompt: 'upstream', references: [{ sha256: 'a' }, { sha256: 'b' }] },
  );
  const b = await executionHash(
    'image_generator',
    { count: 1, prompt: 'local' },
    { references: [{ sha256: 'a' }, { sha256: 'b' }], prompt: 'upstream' },
  );
  expect(a).toBe(b);
  expect(a).not.toBe(
    await executionHash(
      'image_generator',
      { count: 1, prompt: 'local' },
      { prompt: 'changed', references: [{ sha256: 'a' }, { sha256: 'b' }] },
    ),
  );
  expect(a).not.toBe(
    await executionHash(
      'image_generator',
      { count: 1, prompt: 'local' },
      { prompt: 'upstream', references: [{ sha256: 'b' }, { sha256: 'a' }] },
    ),
  );
});
it('does not deduplicate missing upstream inputs into valid disconnected work', async () => {
  const valid = await executionHash(
    'image_generator',
    { prompt: 'local' },
    { references: [] },
  );
  const invalid = await executionHash(
    'image_generator',
    { prompt: 'local' },
    { references: [], error: 'Upstream has no output' },
  );
  expect(valid).not.toBe(invalid);
});

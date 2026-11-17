import { describe, expect, it } from 'vitest';
import { inputHash } from './runs';

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

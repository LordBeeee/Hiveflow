import { expect, it } from 'vitest';
import { estimateModelUnits, costGraphHash } from './costs';
import { emptyGraph } from './spaces';
import { findModel } from './models';
it('binds cost approval to content/connections while allowing camera and layout changes', async () => {
  const graph = emptyGraph();
  graph.nodes = [
    {
      id: crypto.randomUUID(),
      type: 'text',
      position: { x: 0, y: 0 },
      params: { value: 'original' },
    },
  ];
  const before = await costGraphHash(graph);
  graph.viewport.x = 100;
  graph.nodes[0].position.y = 50;
  expect(await costGraphHash(graph)).toBe(before);
  graph.nodes[0].params.value = 'changed';
  expect(await costGraphHash(graph)).not.toBe(before);
});
it('prices image counts/resolution, video seconds/resolution and flat LLM calls', () => {
  expect(
    estimateModelUnits(
      findModel('bytedance-seed/seedream-4.5')!,
      { count: 3, resolution: '2K' },
      { ports: {} },
    ),
  ).toBe(24);
  expect(
    estimateModelUnits(
      findModel('seedance-2-0')!,
      { duration: 10, resolution: '1080p' },
      { ports: {} },
    ),
  ).toBe(140);
  expect(
    estimateModelUnits(findModel('google/gemini-4-neon')!, {}, { ports: {} }),
  ).toBe(10.5);
});
it('prices effective TTS characters precisely and reserves a bound for unknown script', () => {
  expect(
    estimateModelUnits(
      findModel('elevenlabs/eleven-v4')!,
      { script: 'local' },
      { ports: { script: [{ kind: 'text', value: 'a'.repeat(1001) }] } },
    ),
  ).toBe(8.008);
  expect(
    estimateModelUnits(
      findModel('elevenlabs/eleven-v4')!,
      { script: 'hello' },
      { ports: {} },
    ),
  ).toBe(0.04);
  expect(
    estimateModelUnits(
      findModel('elevenlabs/eleven-v4')!,
      { script: '' },
      { ports: {} },
      true,
    ),
  ).toBe(40);
  expect(() =>
    estimateModelUnits(
      findModel('elevenlabs/eleven-v4')!,
      { script: 'a'.repeat(5001) },
      { ports: {} },
    ),
  ).toThrow('5,000');
});

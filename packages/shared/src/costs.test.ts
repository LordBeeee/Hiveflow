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
      findModel('mock-image')!,
      { count: 3, resolution: '2K' },
      { ports: {} },
    ),
  ).toBe(6);
  expect(
    estimateModelUnits(
      findModel('mock-video')!,
      { duration: 10, resolution: '1080p' },
      { ports: {} },
    ),
  ).toBe(40);
  expect(estimateModelUnits(findModel('mock-llm')!, {}, { ports: {} })).toBe(1);
});
it('prices effective TTS characters precisely and reserves a bound for unknown script', () => {
  expect(
    estimateModelUnits(
      findModel('mock-tts')!,
      { script: 'local' },
      { ports: { script: [{ kind: 'text', value: 'a'.repeat(1001) }] } },
    ),
  ).toBe(1.001);
  expect(
    estimateModelUnits(
      findModel('mock-tts')!,
      { script: 'hello' },
      { ports: {} },
    ),
  ).toBe(0.005);
  expect(
    estimateModelUnits(
      findModel('mock-tts')!,
      { script: '' },
      { ports: {} },
      true,
    ),
  ).toBe(5);
  expect(() =>
    estimateModelUnits(
      findModel('mock-tts')!,
      { script: 'a'.repeat(5001) },
      { ports: {} },
    ),
  ).toThrow('5,000');
});

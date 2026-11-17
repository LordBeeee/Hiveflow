import { byteRange } from './byte-range';
it('supports bounded, open-ended, clamped and suffix byte ranges', () => {
  expect(byteRange(undefined, 100)).toBeNull();
  expect(byteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  expect(byteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
  expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  expect(byteRange('bytes=-1000', 100)).toEqual({ start: 0, end: 99 });
  expect(byteRange('bytes=90-1000', 100)).toEqual({ start: 90, end: 99 });
});
it('rejects unsatisfiable, unsafe and multiple ranges', () => {
  for (const value of [
    'bytes=',
    'bytes=-',
    'bytes=-0',
    'bytes=100-',
    'bytes=4-2',
    'bytes=0-1,4-5',
    'items=1-2',
    'bytes=9007199254740992-',
  ])
    expect(byteRange(value, 100)).toBe(false);
  expect(byteRange('bytes=0-', 0)).toBe(false);
});

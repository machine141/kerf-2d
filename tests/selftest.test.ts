import { describe, it, expect } from 'vitest';
import { runSelfTest } from '../src/selftest';

describe('in-app accuracy self-test (headless)', () => {
  const { results } = runSelfTest();
  for (const r of results) it(r.name, () => { expect(r.ok, r.detail).toBe(true); });
});

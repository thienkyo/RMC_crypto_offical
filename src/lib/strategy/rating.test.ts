import { describe, it, expect } from 'vitest';
import { AI_VERDICT_MIN_RATING, shouldRunAiVerdict } from './rating';

describe('AI Verdict Gating', () => {
  it('has the correct minimum rating threshold', () => {
    expect(AI_VERDICT_MIN_RATING).toBe(4);
  });

  it('does not run AI verdict for ratings 1-3', () => {
    expect(shouldRunAiVerdict(1)).toBe(false);
    expect(shouldRunAiVerdict(2)).toBe(false);
    expect(shouldRunAiVerdict(3)).toBe(false);
  });

  it('runs AI verdict for ratings 4-7', () => {
    expect(shouldRunAiVerdict(4)).toBe(true);
    expect(shouldRunAiVerdict(5)).toBe(true);
    expect(shouldRunAiVerdict(6)).toBe(true);
    expect(shouldRunAiVerdict(7)).toBe(true);
  });
});

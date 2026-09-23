/**
 * AI Settings DB Helper.
 *
 * Resolves AI API keys, model selections, and token limits:
 * Priority: DB `settings` table > process.env > fallback default.
 *
 * Allows zero-restart configuration directly from the /settings UI.
 */

import { db } from './client';
import { LATEST_MODELS } from '@/lib/ai/evaluator/types';

export { LATEST_MODELS };

export async function getAiKey(provider: 'gemini' | 'claude' | 'chatgpt'): Promise<string | undefined> {
  const settingKey = `${provider === 'claude' ? 'anthropic' : provider === 'chatgpt' ? 'openai' : 'gemini'}_api_key`;
  const envKey = provider === 'claude' ? 'ANTHROPIC_API_KEY' : provider === 'chatgpt' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';

  try {
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
      [settingKey],
    );
    if (rows[0]?.value && rows[0].value.trim().length > 0) {
      return rows[0].value.trim();
    }
  } catch (err) {
    console.warn(`[aiSettings] DB lookup failed for ${settingKey}:`, err);
  }

  return process.env[envKey]?.trim() || (provider === 'gemini' ? process.env['GOOGLE_API_KEY']?.trim() : undefined);
}

export async function getAiModel(provider: 'gemini' | 'claude' | 'chatgpt'): Promise<string> {
  const settingKey = `${provider === 'claude' ? 'anthropic' : provider === 'chatgpt' ? 'openai' : 'gemini'}_evaluator_model`;
  const envKey = provider === 'claude' ? 'ANTHROPIC_EVALUATOR_MODEL' : provider === 'chatgpt' ? 'OPENAI_EVALUATOR_MODEL' : 'GEMINI_EVALUATOR_MODEL';
  const defaultModel = LATEST_MODELS[provider].default;

  try {
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
      [settingKey],
    );
    if (rows[0]?.value && rows[0].value.trim().length > 0) {
      return rows[0].value.trim();
    }
  } catch (err) {
    console.warn(`[aiSettings] DB lookup failed for ${settingKey}:`, err);
  }

  return process.env[envKey]?.trim() || defaultModel;
}

import { costToMaxTokens } from '@/lib/ai/evaluator/types';

export async function getAiCostLimitUsd(): Promise<number> {
  try {
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'ai_evaluator_max_cost_usd' LIMIT 1`,
    );
    if (rows[0]?.value) {
      const val = parseFloat(rows[0].value);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch (err) {
    console.warn('[aiSettings] DB lookup failed for ai_evaluator_max_cost_usd:', err);
  }

  const envCost = parseFloat(process.env['AI_EVALUATOR_MAX_COST_USD'] || '');
  if (!isNaN(envCost) && envCost > 0) return envCost;

  return 0.01; // Default $0.01 (~1,000 tokens)
}

export async function getAiMonthlyBudgetUsd(): Promise<number | null> {
  try {
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'ai_evaluator_monthly_budget_usd' LIMIT 1`,
    );
    if (rows[0]?.value) {
      const val = parseFloat(rows[0].value);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch (err) {
    console.warn('[aiSettings] DB lookup failed for ai_evaluator_monthly_budget_usd:', err);
  }

  const envBudget = parseFloat(process.env['AI_EVALUATOR_MONTHLY_BUDGET_USD'] || '');
  return !isNaN(envBudget) && envBudget > 0 ? envBudget : null;
}

export async function getMonthlyEvaluationCount(): Promise<number> {
  try {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*) as count
       FROM ai_order_evaluations
       WHERE created_at >= date_trunc('month', NOW())`,
    );
    return parseInt(rows[0]?.count ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

export async function getAiMaxTokens(): Promise<number> {
  try {
    // 1. Priority to explicit cost limit in USD
    const { rows: costRows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'ai_evaluator_max_cost_usd' LIMIT 1`,
    );
    if (costRows[0]?.value) {
      const cost = parseFloat(costRows[0].value);
      if (!isNaN(cost) && cost > 0) {
        return costToMaxTokens(cost);
      }
    }

    // 2. Direct token setting fallback
    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'ai_evaluator_max_tokens' LIMIT 1`,
    );
    if (rows[0]?.value) {
      const val = parseInt(rows[0].value, 10);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch (err) {
    console.warn('[aiSettings] DB lookup failed for token limit:', err);
  }

  if (process.env['AI_EVALUATOR_MAX_COST_USD']) {
    const cost = parseFloat(process.env['AI_EVALUATOR_MAX_COST_USD']);
    if (!isNaN(cost) && cost > 0) return costToMaxTokens(cost);
  }

  return Number(process.env['AI_EVALUATOR_MAX_TOKENS']) || 1024;
}

export async function isAiSignalGatekeeperEnabled(): Promise<boolean> {
  try {
    // Check monthly budget ceiling
    const budget = await getAiMonthlyBudgetUsd();
    if (budget !== null && budget > 0) {
      const evalCount = await getMonthlyEvaluationCount();
      const costPerEval = await getAiCostLimitUsd();
      const estimatedSpent = evalCount * costPerEval;
      if (estimatedSpent >= budget) {
        console.warn(
          `[aiSettings] Monthly AI spend cap reached (~$${estimatedSpent.toFixed(2)} >= budget $${budget.toFixed(2)}). Signal gatekeeper paused.`,
        );
        return false;
      }
    }

    const { rows } = await db.query<{ value: string | null }>(
      `SELECT value FROM settings WHERE key = 'enable_ai_signal_gatekeeper' LIMIT 1`,
    );
    if (rows[0]?.value !== undefined && rows[0]?.value !== null) {
      return rows[0].value === 'true' || rows[0].value === '1';
    }
  } catch (err) {
    console.warn('[aiSettings] DB lookup failed for enable_ai_signal_gatekeeper:', err);
  }

  return process.env['ENABLE_AI_SIGNAL_GATEKEEPER'] !== 'false';
}

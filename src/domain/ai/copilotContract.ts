/**
 * Trackit X — Copilot business context contract.
 *
 * ── The separation this file exists to protect ───────────────────────────────
 *   AI provider configuration answers "which AI should answer?"
 *   Business analytics answers "what should it reason over?"
 *
 * Those are different questions with different lifetimes, and merging them is how
 * a credentials screen ends up shipping a payroll rollup. So the provider layer
 * knows nothing about employees, and this file is the only place the two meet.
 *
 * ── Why DashboardSnapshot is reused, not rebuilt ──────────────────────────────
 * Phase 34 built `DashboardSnapshot` as the AI-ready analytics contract, including
 * the load-bearing decision that a withheld field is `null` rather than `0`. That
 * type is the correct context for a Copilot question and it is not duplicated
 * here. Re-deriving it would create a second source of truth that would drift the
 * first time a metric was added, and the drift would be invisible until a model
 * confidently quoted a stale number.
 */
import type { DashboardSnapshot } from '@/features/dashboard/metrics';
import type { OrganizationRole } from '@/domain/organization';
import type { AIRequest } from './types.ts';

/**
 * What the Copilot is allowed to know about an organization.
 *
 * Every field is either an aggregate or an explicitly scoped rollup. Employee
 * names, salaries, contact details and any provider configuration are absent by
 * construction — a context that cannot express them cannot leak them.
 */
export interface CopilotBusinessContext {
  readonly organizationId: string;
  /** ISO timestamp of the request, so "as of" is data rather than an assumption. */
  readonly requestedAt: string;
  /**
   * The viewer's role, because the same question has different legitimate answers
   * for an owner and a new hire. Sending it lets the Gateway suppress what the
   * viewer was never allowed to see.
   */
  readonly viewerRole: OrganizationRole | null;
  /**
   * Phase 34 analytics. Carries the same `null`-means-withheld discipline as the
   * dashboard itself, so a Copilot cannot read "nobody has open work" into a
   * figure the viewer was not permitted to see.
   */
  readonly dashboard: DashboardSnapshot;
  /** Employee rollup, projected from the same snapshot rather than re-queried. */
  readonly employees: CopilotEmployeeRollup[];
  readonly projects: CopilotProjectRollup[];
  readonly tasks: CopilotTaskRollup[];
}

export interface CopilotEmployeeRollup {
  readonly employeeId: string;
  readonly displayName: string;
  readonly status: string;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
}

export interface CopilotProjectRollup {
  readonly projectId: string;
  readonly name: string;
  readonly status: string;
  /** 0-100, or `null` when progress could not be computed. */
  readonly progressPercent: number | null;
  readonly openTaskCount: number;
}

export interface CopilotTaskRollup {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly isOverdue: boolean;
  readonly dueDate: string | null;
  readonly projectName: string | null;
}

/**
 * Assembles an `AIRequest` from business context.
 *
 * The provider and model are passed in rather than looked up here. Choosing a
 * model is the Gateway's job, decided by the organization's marked default and
 * verified against that configuration — a screen that picked its own model would
 * be able to route around a disabled provider.
 */
export function buildCopilotRequest(params: {
  readonly provider: AIRequest['provider'];
  readonly model: string;
  readonly userInput: string;
  readonly systemInstructions?: string;
  readonly context: CopilotBusinessContext;
}): AIRequest {
  const { provider, model, userInput, systemInstructions, context } = params;

  return {
    organizationId: context.organizationId,
    provider,
    model,
    ...(systemInstructions !== undefined ? { systemInstructions } : {}),
    userInput,
    businessContext: {
      requestedAt: context.requestedAt,
      viewerRole: context.viewerRole,
      dashboard: context.dashboard,
      employees: context.employees,
      projects: context.projects,
      tasks: context.tasks,
    },
  };
}

/**
 * The system instructions a Copilot request should carry.
 *
 * Defined in `./systemInstructions.ts` and re-exported here, because the AI
 * Gateway must send the same words to a provider and runs on Deno, which cannot
 * load this module's imports. The single copy of the text lives with no
 * dependencies; this re-export keeps every existing client import working.
 */
export { COPILOT_SYSTEM_INSTRUCTIONS } from './systemInstructions.ts';

/**
 * Trackit X — the Copilot service.
 *
 * ── Where this sits in the architecture ─────────────────────────────────────────
 * The only place a screen turns a question into a provider call. The route is fixed:
 *
 *   question → intent → minimal context → aiGatewayService → normalize → response
 *
 * Everything provider-specific happens behind `aiGatewayService`, which is the Phase
 * 36 boundary. This file contains no provider id, no model id, no endpoint, no
 * credential, no Vault call and no `fetch`. It cannot acquire one: there is no
 * parameter that would accept a key and no import that would read one. The single
 * provider-shaped value it passes is the organization's own `configId`, which names
 * a row — not a secret — and which the server resolves the organization from.
 *
 * ── What it reuses, and what it deliberately does not re-derive ─────────────────
 * Every figure in the context comes from `buildDashboardSnapshot`, the Phase 34
 * analytics contract. This service does not count a task, compute a progress
 * percentage, decide whether something is overdue, rank a workload, or work out what
 * is due soon — all of that is imported from the modules that already own it, and
 * `tests/unit/copilotData.test.ts` pins the answers to the same fixtures the
 * dashboard suite uses, so the two screens cannot disagree about a number.
 *
 * The only thing computed here is *selection*: which slice of the already-computed
 * snapshot a given question is allowed to see. That is new work, and it is the
 * reason this file exists.
 *
 * ── Failures are refusals, not fallbacks ────────────────────────────────────────
 * There is no locally-composed answer. If the gateway is unavailable, if the
 * organization has no provider configured, or if the provider is switched off, the
 * caller gets an `Err` and the UI shows a configuration state. A Copilot that falls
 * back to "here is what the dashboard says" when the model is unreachable is a
 * Copilot that has already been trained to answer without asking, and the user has
 * no way to tell which kind of answer they are reading.
 */
import { supabase } from '@/lib/supabase';
import {
  COPILOT_INTENT_LABELS,
  normalizeCopilotOutput,
  type CopilotAskRequest,
  type CopilotResponse,
} from '@/domain/ai/copilot';
import { resolveDefaultProvider } from '@/domain/ai/configuration';
import { GATEWAY_AVAILABLE, GATEWAY_UNAVAILABLE_REASON, assertGatewayEligible } from '@/domain/ai/gateway';
import { GATEWAY_LIMITS } from '@/domain/ai/gatewayProtocol';
import type { AIProviderId } from '@/domain/ai/types';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

import { buildCopilotContext, type CopilotContextPlan } from '@/features/copilot/contextBuilder';
import { buildDashboardSnapshot, type DashboardSnapshot } from '@/features/dashboard/metrics';

import { generate as generateThroughGateway } from './aiGatewayService';
import { listProviderConfigs } from './aiProviderService';
import {
  DEMO_HEADCOUNT,
  isDemoDataMode,
  isDemoOrganization,
  readDemoFacts,
} from './demoDataService';
import {
  DASHBOARD_EMPLOYEE_COLUMNS,
  DASHBOARD_PROJECT_COLUMNS,
  DASHBOARD_TASK_COLUMNS,
  countOrganizationMembers,
  type DashboardEmployeeFact,
  type DashboardProjectFact,
  type DashboardTaskFact,
} from './dashboardService';

const log = logger.child({ module: 'copilotService' });

/**
 * The one sentence a user sees when their organization has no AI provider.
 *
 * A constant rather than the shared `AI_PROVIDER_NOT_CONFIGURED` copy, because the
 * shared copy is written for a screen that already knows there is a settings page, and
 * this string is the whole explanation a Copilot user gets. It names no provider, no
 * key, no vault and no configuration detail — the answer is "ask an administrator",
 * and the mechanism is not the user's business.
 */
export const COPILOT_PROVIDER_NOT_CONFIGURED_MESSAGE =
  'AI provider is not configured for this organization.';

/** The message shown when the gateway itself is not deployed. */
export const COPILOT_GATEWAY_UNAVAILABLE_MESSAGE =
  'The AI assistant is not available in this build yet. Your business data is unaffected.';

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * A task, plus the three columns a citation needs.
 *
 * Extends `DashboardTaskFact` rather than restating it, so a change to the five
 * columns the snapshot reads flows through automatically. The three added columns are
 * exactly the difference between "there are 4 overdue tasks" and "these are the four
 * overdue tasks" — a Copilot that can name a record is checkable, and one that cannot
 * is a rumour.
 */
export interface CopilotTaskFact extends DashboardTaskFact {
  readonly id: string;
  readonly title: string;
  readonly project_id: string | null;
}

/**
 * Employee and project facts are the dashboard's own types, unchanged and unrepeated.
 *
 * The Copilot needs nothing more from either table: a citation is `id` plus a name,
 * and a project's health is status, priority, progress and target date. Reusing the
 * type rather than widening it is what guarantees the Copilot cannot start reading a
 * column the dashboard deliberately excluded.
 */
export interface CopilotFacts {
  readonly employees: readonly DashboardEmployeeFact[];
  readonly projects: readonly DashboardProjectFact[];
  readonly tasks: readonly CopilotTaskFact[];
}

/**
 * The Copilot's task column list.
 *
 * Composed from the dashboard's rather than written out, so the five shared columns
 * are guaranteed identical. Task identity and the project link are the only additions,
 * and both exist to support a citation.
 */
const COPILOT_TASK_COLUMNS = `id, title, ${DASHBOARD_TASK_COLUMNS}, project_id`;

/**
 * The `organization_members` count the snapshot annotates itself with.
 *
 * In demo mode this is a constant from the fixture rather than a query. That is
 * deliberate on two counts: the fixture describes a headcount of seven access holders
 * who do not exist, so querying for them would return zero and the snapshot would
 * annotate a business of five people with "0 access holders" — a wrong number, printed
 * confidently, about a dataset that is otherwise entirely correct. And a demo mode that
 * still required a live `organization_members` table would not really be one.
 *
 * Keyed on the organization, like the fact read, so a demo build pointed at a real
 * tenant counts that tenant's members for real. An error is swallowed into `null`
 * because this figure only annotates: the snapshot is built and the Copilot answers
 * either way, which is the behaviour Phase 34 settled on and is not changed here.
 */
async function readAccessHolders(organizationId: string): Promise<number | null> {
  if (isDemoDataMode() && isDemoOrganization(organizationId)) return DEMO_HEADCOUNT;
  const members = await countOrganizationMembers(organizationId);
  return members.ok ? members.value : null;
}

/**
 * Reads the visible facts for one organization.
 *
 * Three independent reads, issued together, exactly as `readDashboardFacts` does —
 * this is the same data for the same tenant plus task identity, so a Copilot answer
 * and a dashboard refresh cannot be describing different businesses. Awaiting them
 * with `Promise.all` is one event loop turn rather than three chained round trips.
 *
 * One failure fails the whole read, and for the reason `readDashboardFacts` gives: an
 * answer built from a partial context is a confident answer about a business whose
 * numbers do not add up, with nothing on screen saying which part was real.
 *
 * Every read is `.eq('organization_id', organizationId)`. RLS already restricts all
 * three tables to the caller's organization, so a request for another tenant returns
 * zero rows rather than their contents; the explicit filter is kept so a single
 * careless edit cannot be sufficient to leak.
 *
 * ── Phase 38: the demo substitution, and exactly where it stops ───────────────
 * In demo mode this function returns the fixed fixture set from
 * `demoDataService` instead of querying Postgres, and that is the ONLY difference
 * Phase 38 makes. Everything downstream of this line — `buildDashboardSnapshot`,
 * `buildCopilotContext`, the gateway call, the provider, the normalizer — is
 * unchanged, so a demo turn and a production turn are the same computation over
 * different rows.
 *
 * Two properties are worth stating because the temptation to relax them is exactly
 * what would make demo mode a security hole:
 *
 *   · It is keyed on the ORGANIZATION, not on the flag alone. `readDemoFacts` only
 *     answers for `DEMO_ORGANIZATION_ID`; every other id falls through to the real
 *     organization-scoped reads below. So a build running in demo mode still cannot
 *     show fixture data for a tenant, and the fallback is a normal read rather than a
 *     refusal.
 *   · It substitutes data, never authorization. There is no membership check here to
 *     skip, because the fixture set describes an organization that does not exist and
 *     the records are a public constant in the bundle. The real reads still run
 *     `.eq('organization_id', …)` and RLS still applies to them; demo mode never
 *     reaches a table at all.
 *
 * `asOf` is a new parameter rather than being read from the clock, because the fixture
 * stores due dates as offsets and something has to resolve them. Passing in the same
 * `asOf` the snapshot is built with is what keeps the dataset deterministic: the same
 * reference date always yields the same overdue set, on any machine, on any day.
 */
export async function readCopilotFacts(
  organizationId: string,
  asOf: string,
): Promise<ActionResult<CopilotFacts>> {
  if (isDemoDataMode()) {
    const demo = readDemoFacts(organizationId, asOf);
    // A bad `asOf` is a real error and is returned as one.
    if (!demo.ok) return demo;
    // `null` means "not the demo organization", which is not an error — it is the
    // signal to fall through to the real reads below.
    if (demo.value !== null) return ok(demo.value);
  }

  const result = await attempt(async () => {
    const [employees, projects, tasks] = await Promise.all([
      supabase.from('employees').select(DASHBOARD_EMPLOYEE_COLUMNS).eq('organization_id', organizationId),
      supabase
        .from('projects')
        .select(DASHBOARD_PROJECT_COLUMNS)
        .eq('organization_id', organizationId),
      supabase.from('tasks').select(COPILOT_TASK_COLUMNS).eq('organization_id', organizationId),
    ]);

    // Checked in a fixed order, so the reported error names the same table for the
    // same set of failures on every run.
    if (employees.error !== null) throw employees.error;
    if (projects.error !== null) throw projects.error;
    if (tasks.error !== null) throw tasks.error;

    return {
      employees: (employees.data ?? []) as unknown as readonly DashboardEmployeeFact[],
      projects: (projects.data ?? []) as unknown as readonly DashboardProjectFact[],
      tasks: (tasks.data ?? []) as unknown as readonly CopilotTaskFact[],
    };
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not read Copilot facts', { code: result.error.code });
    return result;
  }

  return ok(result.value);
}

// ---------------------------------------------------------------------------
// Gateway target
// ---------------------------------------------------------------------------

/**
 * The configuration a Copilot request will be sent through.
 *
 * Holds no secret. `configId` is a row identifier the server resolves; `provider` and
 * `model` are echoed from the organization's own configuration purely so the answer
 * can say which model produced it.
 */
export interface CopilotGatewayTarget {
  readonly configId: string;
  readonly provider: AIProviderId;
  readonly model: string;
}

/**
 * Works out which configuration the Copilot should use, or refuses.
 *
 * Ordered so the cheapest and most specific refusal wins:
 *
 *  1. `GATEWAY_AVAILABLE` first. When the Edge Function is not deployed there is no
 *     call to make, and the user needs to be told that rather than a provider error.
 *  2. Then the organization's own configurations, read for that organization only.
 *  3. Then `resolveDefaultProvider`, which never promotes a second provider when the
 *     marked default is unusable. An organization whose default is switched off gets
 *     "ask an administrator", not a silently different model on someone else's bill.
 *  4. Then `assertGatewayEligible` for a stored credential.
 *
 * The `configId` returned is filtered on `organizationId` explicitly. `listProviderConfigs`
 * is already org-scoped and RLS is authoritative, so this is belt and braces — but
 * the returned value is used as a tenant selector on the server, and the cheapest
 * place to make "cannot belong to another organization" structurally true is here.
 */
export async function resolveCopilotTarget(
  organizationId: string,
): Promise<ActionResult<CopilotGatewayTarget>> {
  if (!GATEWAY_AVAILABLE) {
    return err(
      appError('AI_UNAVAILABLE', GATEWAY_UNAVAILABLE_REASON, {
        userMessage: COPILOT_GATEWAY_UNAVAILABLE_MESSAGE,
        retryable: false,
        context: { reason: 'gateway_unavailable' },
      }),
    );
  }

  const listed = await listProviderConfigs(organizationId);
  if (!listed.ok) return listed;

  const configs = listed.value.filter((config) => config.organizationId === organizationId);
  const resolution = resolveDefaultProvider(configs);

  if (resolution.kind === 'none') {
    return err(
      appError('AI_PROVIDER_NOT_CONFIGURED', 'No AI provider is configured for this organization.', {
        userMessage: COPILOT_PROVIDER_NOT_CONFIGURED_MESSAGE,
        context: { reason: 'no_default_marked' },
      }),
    );
  }

  if (resolution.kind === 'unresolved') {
    return err(
      appError('AI_PROVIDER_DISABLED', 'The marked default AI provider is disabled.', {
        userMessage: 'The AI provider for your organization is switched off. Ask an administrator to turn it on.',
        context: { reason: resolution.reason },
      }),
    );
  }

  const eligible = assertGatewayEligible(resolution.config);
  if (!eligible.ok) return eligible;

  return ok({
    configId: eligible.value.id,
    provider: eligible.value.provider,
    model: eligible.value.selectedModel,
  });
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** Everything the service needs that is not a parameter of the public call. */
export interface CopilotAskOptions {
  /** `YYYY-MM-DD` in the viewer's timezone. A parameter, so tests are not clock-bound. */
  readonly asOf: string;
  /** ISO timestamp for `requestedAt`. */
  readonly requestedAt: string;
}

const MAX_QUESTION_CHARS = 1_000;

/**
 * Asks the Copilot one question, in one organization.
 *
 * Every early return is a refusal with a code, and there is no path that produces a
 * `CopilotResponse` without a successful provider call behind it. That is the property
 * the UI depends on: if a response exists, a model read real context.
 */
export async function askCopilot(
  request: CopilotAskRequest,
  options: CopilotAskOptions,
): Promise<ActionResult<CopilotResponse>> {
  const question = request.question.trim();

  if (question.length === 0) {
    return err(
      appError('AI_REQUEST_INVALID', 'Question is empty.', {
        userMessage: 'Type a question first.',
        context: { reason: 'empty_question' },
      }),
    );
  }

  // Below the gateway's own ceiling on purpose. A question longer than this is not a
  // question, and refusing it before the reads saves two round trips.
  if (question.length > MAX_QUESTION_CHARS || question.length > GATEWAY_LIMITS.maxUserInputChars) {
    return err(
      appError('AI_REQUEST_INVALID', 'Question is too long.', {
        userMessage: 'That question is too long to send. Try asking about less at once.',
        context: { max: MAX_QUESTION_CHARS, length: question.length },
      }),
    );
  }

  const target = await resolveCopilotTarget(request.organizationId);
  if (!target.ok) return target;

  // The two reads go out together, and the member count is allowed to fail on its own
  // because it annotates a headcount rather than producing one. `options.asOf` is
  // passed to the fact read as well as to the snapshot builder: in demo mode it is
  // what resolves the fixture's due-date offsets, and using the same value in both
  // places is what guarantees the overdue count the model is told about is the
  // overdue count the snapshot computed.
  const [facts, accessHolders] = await Promise.all([
    readCopilotFacts(request.organizationId, options.asOf),
    readAccessHolders(request.organizationId),
  ]);
  if (!facts.ok) return facts;

  /*
   * The Phase 34 snapshot is the only source of aggregates in this file. The facts read
   * above are a structural superset of `DashboardFacts`, so the same builder produces
   * the same numbers the dashboard shows — there is no second aggregation anywhere
   * below this line.
   */
  const snapshot: DashboardSnapshot = buildDashboardSnapshot(facts.value, {
    organizationId: request.organizationId,
    asOf: options.asOf,
    role: request.viewerRole,
    accessHolders,
  });

  // A snapshot stamped with a different tenant than the question would be a bug worth
  // refusing rather than sending. It cannot happen — the id is passed to the builder
  // above — and the check exists because the consequence would be a cross-tenant
  // prompt, and a cheap assertion is worth more than a careful comment.
  if (snapshot.organizationId !== request.organizationId) {
    return err(
      appError('ORGANIZATION_REQUIRED', 'Snapshot organization did not match the request.', {
        userMessage: 'That request does not match the organization you are viewing.',
        context: { reason: 'snapshot_organization_mismatch' },
      }),
    );
  }

  const plan: CopilotContextPlan = buildCopilotContext({
    organizationId: request.organizationId,
    question,
    requestedAt: options.requestedAt,
    viewerRole: request.viewerRole,
    snapshot,
    facts: facts.value,
  });

  /*
   * The wire payload.
   *
   * `organizationId` is included at the top level on purpose. Phase 36 added
   * `assertContextAgreesWithConfig`, which compares the context's own organization
   * against the configuration's — and it passes when the field is absent, so a client
   * that simply omits it gets the check for free and defeats it. Sending it means a
   * stale organization switch is caught server-side, before one tenant's figures leave
   * on another tenant's credential.
   *
   * Everything under it is the Phase 36 `CopilotBusinessContext`, and nothing else.
   * `buildCopilotRequest` in `copilotContract.ts` is not used here: it produces an
   * `AIRequest` for a server-side adapter, and this client calls `generate`, which
   * takes a configId and a context — the adapter never runs in the browser.
   */
  const businessContext: Readonly<Record<string, unknown>> = {
    organizationId: plan.context.organizationId,
    requestedAt: plan.context.requestedAt,
    viewerRole: plan.context.viewerRole,
    intent: plan.intent,
    intentLabel: COPILOT_INTENT_LABELS[plan.intent],
    scope: plan.scope,
    dataGaps: plan.dataGaps,
    dashboard: plan.context.dashboard,
    employees: plan.context.employees,
    projects: plan.context.projects,
    tasks: plan.context.tasks,
  };

  log.info('Copilot request', {
    organizationId: request.organizationId,
    intent: plan.intent,
    configId: target.value.configId,
    employees: plan.context.employees.length,
    projects: plan.context.projects.length,
    tasks: plan.context.tasks.length,
  });

  const generated = await generateThroughGateway({
    configId: target.value.configId,
    userInput: question,
    businessContext,
  });
  if (!generated.ok) return generated;

  /*
   * Normalisation is the trust boundary for the model's text. Only references that
   * resolve against the context this client built survive, and the response is
   * assembled from named fields so nothing else the model returned — an `actions`
   * array, a `command`, a `tool` — can be carried into a type that renders it.
   */
  const answer = normalizeCopilotOutput(generated.value.output, plan.allowedReferences);

  return ok({
    organizationId: request.organizationId,
    question,
    intent: plan.intent,
    summary: answer.summary,
    keyPoints: answer.keyPoints,
    recommendations: answer.recommendations,
    references: answer.references,
    dataGaps: plan.dataGaps,
    provider: generated.value.provider,
    model: generated.value.model,
    configId: target.value.configId,
    requestedAt: plan.context.requestedAt,
    structured: answer.structured,
  });
}

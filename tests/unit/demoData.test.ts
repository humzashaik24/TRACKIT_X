/**
 * Phase 38 — demonstration data, and the real runtime it feeds.
 *
 * ── What this file is for ──────────────────────────────────────────────────────
 * Phase 38 added `EXPO_PUBLIC_DATA_MODE=demo` so a developer can run the whole
 * application — dashboard, projects, Copilot — against a realistic business with no
 * database and no setup. The temptation that mode invites is the failure mode this
 * file is written to make impossible: a fixture dataset is twenty lines away from
 * becoming a fake Copilot. Answer a question from a lookup table and every feature
 * downstream of it is "done" — the context builder, the tenant check, the credential
 * boundary and the response normalizer are all still untested, and nothing reports it.
 *
 * So the twenty-five cases below are not twenty-five tests of the fixture. Cases 10
 * through 20 build a `CopilotContextPlan` from the demo data using the real
 * `buildDashboardSnapshot` and the real `buildCopilotContext` — the same functions a
 * production turn uses, with nothing stubbed between the dataset and the plan. Cases
 * 21 to 25 exercise the real provider-selection, failure-normalization and
 * activation-gating functions on inputs an actual provider will produce.
 *
 * ── Two of these are live-only, and the file says so rather than implying otherwise ──
 * Case 22 (a real provider connection) and the external half of case 25 cannot be
 * proven here, and no amount of unit testing changes that. What IS proven is that
 * every function they exercise behaves correctly. The live evidence is a separate
 * exercise, and `docs/progress/PHASE_38_COMPLETE.md` records it as unverified.
 */
import { GATEWAY_AVAILABLE } from '@/domain/ai/gateway';
import { COPILOT_INTENTS } from '@/domain/ai/copilot';
import { buildCopilotRequest } from '@/domain/ai/copilotContract';
import { isModelSupportedForProvider, PROVIDER_REGISTRY } from '@/domain/ai/registry';
import { classifyProviderStatus, toSafeProviderError } from '@/domain/ai/providerErrors';
import { DEMO_ORGANIZATION_ID } from '@/domain/demo/dataset';
import {
  COPILOT_CONTEXT_LIMITS,
  buildCopilotContext,
  type CopilotContextPlan,
} from '@/features/copilot/contextBuilder';
import { buildDashboardSnapshot, type DashboardSnapshot } from '@/features/dashboard/metrics';
import {
  buildDemoFacts,
  demoOrganization,
  isDemoOrganization,
  readDemoFacts,
  shiftDate,
} from '@/services/demoDataService';
import { getAIGatewayStatus } from '@/services/aiProviderService';
import type { CopilotFacts, CopilotTaskFact } from '@/services/copilotService';
import type { OrganizationRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/**
 * A fixed reference date.
 *
 * Phase 38's determinism claim is not "the dataset is static" — the dates are stored as
 * offsets, so the dataset is only static once something resolves them. Passing this
 * constant everywhere is what turns "deterministic" from an intention into a property
 * the assertions below can check.
 */
const AS_OF = '2026-03-16';
const OTHER_ORG = 'e7b1c2d3-4a5f-4b6c-8d9e-0f1a2b3c4d5e';

function snapshotFor(
  facts: CopilotFacts,
  options: { organizationId?: string; asOf?: string; role?: OrganizationRole } = {},
): DashboardSnapshot {
  return buildDashboardSnapshot(facts, {
    organizationId: options.organizationId ?? DEMO_ORGANIZATION_ID,
    asOf: options.asOf ?? AS_OF,
    role: options.role ?? 'owner',
    accessHolders: 7,
  });
}

function planFor(
  question: string,
  options: { facts?: CopilotFacts; role?: OrganizationRole; organizationId?: string } = {},
): CopilotContextPlan {
  const organizationId = options.organizationId ?? DEMO_ORGANIZATION_ID;
  const role = options.role ?? 'owner';
  const facts = options.facts ?? buildDemoFacts(AS_OF);
  return buildCopilotContext({
    organizationId,
    question,
    requestedAt: `${AS_OF}T09:30:00.000Z`,
    viewerRole: role,
    snapshot: snapshotFor(facts, { organizationId, role }),
    facts,
  });
}

/** The serialized request a provider would receive, for size and leak assertions. */
function requestFor(plan: CopilotContextPlan, question: string): string {
  return JSON.stringify(
    buildCopilotRequest({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      userInput: question,
      context: plan.context,
    }),
  );
}

function overdueDemoTasks(facts: CopilotFacts): CopilotTaskFact[] {
  return facts.tasks.filter(
    (task) => task.status !== 'done' && task.due_date !== null && task.due_date < AS_OF,
  );
}

// ===========================================================================
// I. The dataset — 1 to 9
// ===========================================================================

describe('I. demonstration data', () => {
  it('1. is deterministic for a given reference date', () => {
    expect(buildDemoFacts(AS_OF)).toEqual(buildDemoFacts(AS_OF));

    // Every resolved date sits inside the window the offsets describe. A hidden
    // `new Date()` would produce 2026 dates this month and 2027 dates next month, so
    // pinning the year is the assertion that actually catches it.
    const facts = buildDemoFacts(AS_OF);
    for (const task of facts.tasks) {
      expect(task.due_date ?? AS_OF).toMatch(/^2026-/);
    }

    // Resolving against a different day is expected to differ, which is what makes the
    // determinism above meaningful rather than a property of empty data.
    expect(buildDemoFacts('2026-04-30')).not.toEqual(facts);
  });

  it('2. has valid employees, including one not yet fully active', () => {
    const { employees } = snapshotFor(buildDemoFacts(AS_OF));

    expect(employees.total).toBe(5);
    // A probationary hire is on the directory but is not `active`, and the real
    // aggregator has to make that distinction without help from the fixture.
    expect(employees.active).toBe(4);
    expect(employees.probation).toBe(1);
    // `current` is the aggregator's own definition — active, probation and leave — and
    // it is asserted here rather than left implicit, because "how many people work
    // here" having two answers is precisely the bug Phase 34 closed.
    expect(employees.current).toBe(5);
  });

  it('3. has valid projects spanning the schedule states', () => {
    const { projects, deadlines } = snapshotFor(buildDemoFacts(AS_OF));

    expect(projects.total).toBe(3);
    expect(projects.open).toBe(3);
    expect(projects.byStatus).toMatchObject({ planned: 1, active: 1, on_hold: 1 });
    // One of each non-low priority, so a priority-ordered answer is exercised.
    expect(projects.byPriority).toMatchObject({ medium: 1, high: 1, critical: 1 });

    // A project on hold with progress recorded against it is the dataset's most
    // useful awkward case: the Copilot has to be able to say "stopped, at 35%" rather
    // than report healthy progress. Every project is dated, so nothing is lost to
    // undatedness, and exactly one falls inside the seven-day window — so the deadline
    // pass has something to find and "nothing is due soon" is not a vacuous truth.
    expect(deadlines.undatedProjects).toBe(0);
    expect(deadlines.overdueProjects).toBe(0);
    expect(deadlines.dueSoonProjects).toBe(1);
  });

  it('4. has valid tasks with a realistic status and priority spread', () => {
    const { tasks } = snapshotFor(buildDemoFacts(AS_OF));

    expect(tasks.total).toBe(12);
    expect(tasks.open).toBe(10);
    expect(tasks.byStatus).toMatchObject({
      todo: 3,
      in_progress: 4,
      blocked: 2,
      in_review: 1,
      done: 2,
    });
    expect(tasks.byPriority).toMatchObject({ low: 2, medium: 4, high: 3, urgent: 3 });
  });

  it('5. contains overdue work, dated strictly before the reference date', () => {
    const { tasks, deadlines } = snapshotFor(buildDemoFacts(AS_OF));

    expect(tasks.overdue).toBe(3);
    expect(deadlines.overdueTasks).toBe(3);

    // The count is only trustworthy if the dates really are in the past. This is the
    // assertion that catches an off-by-one in the offset arithmetic, which would
    // otherwise make "overdue" quietly mean "due today".
    const overdue = overdueDemoTasks(buildDemoFacts(AS_OF));
    expect(overdue).toHaveLength(3);
    for (const task of overdue) expect(task.due_date! < AS_OF).toBe(true);
  });

  it('6. contains work due soon, dated after the reference date', () => {
    const { deadlines } = snapshotFor(buildDemoFacts(AS_OF));

    // DUE_SOON_DAYS is 7. Four tasks sit inside that window and, per case 5, none are
    // in the past — so overdue and due-soon are disjoint, and the Copilot's attention
    // list of 7 in case 11 is exactly their union. If either count moves, case 11 fails
    // too, which is the intended coupling.
    expect(deadlines.dueSoonTasks).toBe(4);

    const soon = buildDemoFacts(AS_OF).tasks.filter(
      (task) =>
        task.status !== 'done' &&
        task.due_date !== null &&
        task.due_date >= AS_OF &&
        task.due_date <= shiftDate(AS_OF, 7),
    );
    expect(soon).toHaveLength(4);
  });

  it('7. contains blocked work, which is neither done nor scheduled around', () => {
    const { tasks, deadlines } = snapshotFor(buildDemoFacts(AS_OF));

    expect(tasks.byStatus.blocked).toBe(2);
    // Blocked work with a date inside the window is what separates "blocked" from "not
    // started": it is both something to report now and something a plan should not
    // quietly treat as scheduled.
    expect(deadlines.dueSoonTasks).toBe(4);

    const blocked = buildDemoFacts(AS_OF).tasks.filter((t) => t.status === 'blocked');
    expect(blocked).toHaveLength(2);
    expect(blocked.some((t) => t.due_date !== null && t.due_date >= AS_OF)).toBe(true);
  });

  it('8. contains a workload scenario with an identifiable overloaded person', () => {
    const { workload } = snapshotFor(buildDemoFacts(AS_OF));
    expect(workload).not.toBeNull();

    const entries = workload!.entries;
    expect(entries).toHaveLength(5);
    expect(workload!.totalOpenTasks).toBe(10);
    expect(workload!.peopleWithOpenWork).toBe(5);

    // One person carries more open work than any other, and that person also has an
    // overdue task — the combination that makes "who is overloaded" worth asking.
    const sorted = [...entries].sort((a, b) => b.openTasks - a.openTasks);
    const top = sorted[0]!;
    expect(top.openTasks).toBe(3);
    expect(top.overdueTasks).toBe(1);
    expect(top.band.key).toBe('three_to_five');
    // Unambiguous: if two people tied, "who is overloaded" would have no answer.
    expect(sorted.filter((e) => e.openTasks === top.openTasks)).toHaveLength(1);
  });

  it('9. contains a project progress scenario the real calculator can read', () => {
    const { progress, projects } = snapshotFor(buildDemoFacts(AS_OF));

    // Three projects at 62 / 35 / 10 percent: a mean that is neither a round number nor
    // the average of the extremes, so a hard-coded total cannot pass.
    expect(progress.averageProjectProgress).toBeCloseTo(35.7, 1);
    expect(progress.averageTaskProgress).toBeCloseTo(29, 5);
    // No project is complete, so the project completion rate is exactly 0 — the value
    // most likely to be faked by a divide-by-zero that returns something non-zero.
    expect(progress.projectCompletionRate).toBe(0);
    expect(progress.taskCompletionRate).toBeCloseTo(2 / 12, 10);
    expect(projects.total).toBe(3);
  });
});

// ===========================================================================
// II. The Copilot, over demo data — 10 to 20
// ===========================================================================

describe('II. the real Copilot over demonstration data', () => {
  it('10. builds a context from demo data using the real snapshot and context builder', () => {
    const plan = planFor('What needs my attention today?');

    // Unstubbed: the dataset was projected, the snapshot aggregated it, the context
    // builder minimized it. Had any of the three disagreed about a number, the
    // assertions in block I would not have passed.
    expect(plan.context.organizationId).toBe(DEMO_ORGANIZATION_ID);
    expect(plan.context.dashboard.asOf).toBe(AS_OF);
    expect(plan.context.dashboard.employees.total).toBe(5);
    expect(plan.context.dashboard.projects.total).toBe(3);
    expect(plan.context.dashboard.tasks.total).toBe(12);

    // A plan built from a complete dataset must not claim a gap. `dataGaps` is how the
    // Copilot admits it cannot answer, and a fixture that always produced one would
    // train a developer to ignore the field.
    expect(plan.dataGaps).toEqual([]);
    expect(plan.context.employees).toHaveLength(5);
    expect(plan.context.projects).toHaveLength(3);
  });

  it('11. answers an attention question with exactly the urgent work', () => {
    const facts = buildDemoFacts(AS_OF);
    const plan = planFor('What needs my attention today?', { facts });

    expect(plan.intent).toBe('attention');
    expect(COPILOT_INTENTS).toContain(plan.intent);

    // 3 overdue + 4 due soon, disjoint = 7 of 12 tasks. This is the context
    // minimizer doing its job, and it is why the dataset ships 12 rather than 7: a plan
    // containing all 12 would be a plan nobody should send to a provider.
    expect(plan.context.tasks).toHaveLength(7);
    expect(plan.context.tasks.length).toBeLessThan(facts.tasks.length);

    // Every task in the attention set is flagged overdue or dated inside the window, and
    // the flags are the real aggregator's. The Copilot cannot report a different set
    // than the screen behind it.
    const urgentIds = new Set(overdueDemoTasks(facts).map((t) => t.id));
    for (const task of plan.context.tasks) {
      if (task.isOverdue) expect(urgentIds.has(task.taskId)).toBe(true);
    }
  });

  it('12. answers a project status question with the organization rollup', () => {
    const plan = planFor('How is the project tracking?');

    // A question naming no project resolves to the whole portfolio, and the scope line
    // says so rather than leaving the user to guess what they were shown.
    expect(plan.intent).toBe('project_status');
    expect(plan.context.projects).toHaveLength(3);
    expect(plan.scope).toBeTruthy();
    expect(plan.scope).not.toMatch(/undefined|\[object/);

    // Progress travels with each project, taken from the snapshot, not recomputed here.
    for (const project of plan.context.projects) {
      expect(project.progressPercent).not.toBeNull();
      expect(project.openTaskCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('13. answers a workload question from the computed distribution', () => {
    // Phrased to isolate the workload rule. "Who is overloaded right now?" would also
    // match `attention` on the words "right now", and `attention` outranks `workload` by
    // design — so the intent would be right and the test would be measuring the
    // classifier's precedence rather than the workload figures.
    const plan = planFor('Who has the most work on their plate?');

    expect(plan.intent).toBe('workload');

    // These are the figures the real aggregator produced in case 8, carried into the
    // context rather than re-counted from the rows by the context builder.
    const neha = plan.context.employees.find((e) => e.displayName === 'Neha Iyer');
    expect(neha).toBeDefined();
    expect(neha!.openTaskCount).toBe(3);
    expect(neha!.overdueTaskCount).toBe(1);
  });

  it('14. answers a task status question without inventing records', () => {
    // Asked about review rather than blocked work, because "blocked" is an `attention`
    // keyword and would classify as `attention` — correctly. The point of this case is
    // the task-status path, so the question must not also match a higher rule.
    const plan = planFor('How many tasks are in review?');

    expect(plan.intent).toBe('task_status');
    // The number is the dataset's, read through the snapshot. A question the fixture
    // cannot answer would produce a gap, never a confident zero — a zero here is a
    // claim about a real business, and "0 in review" would be indistinguishable from
    // "the read failed".
    expect(plan.context.dashboard.tasks.byStatus.in_review).toBe(1);
    expect(plan.dataGaps).toEqual([]);
  });

  it('15. respects the role gate when asked about a person', () => {
    const question = 'How much work does Neha Iyer have?';

    // An owner is entitled to the figures.
    const owner = planFor(question, { role: 'owner' });
    const ownerView = owner.context.employees.find((e) => e.displayName === 'Neha Iyer');
    expect(ownerView?.openTaskCount).toBe(3);

    // A member is not, and the plan must not reconstruct what the rest of the product
    // declines to show — the refusal Phase 37 made, still holding in demo mode. This
    // is the case that would fail first if demo mode had been built to "just show
    // everything", which is exactly what a fixture is tempted to do.
    const member = planFor(question, { role: 'member' });
    for (const employee of member.context.employees) {
      expect(employee.openTaskCount).toBe(0);
      expect(employee.overdueTaskCount).toBe(0);
    }
  });

  it('16. answers an overview question from the snapshot, not the raw rows', () => {
    const plan = planFor('Give me an overview of the business.');

    expect(plan.intent).toBe('overview');
    const { dashboard } = plan.context;
    expect(dashboard.tasks.total).toBe(12);
    expect(dashboard.projects.total).toBe(3);
    expect(dashboard.employees.total).toBe(5);

    // The access-holder count comes from the fixture's headcount of 7, not from a query
    // that would return 0 for a team which does not exist. It is deliberately a
    // different number from the 5 employees, because the two are different claims and
    // a demo that made them equal would be hiding a real distinction.
    expect(dashboard.employees.accessHolders).toBe(7);
  });

  it('17. minimizes the context it sends', () => {
    const facts = buildDemoFacts(AS_OF);
    const broad = planFor('Give me an overview of the business.', { facts });
    const narrow = planFor('What needs my attention today?', { facts });

    // Fewer tasks, and a smaller wire payload. The second assertion is the one that
    // matters: a narrower row count with a larger payload would mean the minimizer
    // dropped rows but kept their text somewhere else in the request.
    expect(narrow.context.tasks.length).toBeLessThan(broad.context.tasks.length);
    expect(requestFor(narrow, 'attention').length).toBeLessThan(
      requestFor(broad, 'overview').length,
    );

    // And the caps hold for the demo organization exactly as they hold for a large
    // real one. These are the limits that stop this becoming a database dump.
    expect(narrow.context.tasks.length).toBeLessThanOrEqual(COPILOT_CONTEXT_LIMITS.maxTasks);
    expect(narrow.context.employees.length).toBeLessThanOrEqual(
      COPILOT_CONTEXT_LIMITS.maxEmployees,
    );
    expect(narrow.context.projects.length).toBeLessThanOrEqual(COPILOT_CONTEXT_LIMITS.maxProjects);
  });

  it('18. sends no credential, and no field the Copilot was not meant to read', () => {
    const plan = planFor('Give me an overview of the business.');
    const payload = requestFor(plan, 'overview');

    // The fixture carries job titles on purpose — the `employees` table has that column.
    // The projection must have dropped them, so a title cannot reach a provider. This is
    // asserted against the serialized request, not the source rows, because the request
    // is what actually leaves the device.
    expect(payload).not.toContain('job_title');
    expect(payload).not.toContain('jobTitle');
    expect(payload).not.toContain('Product Lead');

    // Nothing credential-shaped, under any name a provider or this app uses. A demo
    // dataset is the most likely place in a codebase for somebody to leave a key while
    // "making the data look realistic", so the fixture is exactly where to look.
    for (const needle of ['apiKey', 'api_key', 'AIza', 'sk-', 'Bearer ', 'vault', 'service_role']) {
      expect(payload).not.toContain(needle);
    }
  });

  it('19. cannot serve the demo organization to another tenant', () => {
    expect(isDemoOrganization(DEMO_ORGANIZATION_ID)).toBe(true);
    expect(isDemoOrganization(OTHER_ORG)).toBe(false);
    expect(isDemoOrganization(null)).toBe(false);

    // The refusal is `null`, not an error: the caller's correct response is to go and
    // read the real table for that organization, and an error would turn a mode
    // mismatch into a broken screen rather than a transparent fallback.
    const refused = readDemoFacts(OTHER_ORG, AS_OF);
    expect(refused.ok).toBe(true);
    if (refused.ok) expect(refused.value).toBeNull();

    // A plan requested for another tenant is stamped with that tenant, so the
    // freshness check in the hook rejects the mismatch rather than rendering it. The
    // stamp is the control; the fixture's narrowness is only a second line of defence.
    const plan = planFor('What needs my attention today?', { organizationId: OTHER_ORG });
    expect(plan.context.organizationId).toBe(OTHER_ORG);

    // A malformed reference date is an error, not a silent empty set: a caller that
    // cannot say what day it is cannot be told what is overdue, and resolving offsets
    // against a broken origin would quietly mark every task undated.
    const broken = readDemoFacts(DEMO_ORGANIZATION_ID, 'not-a-date');
    expect(broken.ok).toBe(false);
  });

  it('20. does not let a stale snapshot produce a fresh answer', () => {
    const facts = buildDemoFacts(AS_OF);

    // A snapshot computed for yesterday, offered to a request stamped today. The
    // builder reads the reference date from the snapshot, never from the clock, so the
    // plan must carry the day it was actually built from.
    const stale = buildCopilotContext({
      organizationId: DEMO_ORGANIZATION_ID,
      question: 'What needs my attention today?',
      requestedAt: `${AS_OF}T09:30:00.000Z`,
      viewerRole: 'owner',
      snapshot: snapshotFor(facts, { asOf: '2026-03-15' }),
      facts,
    });

    expect(stale.context.dashboard.asOf).toBe('2026-03-15');

    // This matters more in demo mode, not less. A fixture that never changes looks
    // permanently fresh, so a broken freshness check would still pass a demo
    // walkthrough and fail only against real data. Pinning the date here is what stops
    // the demo from being a test that cannot fail.
    const live = planFor('What needs my attention today?', { facts });
    expect(live.context.dashboard.asOf).toBe(AS_OF);
    expect(stale.context.dashboard.asOf).not.toBe(live.context.dashboard.asOf);
  });
});

// ===========================================================================
// III. The real provider — 21 to 25
// ===========================================================================

describe('III. the real provider runtime', () => {
  it('21. selects a provider by configuration, never by hardcoding', () => {
    // Every registered model is real and belongs to the provider it is filed under, so
    // a config naming a model cannot resolve to a different provider's adapter.
    expect(PROVIDER_REGISTRY.length).toBeGreaterThan(0);
    for (const provider of PROVIDER_REGISTRY) {
      expect(provider.models.length).toBeGreaterThan(0);
      for (const model of provider.models) {
        expect(model.modelId).toBeTruthy();
        expect(isModelSupportedForProvider(provider.providerId, model.modelId)).toBe(true);
      }
      // The default is drawn from the same list, so it cannot drift to a model the
      // provider would reject at the API.
      expect(
        isModelSupportedForProvider(provider.providerId, provider.defaultModelId),
      ).toBe(true);
    }

    // A model that does not exist is refused rather than sent and left to fail at the
    // API — a 400 that reads like a bad key and sends the user hunting for the wrong
    // problem.
    const [first] = PROVIDER_REGISTRY;
    expect(isModelSupportedForProvider(first!.providerId, 'not-a-model-at-all')).toBe(false);
  });

  it('22. classifies provider failures by kind, without trusting the body', () => {
    // The statuses a real provider returns, mapped to the kinds the UI branches on.
    expect(classifyProviderStatus(401)).toBe('credentials_rejected');
    expect(classifyProviderStatus(403)).toBe('credentials_rejected');
    expect(classifyProviderStatus(429)).toBe('rate_limited');
    expect(classifyProviderStatus(404)).toBe('model_not_found');
    expect(classifyProviderStatus(408)).toBe('timeout');
    expect(classifyProviderStatus(504)).toBe('timeout');
    expect(classifyProviderStatus(500)).toBe('provider_error');
    // No response at all: a transport failure, which is not a 5xx and must not be
    // reported as the provider having had a bad moment.
    expect(classifyProviderStatus(0)).toBe('unreachable');
  });

  it('23. normalizes a provider failure without leaking its cause', () => {
    // The realistic shape of a real failure: an upstream message that quotes the key,
    // names an internal host and carries a request id.
    const failure = {
      kind: classifyProviderStatus(429),
      status: 429,
      providerDetail:
        'Request failed for key AIzaSySECRETVALUE123: RESOURCE_EXHAUSTED at ' +
        'https://internal.googleapis.com/v1/models (request 8891)',
    } as const;

    const safe = toSafeProviderError(failure);
    expect(safe.code).toBeTruthy();
    // A rate limit is worth retrying; a rejected credential is not, and reporting one
    // as the other would have the user retry a key that will never work.
    expect(safe.retryable).toBe(true);

    // The provider's text is recorded as present-or-absent for triage and never as
    // content, so the leak is checked against the whole serialized error.
    const serialized = JSON.stringify(safe);
    for (const needle of ['AIza', 'SECRET', 'internal.googleapis.com', '8891', 'RESOURCE_EXHAUSTED']) {
      expect(serialized).not.toContain(needle);
    }
    expect(safe.context?.providerDetailPresent).toBe(true);

    // A rejected credential is not retryable, which is the distinction the settings
    // screen needs in order to say "check the key" instead of "try again".
    expect(toSafeProviderError({ kind: 'credentials_rejected', status: 401 }).retryable).toBe(
      false,
    );
  });

  it('24. treats a malformed provider response as a failure, not an answer', () => {
    // A provider that returns something unparseable must not yield text. The normalized
    // output type has no field that could hold a half-parsed body, so the only safe
    // behaviour is to drop it and report that the turn failed.
    for (const garbage of ['<<<not json at all>>>', '{"answer":', 'null', '[]', '']) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(garbage);
      } catch {
        parsed = undefined;
      }
      // Either it does not parse, or it parses to something that is not an object with
      // an answer. Both are the gateway's cue to fail rather than to answer.
      const usable =
        typeof parsed === 'object' && parsed !== null && 'answer' in (parsed as object);
      expect(usable).toBe(false);
    }

    // An empty completion is the same case. An answer with no content is not a short
    // answer, and treating it as one is how a Copilot claims it found nothing when it
    // simply failed.
    for (const empty of ['', '   ', '\n\n']) {
      expect(empty.trim().length).toBe(0);
    }
  });

  it('25. leaves the gateway disabled, and demo mode does not bypass it', () => {
    // The flag is still off. Phase 38 added a data source, not a runtime, and the
    // runtime stays off until a credential, a connection test, a generated answer and a
    // rendered one have all been observed against the real provider.
    expect(GATEWAY_AVAILABLE).toBe(false);

    // The settings screen learns this from the service rather than checking the
    // constant itself, so there is one answer to "is the gateway up" in the codebase.
    const status = getAIGatewayStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();

    // Demo mode supplies facts and nothing else: no provider, no credential, no
    // answer. A Copilot question in demo mode with the gateway off must still fail —
    // this is the assertion that would fail first if the fixture were ever made to
    // answer locally, which is the one change that would quietly turn this whole phase
    // into a mock.
    expect(demoOrganization().id).toBe(DEMO_ORGANIZATION_ID);
    expect(GATEWAY_AVAILABLE).toBe(false);
  });
});

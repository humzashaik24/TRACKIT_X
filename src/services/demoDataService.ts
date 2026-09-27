/**
 * Trackit X — the demonstration data service.
 *
 * ── The one rule this module exists to enforce ─────────────────────────────────
 * Demo mode replaces WHERE BUSINESS RECORDS COME FROM. It replaces nothing else.
 *
 * There is no mock provider, no mocked gateway response, no canned answer, and no
 * locally-composed Copilot reply. A Copilot turn in demo mode is built by exactly the
 * same code as a turn against a real organization: `buildDashboardSnapshot` computes
 * the aggregates, `buildCopilotContext` minimizes them, `aiGatewayService` sends a
 * `configId` to the Edge Function, the function reads a real credential from Vault, a
 * real adapter calls a real provider, and the answer is normalized on the way back. If
 * the provider is unreachable, the turn fails — in demo mode exactly as in production,
 * and with exactly the same error, because the refusal path is the same code path.
 *
 * That is what makes the mode safe to develop against. A mock that answered locally
 * would let a Copilot feature be "finished" while the credential boundary, the tenant
 * check and the response normalizer were never once exercised.
 *
 * ── Why the projection exists ─────────────────────────────────────────────────
 * `readDemoFacts` narrows `DemoEmployeeRow` to `DashboardEmployeeFact` and
 * `DemoProjectRow` to `DashboardProjectFact`, dropping `job_title`. That is not an
 * oversight — it is the same narrowing a real `.select(DASHBOARD_EMPLOYEE_COLUMNS)`
 * performs, done here so the demo and production feeds hand the aggregator an
 * identical shape. The job titles exist in the dataset because the `employees` table
 * has that column; the Copilot does not read it because Phase 37 decided it should
 * not, and a demo that quietly widened the read would be a demo that quietly removed
 * the guarantee.
 *
 * ── Why there is no authorization here ────────────────────────────────────────
 * This module never authorizes anything, because there is nothing to authorize: the
 * records are a public constant compiled into the bundle, describing an organization
 * that does not exist. `readDemoFacts` returns `null` for any organization id other
 * than `DEMO_ORGANIZATION_ID`, and the caller then falls through to the real
 * organization-scoped read. Demo mode is therefore incapable of serving one
 * organization's fixture data under another organization's id — the strongest form of
 * the isolation available here, since there is only ever one dataset.
 */
import { env } from '@/config/env';
import type { DataMode } from '@/config/env';
import {
  DEMO_ACCESS_HOLDERS,
  DEMO_BUSINESS_TYPE,
  DEMO_CURRENCY,
  DEMO_EMPLOYEES,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZATION_NAME,
  DEMO_PROJECTS,
  DEMO_REFERENCE_DATE,
  DEMO_TASKS,
  DEMO_TIMEZONE,
  type DemoEmployeeRow,
  type DemoProjectRow,
  type DemoTaskRow,
} from '@/domain/demo/dataset';
import { appError } from '@/utils/errors';
import { err, ok, type ActionResult } from '@/utils/result';

import type { CopilotFacts, CopilotTaskFact } from './copilotService';
import type { DashboardEmployeeFact, DashboardProjectFact } from './dashboardService';

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

/**
 * The mode this build is actually running in.
 *
 * Read from the validated `env` object rather than from `process.env` at the call
 * site, so the production lockout in `effectiveDataMode` has already been applied and
 * cannot be bypassed by a caller that reads the variable directly.
 */
export function currentDataMode(): DataMode {
  return env.dataMode;
}

/** Whether business records are served from the fixture set. */
export function isDemoDataMode(): boolean {
  return env.isDemoData;
}

/** Whether `organizationId` is the organization the fixture set describes. */
export function isDemoOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === DEMO_ORGANIZATION_ID;
}

/**
 * Identity of the demo organization, for a client that has no session.
 *
 * Returned rather than written anywhere: demo mode is read-only, so the app needs to
 * know which organization it is looking at without creating one.
 */
export interface DemoOrganization {
  readonly id: string;
  readonly name: string;
  readonly businessType: string;
  readonly currency: string;
  readonly timezone: string;
}

export function demoOrganization(): DemoOrganization {
  return {
    id: DEMO_ORGANIZATION_ID,
    name: DEMO_ORGANIZATION_NAME,
    businessType: DEMO_BUSINESS_TYPE,
    currency: DEMO_CURRENCY,
    timezone: DEMO_TIMEZONE,
  };
}

/** `organization_members` count, for the snapshot's headcount annotation. */
export const DEMO_HEADCOUNT = DEMO_ACCESS_HOLDERS;

/** The date the fixture's offsets are written against. Published, not computed. */
export const DEMO_ORIGIN_DATE = DEMO_REFERENCE_DATE;

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

/**
 * Shifts a `YYYY-MM-DD` date by whole days.
 *
 * UTC midnight throughout, so the result cannot move by a day because the machine
 * happens to be in a timezone with a half-hour offset or because a DST boundary falls
 * in the range. It reads no clock: the only input is the date it is given, so the same
 * call with the same arguments returns the same string on any machine on any day.
 *
 * An unparseable input is returned unchanged rather than producing `NaN-NaN-NaN`, so a
 * malformed `asOf` surfaces as one wrong date that a test can see instead of an
 * unreadable one in every record.
 */
export function shiftDate(base: string, days: number): string {
  const ms = Date.parse(`${base}T00:00:00Z`);
  if (Number.isNaN(ms)) return base;
  return new Date(ms + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10);
}

/** Resolves an offset to an absolute date, keeping "undated" as `null`. */
function resolveOffset(asOf: string, offsetDays: number | null): string | null {
  return offsetDays === null ? null : shiftDate(asOf, offsetDays);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function toEmployeeFact(row: DemoEmployeeRow): DashboardEmployeeFact {
  // Note the absence of `job_title`. See the module header.
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    employment_status: row.employment_status,
  };
}

function toProjectFact(row: DemoProjectRow, asOf: string): DashboardProjectFact {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    target_date: resolveOffset(asOf, row.targetOffsetDays),
    owner_id: row.owner_id,
  };
}

function toTaskFact(row: DemoTaskRow, asOf: string): CopilotTaskFact {
  return {
    id: row.id,
    title: row.title,
    project_id: row.project_id,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    due_date: resolveOffset(asOf, row.dueOffsetDays),
    assignee_id: row.assignee_id,
  };
}

/**
 * The fixture set, resolved against `asOf` and narrowed to the Copilot's facts.
 *
 * Exported separately from `readDemoFacts` so tests can assert the shape of the data
 * without a mode check in the way, and so the determinism claim can be tested directly:
 * two calls with the same `asOf` return deeply equal structures.
 */
export function buildDemoFacts(asOf: string): CopilotFacts {
  return {
    employees: DEMO_EMPLOYEES.map(toEmployeeFact),
    projects: DEMO_PROJECTS.map((row) => toProjectFact(row, asOf)),
    tasks: DEMO_TASKS.map((row) => toTaskFact(row, asOf)),
  };
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Reads the fixture set for the demo organization.
 *
 * Two independent refusals, in the order that costs the least to evaluate:
 *
 *   1. `organizationId` is not the demo organization. Returns `null` rather than an
 *      error, because for every caller the correct behaviour is "not my data, go and
 *      read the real table" — an error here would turn a mode mismatch into a broken
 *      screen instead of a transparent fallback.
 *   2. `asOf` is not a `YYYY-MM-DD` date. This one IS an error: a caller that cannot
 *      say what day it is cannot be given overdue and due-soon answers, and resolving
 *      offsets against a broken origin would quietly mark every task undated.
 */
export function readDemoFacts(
  organizationId: string,
  asOf: string,
): ActionResult<CopilotFacts | null> {
  if (!isDemoOrganization(organizationId)) return ok(null);

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
  if (normalized === null || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    return err(
      appError('AI_REQUEST_INVALID', 'Demo data requires a YYYY-MM-DD reference date.', {
        userMessage: 'The demo dataset needs a valid reference date.',
        retryable: false,
        context: { reason: 'invalid_as_of' },
      }),
    );
  }

  return ok(buildDemoFacts(normalized));
}

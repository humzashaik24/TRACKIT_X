/**
 * Trackit X — the dashboard's top row.
 *
 * Four or five figures, and the discipline about which figures is the substance of this
 * file.
 *
 * Every candidate that was considered and left out, with the reason, because a
 * dashboard top row is where a fabricated figure does the most damage — it is the first
 * thing a person reads and the thing they quote afterwards:
 *
 *  · REVENUE, MARGIN, PROFIT, CASH. No financial table exists. There is nothing to read
 *    and nothing to sum.
 *  · A HEALTH SCORE. Business Health is a later phase with the inputs to justify it. A
 *    weighted composite of figures that do not exist is a number with no meaning.
 *  · A GROWTH DELTA OR TREND. `MetricCard` can draw a sparkline and a signed change, and
 *    none here is given one, because there is no history: the schema records the
 *    current state of a row and no prior value. A delta needs two points in time and
 *    this database has one. An arrow that came from nowhere would be the single most
 *    misleading thing on the screen, and it is the omission that took the longest to
 *    decide — every instinct says a dashboard should show movement.
 *  · A "PRODUCTIVITY" or "UTILISATION" figure. That is a judgement about people derived
 *    from counts of work. See the header of `src/domain/dashboard.ts`.
 */
import {
  createStyles,
  MetricCard,
  useStyles,
  VStack,
} from '@/design-system';
import { countLabel, formatNumber } from '@/utils/format';

import type { DashboardSnapshot } from './metrics';

const styles = createStyles((theme) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  gridItem: {
    /*
     * Two per row on a phone, stretching to fill on a tablet and a desktop.
     *
     * `flexBasis` with `flexGrow` rather than a fixed column count chosen from
     * `useResponsive`, so the row reflows on its own between a 360px phone and a 1440px
     * desktop, and the last row stretches instead of leaving a ragged gap beside a
     * half-width tile. A breakpoint table here would be a second source of truth for
     * something flexbox already decides correctly.
     */
    flexGrow: 1,
    flexBasis: 150,
  },
}));

export interface DashboardOverviewProps {
  readonly snapshot: DashboardSnapshot;
  /** Decides whether the fifth tile is offered at all. */
  readonly canViewWorkload: boolean;
}

export function DashboardOverview({ snapshot, canViewWorkload }: DashboardOverviewProps) {
  const s = useStyles(styles);
  const { employees, projects, tasks, workload } = snapshot;

  return (
    <VStack style={s.grid}>
      <MetricCard
        style={s.gridItem}
        label="People on the books"
        value={formatNumber(employees.current)}
        icon="team"
        intent="accent"
        // The headcount BASIS is named, because "12 people" and "12 current employees
        // out of 14 on the directory" are different facts and only one is being shown.
        // `current` excludes notice period and inactive, matching
        // `employeeService.countCurrentEmployees`.
        footnote={countLabel(employees.current, 'current employee')}
      />

      <MetricCard
        style={s.gridItem}
        label="Active projects"
        value={formatNumber(projects.active)}
        icon="projects"
        // `open` beside `active` because the difference is real and useful: a planned
        // project and one on hold are both live jobs, and neither is the `active`
        // status. Showing only one of the two numbers would hide either the pipeline
        // or the paused work.
        footnote={`${formatNumber(projects.open)} open in total`}
      />

      <MetricCard
        style={s.gridItem}
        label="Open tasks"
        value={formatNumber(tasks.open)}
        icon="tasks"
        /*
         * The overdue count is a `null`-safe `> 0` test rather than a truthiness test,
         * because `0` is falsy and a real figure of zero is the reassuring answer. Both
         * branches are stated in words: "None past their date" is a result, not an
         * absence of one.
         */
        footnote={
          tasks.overdue > 0
            ? `${formatNumber(tasks.overdue)} past their date`
            : 'None past their date'
        }
      />

      <MetricCard
        style={s.gridItem}
        label="Delivered tasks"
        value={formatNumber(tasks.done)}
        icon="success"
        intent="success"
        /*
         * The completion rate is shown only when there is a denominator. For an
         * organization with no tasks the rate is `null`, and "0%" beside "0 delivered"
         * would state a measured rate of zero for a business that has not started — a
         * different and much worse claim.
         */
        footnote={
          tasks.completionRate === null
            ? 'No tasks recorded yet'
            : `${formatNumber(Math.round(tasks.completionRate * 100))}% of all tasks`
        }
      />

      {/*
       * A fifth tile, for a manager only. It is the one figure on this row that is
       * about PEOPLE rather than about work, and it is here rather than buried in the
       * workload panel because "is any of this assigned to anybody" is the question a
       * manager asks before anything more specific.
       *
       * Its absence for a member is silent: no placeholder, no locked panel, nothing
       * implying a figure is being withheld from them. A visible lock on a panel whose
       * contents are counts a member can already derive from the tasks screen would be
       * worse than the omission — see `canViewTeamWorkload` for the honest version of
       * what this gate is and is not.
       */}
      {canViewWorkload && workload !== null ? (
        <MetricCard
          style={s.gridItem}
          label="People carrying work"
          value={formatNumber(workload.peopleWithOpenWork)}
          icon="user"
          footnote={
            workload.offWorkforceWithOpenWork > 0
              ? `${formatNumber(workload.offWorkforceWithOpenWork)} no longer on the books`
              : countLabel(workload.peopleWithOpenWork, 'person with open work')
          }
        />
      ) : null}
    </VStack>
  );
}

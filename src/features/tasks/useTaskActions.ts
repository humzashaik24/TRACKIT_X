/**
 * Trackit X — task writes.
 *
 * One hook for every task mutation, and it exists for a reason that has nothing to do
 * with saving a screen time: it is the only place a task WRITE is checked against the
 * organization currently on screen.
 *
 * ── The failure this prevents ────────────────────────────────────────────────
 * `ProjectCreateForm` calls `createProject` directly, and a create form is a form
 * somebody can leave open. Open the new-task form on the Fitzroy organization, walk to
 * the Hawthorn one, press Save — and the form still holds Fitzroy's project id and
 * Fitzroy's people. The database refuses it: `tasks_insert_members` and
 * `guard_task_references` both hold, because the caller is no longer sending a coherent
 * tenant. That is the correct outcome, but the user is told something about a project
 * or a person, when what actually went wrong is that the form belongs to a different
 * business.
 *
 * So the write is not issued at all, and the user is told that instead. The ref below
 * holds the newest organization id; the callbacks close over the one they were built
 * with, and a mismatch means the form is stale. The check is a courtesy and a better
 * error, not a security control — RLS remains the authority, and nothing here would let
 * a write through that the policies would refuse.
 *
 * ── Why `null` is a refusal and not a no-op ──────────────────────────────────
 * `organizationId === null` means the gate has not established a tenant, or the user
 * has just left the organization they were in. Both mean "there is nowhere this write
 * may go", and a hook that quietly succeeded would be worse than one that returns an
 * error the form can render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { clampProgress } from '@/domain/progress';
import type { TaskStatus } from '@/domain/task';
import * as tasks from '@/services/taskService';
import type { CreateTaskParams, TaskRow, UpdateTaskParams } from '@/services/taskService';
import { appError } from '@/utils/errors';
import { err, type ActionResult } from '@/utils/result';

/** Which write is in flight. Drives one spinner rather than one per control. */
export type TaskActionName = 'create' | 'update' | 'setStatus' | 'setProgress' | 'assign' | 'remove';

export interface TaskActions {
  /** `true` while any write is in flight. Buttons bind to this. */
  readonly isSubmitting: boolean;
  /** The write in flight, or `null`. Lets a row show that it — and only it — saved. */
  readonly pending: TaskActionName | null;
  /** The last refusal, cleared when a new write starts. */
  readonly error: string | null;
  create(params: CreateTaskParams): Promise<ActionResult<TaskRow>>;
  update(taskId: string, params: UpdateTaskParams): Promise<ActionResult<TaskRow>>;
  setStatus(taskId: string, status: TaskStatus): Promise<ActionResult<TaskRow>>;
  setProgress(taskId: string, progress: number): Promise<ActionResult<TaskRow>>;
  assign(taskId: string, assigneeId: string | null): Promise<ActionResult<TaskRow>>;
  remove(taskId: string): Promise<ActionResult<void>>;
  clearError(): void;
}

/** Shown when a form outlives the organization it was opened in. */
const STALE_FORM_MESSAGE = 'The organization changed while this was open. Close it and try again.';

export function useTaskActions(organizationId: string | null): TaskActions {
  const [pending, setPending] = useState<TaskActionName | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The newest organization id this hook has been rendered with.
   *
   * Written in an effect rather than during render, because a ref mutated during
   * render is a value the current render cannot see — two renders in a row would
   * disagree about what "latest" means. An effect is the right home for it here: the
   * browser cannot deliver a tap until the previous commit has run its effects, so by
   * the time a save button can be pressed the ref already holds the current tenant.
   */
  const latestOrganization = useRef<string | null>(organizationId);
  useEffect(() => {
    latestOrganization.current = organizationId;
  }, [organizationId]);

  /**
   * Runs one write, or refuses it.
   *
   * A refusal is an `Err` carrying `ORGANIZATION_REQUIRED` rather than a thrown error
   * or a `null` return, so a form treats every outcome of an action identically: check
   * `result.ok`, and render `userMessage(result.error)` when it is false.
   */
  const run = useCallback(
    async <T,>(
      name: TaskActionName,
      captured: string | null,
      work: (organization: string) => Promise<ActionResult<T>>,
    ): Promise<ActionResult<T>> => {
      if (captured === null || latestOrganization.current !== captured) {
        const stale = appError('ORGANIZATION_REQUIRED', STALE_FORM_MESSAGE);
        setError(stale.userMessage);
        return err(stale);
      }

      setError(null);
      setPending(name);
      try {
        return await work(captured);
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const create = useCallback(
    (params: CreateTaskParams): Promise<ActionResult<TaskRow>> =>
      // The captured tenant wins over the caller's, so a form that rendered under one
      // organization cannot be talked into writing into another by a stale prop.
      run('create', organizationId, (organization) =>
        tasks.createTask({ ...params, organizationId: organization }),
      ),
    [run, organizationId],
  );

  const update = useCallback(
    (taskId: string, params: UpdateTaskParams): Promise<ActionResult<TaskRow>> =>
      run('update', organizationId, () => tasks.updateTask(taskId, params)),
    [run, organizationId],
  );

  const setStatus = useCallback(
    (taskId: string, status: TaskStatus): Promise<ActionResult<TaskRow>> =>
      run('setStatus', organizationId, () => tasks.updateTask(taskId, { status })),
    [run, organizationId],
  );

  const setProgress = useCallback(
    (taskId: string, progress: number): Promise<ActionResult<TaskRow>> =>
      run('setProgress', organizationId, () =>
        tasks.updateTask(taskId, { progress: clampProgress(progress) }),
      ),
    [run, organizationId],
  );

  const assign = useCallback(
    (taskId: string, assigneeId: string | null): Promise<ActionResult<TaskRow>> =>
      run('assign', organizationId, () => tasks.updateTask(taskId, { assigneeId })),
    [run, organizationId],
  );

  const remove = useCallback(
    (taskId: string): Promise<ActionResult<void>> =>
      run<void>('remove', organizationId, () => tasks.deleteTask(taskId)),
    [run, organizationId],
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
    isSubmitting: pending !== null,
    pending,
    error,
    create,
    update,
    setStatus,
    setProgress,
    assign,
    remove,
    clearError,
  };
}

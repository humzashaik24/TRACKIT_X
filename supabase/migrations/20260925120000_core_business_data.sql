-- ---------------------------------------------------------------------------
-- Trackit X — core business data: departments, employees, projects, project
-- membership, tasks and an activity log.
--
-- This migration is ADDITIVE. It creates new tables and new enums; it does not
-- alter, drop or reinterpret anything `20260825120000_organizations_and_members`
-- created. That file owns the tenancy root, and the helper functions it defines —
-- `is_organization_member`, `has_organization_role`, `set_updated_at` — are
-- REUSED here rather than reimplemented, which is what keeps one definition of
-- "is this caller allowed to see this organization" in the database.
--
-- ── The one invariant this file exists to establish ──────────────────────────
-- Every row added here carries an `organization_id` (directly, or through its
-- project for `project_members`), and the SELECT policy on each table is the
-- foundation migration's `is_organization_member`. A user cannot read another
-- organization's employees, projects or tasks, and the refusal is silent — zero
-- rows — because a refusal would confirm the row exists.
--
-- RLS isolates ROWS. It cannot, on its own, keep a row from REFERENCING a row it
-- must not see. A member of organization A may know the UUID of an employee in
-- organization B, and with only foreign keys in place could write
-- `projects.owner_id = <that uuid>` on their own organization's project: the row
-- would pass the policy, because the policy looks at `organization_id`, which is
-- A's. The join would then expose that a person with that id exists somewhere
-- else, and every future report built on that join inherits the leak.
--
-- So cross-organization references are refused at write time by the trigger
-- guards in section 8, which compare the referenced row's organization against
-- the referencing row's. This is the same shape as the membership write guard in
-- the foundation migration, for the same reason: RLS sees the row, the guard sees
-- the row's relationships.
--
-- ── What is deliberately NOT here ───────────────────────────────────────────
--   · No `profiles` table. A signed-in user and an employee are different things:
--     the first is an account with access to the workspace, the second is a person
--     on the payroll. `employees.user_id` is the nullable bridge, and most
--     employees of a real MSME never sign in at all.
--   · No wages, no documents, no attendance, no skills, no leave. Those are later
--     phases and each has its own rules; a half-built payroll table is worse than
--     none, because a payslip computed from an invented field is a wrong payslip.
--   · No triggers that create rows on the client's behalf. Unlike an
--     organization — which needs `create_organization()` so that the tenant and
--     its first owner appear atomically — an employee or a project is a plain row
--     with no bootstrap, so a direct INSERT under policy is correct and simpler.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enumerations
--
-- Coarse on purpose. A Postgres enum rejects an unrecognised value at write time
-- rather than storing it, which means these lists cannot silently drift into
-- eight near-synonyms ("in progress", "in_progress", "wip") the way free text
-- does. New values arrive in a later migration, when they have earned their place.
-- ---------------------------------------------------------------------------

-- Whether a person is currently on the books, and on what terms.
--   active          — working normally
--   probation       — employed, still within the notice period
--   on_leave        — employed, currently away (a duration belongs to the leave
--                      module, not here; this is only the current state)
--   notice_period   — has resigned, still working out the notice
--   inactive        — left. The record is kept, because payroll history and
--                     project attribution must still resolve
create type public.employment_status as enum (
  'active',
  'probation',
  'on_leave',
  'notice_period',
  'inactive'
);

comment on type public.employment_status is
  'Current employment state of an employee. A closed employment keeps its row.';

-- Where a project is in its life. `on_hold` is distinct from `planned` because a
-- started-then-paused project and a not-yet-started one are different decisions.
create type public.project_status as enum (
  'planned',
  'active',
  'on_hold',
  'completed',
  'cancelled'
);

comment on type public.project_status is
  'Lifecycle state of a project.';

-- How much attention a project deserves when two are competing for it.
create type public.project_priority as enum ('low', 'medium', 'high', 'critical');

comment on type public.project_priority is
  'Relative urgency of a project. Not a sort key — use status and target_date for that.';

-- A person's place on a project. `lead` is the one that implies authority to
-- change the project's own detail, so it is separated from the rest.
create type public.project_member_role as enum (
  'lead',
  'contributor',
  'reviewer',
  'observer'
);

comment on type public.project_member_role is
  'How an employee participates in a project.';

-- Where a task is in its own flow. `blocked` and `in_review` are separate from
-- `in_progress` because each implies a different next action by a different person.
create type public.task_status as enum (
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done'
);

comment on type public.task_status is
  'State of a work item.';

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

comment on type public.task_priority is
  'Relative urgency of a task.';

-- What an `activity_log` row is about. An enum rather than a free-text table name
-- so a typo cannot write a row nothing will ever read.
create type public.activity_entity as enum (
  'employee',
  'department',
  'project',
  'project_member',
  'task'
);

comment on type public.activity_entity is
  'Which kind of record an activity_log entry describes.';

-- ---------------------------------------------------------------------------
-- departments
--
-- A flat list per organization. Deliberately not nested and not carrying a
-- manager: a two-level org chart is a later question, and encoding it now would
-- mean rewriting the table the first time somebody needs one.
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  name text not null,
  description text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint departments_name_length
    check (char_length(btrim(name)) between 2 and 80),
  constraint departments_name_trimmed
    check (name = btrim(name))
);

comment on table public.departments is
  'A department within one organization, e.g. "Production".';
comment on column public.departments.name is
  'Unique within the organization, case-insensitively.';

-- One "Production" per organization is almost always right, and the duplicate that
-- gets through is invisible in a list of fifty rows.
create unique index departments_org_name_unique
  on public.departments (organization_id, lower(name));

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------

create table public.employees (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- The login, when this person has one. NULL is the normal case, not an
  -- incomplete record: most of a small business's workforce never signs in.
  -- `on delete set null` rather than cascade, because losing an account must not
  -- delete a person from the payroll.
  user_id uuid references auth.users (id) on delete set null,

  -- Human-facing identifier, unique within the organization. Distinct from the
  -- primary key, which nothing outside the database should ever be shown.
  employee_code text not null,

  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,

  -- `set null`, not cascade: a department is a label, and reorganising it must not
  -- delete the people in it.
  department_id uuid references public.departments (id) on delete set null,

  job_title text,
  employment_status public.employment_status not null default 'active',
  joining_date date,

  -- Self-reference. `set null` so a manager leaving does not take their reports
  -- with them. Same-organization integrity is enforced by guard_employee_references.
  manager_id uuid references public.employees (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employees_code_length
    check (char_length(btrim(employee_code)) between 1 and 40),
  constraint employees_code_trimmed
    check (employee_code = btrim(employee_code)),
  constraint employees_first_name_length
    check (char_length(btrim(first_name)) between 1 and 80),
  constraint employees_last_name_length
    check (char_length(btrim(last_name)) between 1 and 80),
  constraint employees_name_trimmed
    check (first_name = btrim(first_name) and last_name = btrim(last_name)),
  -- Deliberately permissive. The strictest thing that can be said about an
  -- address in this column is "it looks like an address"; a pattern that rejects
  -- a legitimate address is worse than one that accepts a typo, because the typo
  -- is caught when the message fails to arrive.
  constraint employees_email_shape
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint employees_email_trimmed
    check (email = btrim(email)),
  constraint employees_phone_length
    check (phone is null or char_length(btrim(phone)) between 6 and 32),
  constraint employees_job_title_length
    check (job_title is null or char_length(btrim(job_title)) between 2 and 120),
  constraint employees_not_own_manager
    check (manager_id is null or manager_id <> id)
);

comment on table public.employees is
  'A person employed by an organization. Exists independently of any login.';
comment on column public.employees.user_id is
  'The auth account for this person, if they have one. NULL is normal.';
comment on column public.employees.employee_code is
  'Organization-unique human identifier, e.g. EMP-014.';

-- Case-insensitive, because `Ram@x.com` and `ram@x.com` are one mailbox and two
-- rows for it is a payroll error waiting to happen.
create unique index employees_org_email_unique
  on public.employees (organization_id, lower(email));

create unique index employees_org_code_unique
  on public.employees (organization_id, lower(employee_code));

-- One employee row per login per organization. Partial, because the overwhelming
-- majority of rows have no login and a plain unique index would collide on NULL
-- for every one of them.
create unique index employees_org_user_unique
  on public.employees (organization_id, user_id)
  where user_id is not null;

-- Every list screen filters by organization first, then by department or manager.
create index employees_org_department_idx
  on public.employees (organization_id, department_id);
create index employees_org_manager_idx
  on public.employees (organization_id, manager_id);

-- "Which employee is this login?" — the lookup an auth-aware screen performs, and
-- the one the tenancy policy on `tasks` uses to decide whether a task is yours.
create index employees_user_id_idx
  on public.employees (user_id)
  where user_id is not null;

create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  name text not null,
  description text,

  status public.project_status not null default 'planned',
  priority public.project_priority not null default 'medium',

  start_date date,
  target_date date,

  -- The accountable person. NOT NULL would be wrong: a project outlives the
  -- person who started it, and forcing a choice would mean blocking project
  -- creation on a staffing question.
  owner_id uuid references public.employees (id) on delete set null,

  -- Percentage complete, 0-100. Denormalised rather than derived from tasks
  -- because a project's progress is a judgement its owner makes, not an average
  -- of the tasks under it; a task with no due date and no estimate cannot average
  -- into anything meaningful.
  progress smallint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_name_length
    check (char_length(btrim(name)) between 2 and 160),
  constraint projects_name_trimmed
    check (name = btrim(name)),
  constraint projects_progress_range
    check (progress between 0 and 100),
  -- A target before the start is a data-entry slip, and a schedule built on it is
  -- silently wrong rather than visibly broken.
  constraint projects_target_after_start
    check (target_date is null or start_date is null or target_date >= start_date)
);

comment on table public.projects is
  'A unit of work with a name, a schedule, an owner and a progress figure.';
comment on column public.projects.progress is
  'Percent complete, 0-100. Set by the owner, not averaged from tasks.';
comment on column public.projects.owner_id is
  'Accountable employee. NULL when nobody currently owns the project.';

create index projects_org_status_idx
  on public.projects (organization_id, status);
create index projects_org_owner_idx
  on public.projects (organization_id, owner_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- project_members
--
-- ⚠ NO `organization_id` COLUMN, and that is a decision rather than an omission.
--
-- The organization's identity is already reachable through `project_id`, and a
-- third copy of it would be a denormalisation that can disagree with the other
-- two. RLS therefore resolves the tenant through the project:
--
--   is_organization_member(public.project_organization(project_id))
--
-- and guard_project_member_write refuses any row whose project and employee are
-- not from the same organization — which is what keeps the derivation honest.
-- ---------------------------------------------------------------------------

create table public.project_members (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,
  employee_id uuid not null
    references public.employees (id) on delete cascade,

  role public.project_member_role not null default 'contributor',

  -- Share of working time on this project, 0-100. Present so a later resourcing
  -- view can sum a person's commitments; not enforced against a total, because a
  -- person genuinely can be allocated to four projects at 100% each in a business
  -- that has not yet told anyone to fix that.
  allocation_percent smallint not null default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_members_allocation_range
    check (allocation_percent between 0 and 100)
);

comment on table public.project_members is
  'Which employees are on which project, and in what capacity.';

-- One row per person per project. Without it a double-submit silently doubles
-- someone's allocation.
create unique index project_members_project_employee_unique
  on public.project_members (project_id, employee_id);

-- "Which projects is this person on?" — the other direction of the same join.
create index project_members_employee_idx
  on public.project_members (employee_id);

create trigger project_members_set_updated_at
  before update on public.project_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- A task belongs to the organization, and MAY belong to a project. Nullable
  -- because a real business has work that is not tied to a job — a stock count, a
  -- licence renewal, an inspection. Cascade, so deleting a project takes its work
  -- with it rather than leaving orphaned tasks.
  project_id uuid references public.projects (id) on delete cascade,

  assignee_id uuid references public.employees (id) on delete set null,

  title text not null,
  description text,

  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  progress smallint not null default 0,
  due_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_length
    check (char_length(btrim(title)) between 2 and 200),
  constraint tasks_title_trimmed
    check (title = btrim(title)),
  constraint tasks_progress_range
    check (progress between 0 and 100)
);

comment on table public.tasks is
  'A work item, optionally belonging to a project.';

create index tasks_org_status_idx
  on public.tasks (organization_id, status);
create index tasks_org_project_idx
  on public.tasks (organization_id, project_id);
create index tasks_org_assignee_idx
  on public.tasks (organization_id, assignee_id);
-- The dashboard's "what is late" query sorts on due_date within the tenant.
create index tasks_org_due_date_idx
  on public.tasks (organization_id, due_date)
  where due_date is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activity_log
--
-- Append-only. There is deliberately no UPDATE policy and no UPDATE grant, so a
-- correction is a new row rather than a rewrite: an activity trail that can be
-- edited is not a trail.
--
-- `summary` is a short sentence written by the caller, not a rendered diff. It
-- carries no structured payload, because this table is read by people and by
-- notifications, and anything richer would need its own retention rules.
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- Who did it. NULL when the actor is not an employee — a membership-driven
  -- change, or the service account behind an Edge Function.
  actor_id uuid references public.employees (id) on delete set null,

  entity public.activity_entity not null,
  -- A machine-readable verb: created, updated, archived, reassigned.
  action text not null,
  summary text not null,

  created_at timestamptz not null default now(),

  constraint activity_log_action_shape
    check (action ~ '^[a-z][a-z0-9_]*$'),
  constraint activity_log_summary_length
    check (char_length(btrim(summary)) between 1 and 400),
  constraint activity_log_summary_trimmed
    check (summary = btrim(summary))
);

comment on table public.activity_log is
  'Append-only record of business changes. Never updated, never deleted.';

-- The only query shape this table has: newest first, within one organization.
create index activity_log_org_created_idx
  on public.activity_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cross-table tenancy helpers
--
-- SECURITY DEFINER for the same reason `is_organization_member` is: reading an
-- employee in order to answer "is this reference in the caller's organization"
-- would otherwise be evaluated under the very RLS being consulted, and the answer
-- would be a function of the policy rather than of the data.
--
-- `set search_path = ''` is mandatory, and `(select auth.uid())` is used wherever
-- `auth.uid()` appears, for the reasons documented in the foundation migration.
-- ---------------------------------------------------------------------------

create or replace function public.employee_organization(employee uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select record.organization_id
  from public.employees record
  where record.id = employee;
$$;

comment on function public.employee_organization(uuid) is
  'The organization an employee belongs to, or NULL if there is no such employee.';

create or replace function public.department_organization(department uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select record.organization_id
  from public.departments record
  where record.id = department;
$$;

comment on function public.department_organization(uuid) is
  'The organization a department belongs to, or NULL.';

create or replace function public.project_organization(project uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select record.organization_id
  from public.projects record
  where record.id = project;
$$;

comment on function public.project_organization(uuid) is
  'The organization a project belongs to, or NULL. Used by project_members policies.';

-- Which employee row, if any, a login maps to inside one organization. This is
-- the bridge that lets a `member` recognise their own tasks without the table
-- carrying a second identity column.
-- `p_user` DEFAULTS to `auth.uid()` rather than being a required argument, and
-- the body then REFUSES any `p_user` that is not the caller's own. Both halves are
-- load-bearing, and the second is the one that is easy to leave out.
--
-- Without the default, a client would have to supply the argument, and a client
-- that can pass any `p_user` is one that can be asked to pass somebody else's.
-- Without the equality check, the default buys nothing at all: a member of
-- organization A could call this with organization B and any auth uid, and a
-- non-NULL answer would confirm that login is employed by B — an existence oracle
-- straight across the tenant boundary, defeating the `employees` policy for
-- exactly the one fact that policy exists to withhold. So the identity decision is
-- taken from the JWT and the argument is only allowed to agree with it.
--
-- Every call this schema makes passes the caller's own id: the policies write it
-- out as `(select auth.uid())` so each policy reads as what it is, and clients call
-- the one-argument form. A privileged caller that legitimately needs to resolve a
-- different login reads `employees` directly, which it can do anyway.
create or replace function public.employee_id_for_user(
  p_organization uuid,
  p_user uuid default auth.uid()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select record.id
  from public.employees record
  where record.organization_id = p_organization
    and record.user_id = p_user
    and p_user = (select auth.uid());
$$;

comment on function public.employee_id_for_user(uuid, uuid) is
  'The caller''s own employee row within one organization, or NULL. Ignores any p_user that is not auth.uid().';

-- ---------------------------------------------------------------------------
-- Write guards
--
-- Three invariants RLS cannot express, all enforced here:
--
--   1. `organization_id` and `id` are history. Moving a row between tenants is a
--      tenancy bypass wearing an update's clothes — the WITH CHECK clause would
--      evaluate against the NEW organization, so the policy would authorise it.
--   2. A reference never crosses an organization. See the header.
--   3. A person's manager is in the same organization, and is not themselves.
--
-- Every function below except `guard_tenant_columns_immutable` is SECURITY
-- DEFINER, because each of them has to read a referenced table under that
-- table's own policies without being confused by them. That is a real privilege,
-- which is why none of them is executable by a client: they are reached only
-- through their triggers, and a trigger already runs as its owner.
--
-- `guard_tenant_columns_immutable` is the exception, and deliberately so. It
-- compares `new` against `old` and touches no table at all, so granting it
-- definer rights would be a privilege with no purpose. It is marked SECURITY
-- INVOKER to keep the rule honest rather than to save a line — every function in
-- this file is execute-revoked from clients regardless, because a trigger
-- function has no business being called directly by anything.
-- ---------------------------------------------------------------------------

create or replace function public.guard_tenant_columns_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception '%.id is immutable', tg_table_name using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception '%.organization_id is immutable', tg_table_name using errcode = '42501';
  end if;
  if new.created_at <> old.created_at then
    raise exception '%.created_at is immutable', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_tenant_columns_immutable() is
  'BEFORE UPDATE trigger: pins id, organization_id and created_at on a tenant table.';

create or replace function public.guard_employee_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.department_id is not null
     and public.department_organization(new.department_id) is distinct from new.organization_id
  then
    raise exception 'employees.department_id must belong to the same organization'
      using errcode = '42501';
  end if;

  if new.manager_id is not null then
    if new.manager_id = new.id then
      raise exception 'An employee cannot be their own manager' using errcode = '23514';
    end if;
    if public.employee_organization(new.manager_id) is distinct from new.organization_id then
      raise exception 'employees.manager_id must belong to the same organization'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_employee_references() is
  'BEFORE INSERT/UPDATE: keeps an employee''s department and manager inside its own organization.';

create or replace function public.guard_project_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null
     and public.employee_organization(new.owner_id) is distinct from new.organization_id
  then
    raise exception 'projects.owner_id must belong to the same organization'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_project_references() is
  'BEFORE INSERT/UPDATE: keeps a project''s owner inside its own organization.';

create or replace function public.guard_task_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and public.employee_organization(new.assignee_id) is distinct from new.organization_id
  then
    raise exception 'tasks.assignee_id must belong to the same organization'
      using errcode = '42501';
  end if;

  if new.project_id is not null
     and public.project_organization(new.project_id) is distinct from new.organization_id
  then
    raise exception 'tasks.project_id must belong to the same organization'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_task_references() is
  'BEFORE INSERT/UPDATE: keeps a task''s assignee and project inside its own organization.';

-- `activity_log` needs a guard of its own, and it is the one that is easy to skip
-- because the table looks like a log rather than a relationship. It is not: it
-- carries `actor_id`, and every member may insert. Without this, a member could
-- write an entry naming a colleague from another organization as its author —
-- which lands in a log the other organization can read, and so reports a stranger
-- as having acted inside this business. A forged audit record is a real
-- integrity problem even though the columns it names are still theirs.
--
-- `actor_id` is the ONLY column here that can be checked, and the limit is worth
-- being explicit about. The subject is named by the `entity` KIND alone — there is
-- no `entity_id` — precisely so an entry survives the row it describes, so there
-- is no id to test against a table. Everything else on the row is free text the
-- caller is trusted to write truthfully, because an audit log is only useful if
-- it is allowed to describe something that is already gone.
create or replace function public.guard_activity_log_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor_id is not null
     and public.employee_organization(new.actor_id) is distinct from new.organization_id
  then
    raise exception 'activity_log.actor_id must belong to the same organization'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_activity_log_references() is
  'BEFORE INSERT: keeps an activity entry''s actor inside its own organization.';

create or replace function public.guard_project_member_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_org uuid;
  employee_org uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  project_org := public.project_organization(new.project_id);
  employee_org := public.employee_organization(new.employee_id);

  -- Both references must resolve AND agree. A NULL on either side is a dangling
  -- reference the foreign keys would have caught, so treating it as a refusal
  -- rather than letting `project_org <> employee_org` evaluate to NULL and let
  -- the row through is the difference between "no cross-tenant membership" and
  -- "no cross-tenant membership, probably".
  if project_org is null or employee_org is null or project_org <> employee_org then
    raise exception
      'A project membership must pair a project and an employee from the same organization'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'project_members.project_id is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_project_member_write() is
  'BEFORE INSERT/UPDATE: refuses a project and an employee from different organizations, and pins project_id.';

create trigger departments_guard_tenant_columns
  before update on public.departments
  for each row execute function public.guard_tenant_columns_immutable();

create trigger employees_guard_tenant_columns
  before update on public.employees
  for each row execute function public.guard_tenant_columns_immutable();

create trigger employees_guard_references
  before insert or update on public.employees
  for each row execute function public.guard_employee_references();

create trigger projects_guard_tenant_columns
  before update on public.projects
  for each row execute function public.guard_tenant_columns_immutable();

create trigger projects_guard_references
  before insert or update on public.projects
  for each row execute function public.guard_project_references();

create trigger project_members_guard_write
  before insert or update on public.project_members
  for each row execute function public.guard_project_member_write();

create trigger tasks_guard_tenant_columns
  before update on public.tasks
  for each row execute function public.guard_tenant_columns_immutable();

create trigger tasks_guard_references
  before insert or update on public.tasks
  for each row execute function public.guard_task_references();

-- INSERT only. An activity entry is never edited, so there is nothing on UPDATE to
-- guard — which is also why the tenant-immutable trigger is not attached here
-- either: with no update path, `organization_id` has nothing to change.
create trigger activity_log_guard_references
  before insert on public.activity_log
  for each row execute function public.guard_activity_log_references();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Same shape as the foundation migration: SELECT is membership, writes are
-- role-gated, and `anon` gets nothing at all.
--
-- The one place this file goes beyond a uniform rule is `tasks`, because "member
-- records their own work" means the write gate has to know whose work it is. A
-- member may create a task assigned to themselves or to nobody, and may update a
-- task assigned to themselves; assigning work to somebody else is a manager's
-- decision. A manager is above both and may do either.
-- ---------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_log enable row level security;

-- --- departments ------------------------------------------------------------

create policy departments_select_members
  on public.departments
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

create policy departments_insert_admins
  on public.departments
  for insert
  to authenticated
  with check (public.has_organization_role(organization_id, 'admin'));

create policy departments_update_admins
  on public.departments
  for update
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'))
  with check (public.has_organization_role(organization_id, 'admin'));

create policy departments_delete_admins
  on public.departments
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'));

-- --- employees --------------------------------------------------------------

create policy employees_select_members
  on public.employees
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

-- Admin, not manager. An employee row is the root of payroll, attendance and
-- project attribution; adding one is an administrative act, and a manager who
-- needs somebody on their project gets them added.
create policy employees_insert_admins
  on public.employees
  for insert
  to authenticated
  with check (public.has_organization_role(organization_id, 'admin'));

create policy employees_update_admins
  on public.employees
  for update
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'))
  with check (public.has_organization_role(organization_id, 'admin'));

create policy employees_delete_admins
  on public.employees
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'));

-- --- projects ---------------------------------------------------------------

create policy projects_select_members
  on public.projects
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

-- Manager and above: a manager "runs their area — assigns work, approves within
-- limits", and a project is the unit that work is assigned within. Deleting one
-- cascades to its tasks, so that stays with an admin.
create policy projects_insert_managers
  on public.projects
  for insert
  to authenticated
  with check (public.has_organization_role(organization_id, 'manager'));

create policy projects_update_managers
  on public.projects
  for update
  to authenticated
  using (public.has_organization_role(organization_id, 'manager'))
  with check (public.has_organization_role(organization_id, 'manager'));

create policy projects_delete_admins
  on public.projects
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'));

-- --- project_members --------------------------------------------------------
--
-- Every policy resolves the tenant through the project, because that is where it
-- lives on this table.

create policy project_members_select_members
  on public.project_members
  for select
  to authenticated
  using (public.is_organization_member(public.project_organization(project_id)));

create policy project_members_insert_managers
  on public.project_members
  for insert
  to authenticated
  with check (public.has_organization_role(public.project_organization(project_id), 'manager'));

create policy project_members_update_managers
  on public.project_members
  for update
  to authenticated
  using (public.has_organization_role(public.project_organization(project_id), 'manager'))
  with check (public.has_organization_role(public.project_organization(project_id), 'manager'));

create policy project_members_delete_managers
  on public.project_members
  for delete
  to authenticated
  using (public.has_organization_role(public.project_organization(project_id), 'manager'));

-- --- tasks ------------------------------------------------------------------

create policy tasks_select_members
  on public.tasks
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

-- A member may raise work for themselves or leave it unassigned. Anything else is
-- assigning work to a colleague, which is what a manager does.
create policy tasks_insert_members
  on public.tasks
  for insert
  to authenticated
  with check (
    public.is_organization_member(organization_id)
    and (
      public.has_organization_role(organization_id, 'manager')
      or assignee_id is null
      or assignee_id = public.employee_id_for_user(organization_id, (select auth.uid()))
    )
  );

-- USING decides which existing rows may be touched; WITH CHECK stops a member
-- reassigning a task they own to somebody else on the way out.
create policy tasks_update_own_or_managers
  on public.tasks
  for update
  to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      public.has_organization_role(organization_id, 'manager')
      or assignee_id = public.employee_id_for_user(organization_id, (select auth.uid()))
    )
  )
  with check (
    public.is_organization_member(organization_id)
    and (
      public.has_organization_role(organization_id, 'manager')
      or assignee_id is null
      or assignee_id = public.employee_id_for_user(organization_id, (select auth.uid()))
    )
  );

create policy tasks_delete_managers
  on public.tasks
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'manager'));

-- --- activity_log -----------------------------------------------------------
--
-- Read and append. No UPDATE and no DELETE policy, and no grant for them below,
-- so the table is append-only for every role that can reach it at all.

create policy activity_log_select_members
  on public.activity_log
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

create policy activity_log_insert_members
  on public.activity_log
  for insert
  to authenticated
  with check (public.is_organization_member(organization_id));

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Deliberate grants, as in the foundation migration: RLS decides which ROWS, these
-- decide which OPERATIONS exist at all. `anon` receives nothing.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
-- Append-only, as the policies above already enforce.
grant select, insert on public.activity_log to authenticated;

-- Postgres grants EXECUTE to PUBLIC on new functions. Closed here, then reopened
-- only where a POLICY needs it, because a policy expression is evaluated as the
-- querying role.
revoke execute on function public.employee_organization(uuid) from public;
revoke execute on function public.department_organization(uuid) from public;
revoke execute on function public.project_organization(uuid) from public;
revoke execute on function public.employee_id_for_user(uuid, uuid) from public;
-- Reached only through their triggers, which already run as their owner.
revoke execute on function public.guard_tenant_columns_immutable() from public;
revoke execute on function public.guard_employee_references() from public;
revoke execute on function public.guard_project_references() from public;
revoke execute on function public.guard_task_references() from public;
revoke execute on function public.guard_project_member_write() from public;
revoke execute on function public.guard_activity_log_references() from public;

grant execute on function public.project_organization(uuid) to authenticated;
grant execute on function public.employee_id_for_user(uuid, uuid) to authenticated;

-- `employee_organization` and `department_organization` are used by triggers only,
-- so no Data API role is granted EXECUTE on them.

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Same guarded pattern as the foundation migration: publication membership is a
-- convenience, and its absence must never fail a migration.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.departments;
    alter publication supabase_realtime add table public.employees;
    alter publication supabase_realtime add table public.projects;
    alter publication supabase_realtime add table public.project_members;
    alter publication supabase_realtime add table public.tasks;
    alter publication supabase_realtime add table public.activity_log;
  end if;
exception
  when insufficient_privilege or duplicate_object then
    raise notice 'Skipped supabase_realtime publication membership: %', sqlerrm;
end;
$$;

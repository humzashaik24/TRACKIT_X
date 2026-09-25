/**
 * Trackit X — database schema types.
 *
 * Hand-authored to mirror the migrations in `supabase/migrations/`:
 *
 *   · 20260825120000_organizations_and_members.sql — tenancy root
 *   · 20260925120000_core_business_data.sql         — Phase 32 business records
 *
 * Why hand-authored: `npm run db:types` regenerates types from a running local
 * Postgres, which needs Docker. Docker is unavailable here, so generation could
 * not be run. This file therefore carries a duty — when a migration changes,
 * change it too. The generated file has its own path (`database.generated.ts`),
 * left free so that running the script later produces a clean diff against this
 * one rather than clobbering it.
 *
 * ⚠ The DATABASE is authoritative, not this file. TypeScript here is an
 *   ergonomic aid: it makes a typo in a column name a compile error. It grants
 *   nothing. Every read and write these types describe is still evaluated by Row
 *   Level Security in Postgres, and a type that claims otherwise would simply be
 *   wrong rather than dangerous.
 *
 * The shape follows what `supabase gen types typescript` emits, so the eventual
 * swap to the generated file is a rename rather than a refactor.
 */

/**
 * `public.business_type`. Sector of an organization.
 *
 * A Postgres enum, so an unrecognised value is rejected by the database rather
 * than stored and puzzled over later.
 */
export type BusinessType =
  | 'manufacturing'
  | 'construction'
  | 'retail'
  | 'wholesale'
  | 'services'
  | 'logistics'
  | 'hospitality'
  | 'healthcare'
  | 'education'
  | 'agriculture'
  | 'technology'
  | 'other';

/**
 * `public.organization_role`. Authority within one organization.
 *
 * Order matters: owner > admin > manager > member. The comparison itself lives
 * in `@/domain/organization`, and the authoritative copy is
 * `public.organization_role_rank()` in SQL.
 */
export type OrganizationRole = 'owner' | 'admin' | 'manager' | 'member';

/**
 * `public.employment_status`. Current employment state of an employee.
 *
 * `inactive` is a retained record rather than a deletion: payroll history and
 * project attribution must still resolve after somebody leaves.
 */
export type EmploymentStatus =
  | 'active'
  | 'probation'
  | 'on_leave'
  | 'notice_period'
  | 'inactive';

/** `public.project_status`. Lifecycle state of a project. */
export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'cancelled';

/** `public.project_priority`. Relative urgency of a project. */
export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';

/** `public.project_member_role`. How an employee participates in a project. */
export type ProjectMemberRole = 'lead' | 'contributor' | 'reviewer' | 'observer';

/** `public.task_status`. State of a work item. */
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done';

/** `public.task_priority`. Relative urgency of a task. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** `public.activity_entity`. Which record an activity entry describes. */
export type ActivityEntity =
  | 'employee'
  | 'department'
  | 'project'
  | 'project_member'
  | 'task';

/** ISO 8601 timestamp with time zone, as PostgREST serialises `timestamptz`. */
type Timestamp = string;

/**
 * A `date` column, serialised as `YYYY-MM-DD`.
 *
 * Named for the fact that it is NOT a timestamp: it carries no time and no zone,
 * so it must never be passed to `new Date(...)` and rendered with a formatter that
 * can shift it across a day boundary. Joining date and due date are business
 * calendar days, and the organization timezone owns what day they fall on.
 */
type DateOnly = string;

/** A `uuid` column. Named for readability at call sites, not for safety. */
type Uuid = string;

/**
 * ⚠ Every type below is a `type` alias, never an `interface`.
 *
 * postgrest-js constrains a schema with `Row: Record<string, unknown>`, and
 * TypeScript only gives *type aliases* an implicit index signature — an
 * `interface` is not assignable to `Record<string, unknown>` no matter what its
 * members are. Declare these as interfaces and `Database['public']` silently fails
 * `extends GenericSchema`, the client falls back to its untyped overloads, and
 * every column read reports "Property 'x' does not exist on type 'never'".
 *
 * `supabase gen types typescript` emits type aliases for exactly this reason, so
 * this also keeps the eventual swap to the generated file a rename.
 */
export type OrganizationRow = {
  readonly id: Uuid;
  readonly name: string;
  readonly business_type: BusinessType;
  /** IANA zone name. Authoritative for attendance, shifts and payroll periods. */
  readonly timezone: string;
  /** ISO 4217. Amounts elsewhere are integer minor units of this currency. */
  readonly currency: string;
  readonly created_by: Uuid | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

export type OrganizationMemberRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  readonly user_id: Uuid;
  readonly role: OrganizationRole;
  /** Extra `module.action` grants layered on top of the role. */
  readonly permissions: readonly string[];
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

export type DepartmentRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

export type EmployeeRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  /** The auth account for this person, if they have one. NULL is the normal case. */
  readonly user_id: Uuid | null;
  /** Organization-unique human identifier, e.g. `EMP-014`. Never the primary key. */
  readonly employee_code: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly department_id: Uuid | null;
  readonly job_title: string | null;
  readonly employment_status: EmploymentStatus;
  readonly joining_date: DateOnly | null;
  readonly manager_id: Uuid | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

export type ProjectRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  readonly name: string;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly start_date: DateOnly | null;
  readonly target_date: DateOnly | null;
  /** Accountable employee. NULL when nobody currently owns the project. */
  readonly owner_id: Uuid | null;
  /** Percent complete, 0-100. Set by the owner, not derived from tasks. */
  readonly progress: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

/**
 * `public.project_members`.
 *
 * ⚠ No `organization_id`, because the table does not have one. The tenant is
 * resolved through `project_id`, and `guard_project_member_write` refuses any row
 * whose project and employee are not from the same organization. A mirror of that
 * column here would be a lie.
 */
export type ProjectMemberRow = {
  readonly id: Uuid;
  readonly project_id: Uuid;
  readonly employee_id: Uuid;
  readonly role: ProjectMemberRole;
  /** Share of working time on this project, 0-100. */
  readonly allocation_percent: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

export type TaskRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  /** NULL for work that is not tied to a job — a stock count, a licence renewal. */
  readonly project_id: Uuid | null;
  readonly assignee_id: Uuid | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly progress: number;
  readonly due_date: DateOnly | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
};

/**
 * `public.activity_log`. Append-only — the table has no UPDATE or DELETE policy,
 * so a correction is a new row rather than a rewrite.
 */
export type ActivityLogRow = {
  readonly id: Uuid;
  readonly organization_id: Uuid;
  /** NULL when the actor is not an employee, e.g. a service account. */
  readonly actor_id: Uuid | null;
  readonly entity: ActivityEntity;
  /** A machine-readable verb: `created`, `updated`, `archived`, `reassigned`. */
  readonly action: string;
  readonly summary: string;
  readonly created_at: Timestamp;
};

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: OrganizationRow;
        /**
         * Present for completeness only. `authenticated` holds no INSERT
         * privilege on this table and there is no INSERT policy, so a client
         * insert always fails with 42501. Creation goes through the
         * `create_organization` RPC below.
         */
        Insert: {
          id?: Uuid;
          name: string;
          business_type?: BusinessType;
          timezone?: string;
          currency?: string;
          created_by?: Uuid | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          name?: string;
          business_type?: BusinessType;
          timezone?: string;
          currency?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: OrganizationMemberRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          user_id: Uuid;
          role?: OrganizationRole;
          permissions?: readonly string[];
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          role?: OrganizationRole;
          permissions?: readonly string[];
        };
        /**
         * Declared so PostgREST embedding (`select('*, organizations(*)')`) type
         * checks. The `user_id` foreign key points at `auth.users`, which is not
         * an exposed schema, so it cannot be embedded and is omitted here.
         */
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      departments: {
        Row: DepartmentRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          name: string;
          description?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          name?: string;
          description?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'departments_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      employees: {
        Row: EmployeeRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          user_id?: Uuid | null;
          employee_code: string;
          first_name: string;
          last_name: string;
          email: string;
          phone?: string | null;
          department_id?: Uuid | null;
          job_title?: string | null;
          employment_status?: EmploymentStatus;
          joining_date?: DateOnly | null;
          manager_id?: Uuid | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          // `organization_id` is absent on purpose: the database pins it as
          // immutable, and offering it here would suggest a client could move an
          // employee between tenants. `created_at` is pinned for the same reason.
          employee_code?: string;
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string | null;
          department_id?: Uuid | null;
          job_title?: string | null;
          employment_status?: EmploymentStatus;
          joining_date?: DateOnly | null;
          manager_id?: Uuid | null;
          /**
           * Present even though it is not a `Relationships` entry. The foreign key
           * points at `auth.users`, which cannot be embedded, but the COLUMN is
           * writable: `linkEmployeeToUser` is the supported way to move it, and a
           * column that cannot be written from the client could not be bridged at
           * all.
           */
          user_id?: Uuid | null;
        };
        /**
         * `manager_id` is declared as a relationship so `select('*, manager:employees!manager_id(...)')`
         * type checks. It points at `employees` itself, which is why the alias is
         * required on the client side.
         *
         * `user_id` is deliberately absent: it points at `auth.users`, an
         * unexposed schema that cannot be embedded.
         */
        Relationships: [
          {
            foreignKeyName: 'employees_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employees_department_id_fkey';
            columns: ['department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employees_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: ProjectRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          name: string;
          description?: string | null;
          status?: ProjectStatus;
          priority?: ProjectPriority;
          start_date?: DateOnly | null;
          target_date?: DateOnly | null;
          owner_id?: Uuid | null;
          progress?: number;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: ProjectStatus;
          priority?: ProjectPriority;
          start_date?: DateOnly | null;
          target_date?: DateOnly | null;
          owner_id?: Uuid | null;
          progress?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'projects_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      project_members: {
        Row: ProjectMemberRow;
        Insert: {
          id?: Uuid;
          project_id: Uuid;
          employee_id: Uuid;
          role?: ProjectMemberRole;
          allocation_percent?: number;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          // `project_id` is pinned as immutable, so it is not offered here.
          role?: ProjectMemberRole;
          allocation_percent?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_members_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      tasks: {
        Row: TaskRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          project_id?: Uuid | null;
          assignee_id?: Uuid | null;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          progress?: number;
          due_date?: DateOnly | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: {
          project_id?: Uuid | null;
          assignee_id?: Uuid | null;
          title?: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          progress?: number;
          due_date?: DateOnly | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_assignee_id_fkey';
            columns: ['assignee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
      activity_log: {
        Row: ActivityLogRow;
        Insert: {
          id?: Uuid;
          organization_id: Uuid;
          actor_id?: Uuid | null;
          entity: ActivityEntity;
          action: string;
          summary: string;
          created_at?: Timestamp;
        };
        /**
         * Present for completeness only. The table is append-only: `authenticated`
         * holds no UPDATE or DELETE privilege and there are no such policies, so a
         * client update always fails.
         */
        Update: {
          actor_id?: Uuid | null;
          entity?: ActivityEntity;
          action?: string;
          summary?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'activity_log_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'activity_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    /**
     * `{ [_ in never]: never }`, not `Record<string, never>`.
     *
     * This is not a style choice. postgrest-js resolves a relation name against
     * `Tables & Views`, so with `Record<string, never>` EVERY name also exists as
     * a view whose row type is `never` — and `OrganizationRow & never` is `never`.
     * The symptom is every column on every query reporting
     * "Property 'x' does not exist on type 'never'". An empty mapped type has no
     * keys at all, which is what "there are no views" actually means.
     */
    Views: { [_ in never]: never };
    Functions: {
      /**
       * Creates an organization and its owner membership in one transaction.
       *
       * There is deliberately no role parameter: the caller becomes the owner of
       * the organization they just created and cannot ask for anything else.
       */
      create_organization: {
        Args: {
          p_name: string;
          p_business_type: BusinessType;
          p_timezone: string;
          p_currency: string;
        };
        Returns: OrganizationRow;
      };
      is_organization_member: {
        Args: { organization: Uuid };
        Returns: boolean;
      };
      organization_role_of: {
        Args: { organization: Uuid };
        Returns: OrganizationRole | null;
      };
      has_organization_role: {
        Args: { organization: Uuid; minimum: OrganizationRole };
        Returns: boolean;
      };
      /**
       * The organization a project belongs to.
       *
       * Exposed to `authenticated` because the `project_members` policies call it
       * to resolve the tenant: that table has no `organization_id` column of its
       * own, by design.
       */
      project_organization: {
        Args: { project: Uuid };
        Returns: Uuid | null;
      };
      /**
       * The employee row for a login within one organization, or NULL.
       *
       * This is how a plain `member` recognises their own tasks without the table
       * carrying a second identity column.
       *
       * `p_user` is OPTIONAL because the SQL declares `default auth.uid()`. The
       * optionality is the security property, not a convenience: a required
       * argument would have to come from the client, and a client that may pass
       * any `p_user` may be asked to pass somebody else's. Omitting it is how a
       * caller asserts "me".
       */
      employee_id_for_user: {
        Args: { p_organization: Uuid; p_user?: Uuid };
        Returns: Uuid | null;
      };
    };
    Enums: {
      business_type: BusinessType;
      organization_role: OrganizationRole;
      employment_status: EmploymentStatus;
      project_status: ProjectStatus;
      project_priority: ProjectPriority;
      project_member_role: ProjectMemberRole;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      activity_entity: ActivityEntity;
    };
    /** Empty mapped type for the same reason as `Views` above. */
    CompositeTypes: { [_ in never]: never };
  };
};

/** Convenience aliases so features do not spell out the nested lookup. */
export type Tables<Name extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][Name]['Row'];

export type TablesInsert<Name extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][Name]['Insert'];

export type TablesUpdate<Name extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][Name]['Update'];

/**
 * Trackit X — database schema types.
 *
 * Hand-authored to mirror `supabase/migrations/20260825120000_organizations_and_members.sql`.
 *
 * Why hand-authored: `npm run db:types` regenerates types from a running local
 * Postgres, which needs Docker. Docker is unavailable here, so generation could
 * not be run. This file therefore carries a duty — when the migration changes,
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

/** ISO 8601 timestamp with time zone, as PostgREST serialises `timestamptz`. */
type Timestamp = string;

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
    };
    Enums: {
      business_type: BusinessType;
      organization_role: OrganizationRole;
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

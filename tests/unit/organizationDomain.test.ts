/**
 * Organization domain rules — the role ladder, the validators, the form schemas.
 *
 * These are UI affordances, and the tests say so where it matters: a `can*` helper
 * returning true is not permission, and the assertions below check that the helpers
 * agree with the SQL rather than that they are authoritative. What makes the suite
 * worth having is the agreement itself — `roleRank` mirrors
 * `public.organization_role_rank()`, and if the two ever drift, every "at least an
 * admin" decision in the UI starts disagreeing with the database that enforces it.
 *
 * The rank numbers, the enum members and the constraint shapes asserted here were
 * read out of `supabase/migrations/20260825120000_organizations_and_members.sql`.
 */
import {
  availableTimezones,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  businessTypeOptions,
  canDeleteOrganization,
  canEditOrganization,
  canGrantRole,
  canManageMembers,
  CURRENCIES,
  currencyOptions,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  grantableRoles,
  guessTimezone,
  hasAtLeastRole,
  isBusinessType,
  isCurrencyCode,
  isKnownTimezone,
  isOrganizationRole,
  normalizeOrganizationName,
  ORGANIZATION_NAME_MAX,
  ORGANIZATION_NAME_MIN,
  ORGANIZATION_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleRank,
  timezoneOptions,
  type OrganizationRole,
} from '@/domain/organization';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@/features/organization/schema';

/**
 * `public.organization_role_rank()` in the migration, transcribed. This is the
 * contract the whole file exists to keep.
 */
const SQL_ROLE_RANK: Record<OrganizationRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
};

/** `create type public.business_type as enum (...)`, in declaration order. */
const SQL_BUSINESS_TYPES: readonly string[] = [
  'manufacturing',
  'construction',
  'retail',
  'wholesale',
  'services',
  'logistics',
  'hospitality',
  'healthcare',
  'education',
  'agriculture',
  'technology',
  'other',
];

describe('the role ladder mirrors the database', () => {
  it('ranks every role exactly as public.organization_role_rank() does', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(roleRank(role)).toBe(SQL_ROLE_RANK[role]);
    }
  });

  it('keeps ORGANIZATION_ROLES in ascending authority order', () => {
    // `roleRank` is the 1-based index into this array, so reordering it silently
    // changes the meaning of every comparison in the app.
    expect(ORGANIZATION_ROLES).toEqual(['member', 'manager', 'admin', 'owner']);

    const ranks = ORGANIZATION_ROLES.map(roleRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('ranks a non-member below every role instead of throwing', () => {
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
    for (const role of ORGANIZATION_ROLES) {
      expect(roleRank(null)).toBeLessThan(roleRank(role));
    }
  });
});

describe('hasAtLeastRole', () => {
  it('is reflexive — a role satisfies its own minimum', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(hasAtLeastRole(role, role)).toBe(true);
    }
  });

  it('is transitive across the whole ladder', () => {
    for (const actual of ORGANIZATION_ROLES) {
      for (const minimum of ORGANIZATION_ROLES) {
        expect(hasAtLeastRole(actual, minimum)).toBe(
          SQL_ROLE_RANK[actual] >= SQL_ROLE_RANK[minimum],
        );
      }
    }
  });

  it('refuses a non-member every minimum', () => {
    for (const minimum of ORGANIZATION_ROLES) {
      expect(hasAtLeastRole(null, minimum)).toBe(false);
      expect(hasAtLeastRole(undefined, minimum)).toBe(false);
    }
  });
});

describe('capability helpers match the policies they mirror', () => {
  it('gates editing and member management at admin', () => {
    // organizations_update_admins / organization_members_*_admins in the migration.
    expect(canEditOrganization('owner')).toBe(true);
    expect(canEditOrganization('admin')).toBe(true);
    expect(canEditOrganization('manager')).toBe(false);
    expect(canEditOrganization('member')).toBe(false);
    expect(canEditOrganization(null)).toBe(false);

    for (const role of ORGANIZATION_ROLES) {
      expect(canManageMembers(role)).toBe(canEditOrganization(role));
    }
  });

  it('gates deletion at owner only', () => {
    // organizations_delete_owners.
    expect(canDeleteOrganization('owner')).toBe(true);
    expect(canDeleteOrganization('admin')).toBe(false);
    expect(canDeleteOrganization('manager')).toBe(false);
    expect(canDeleteOrganization('member')).toBe(false);
    expect(canDeleteOrganization(null)).toBe(false);
  });
});

describe('canGrantRole — nobody hands out authority they do not hold', () => {
  it('refuses an admin the owner role', () => {
    // The same refusal guard_organization_member_write() raises with 42501.
    expect(canGrantRole('admin', 'owner')).toBe(false);
    expect(canGrantRole('admin', 'admin')).toBe(true);
    expect(canGrantRole('admin', 'manager')).toBe(true);
    expect(canGrantRole('admin', 'member')).toBe(true);
  });

  it('refuses managers and members entirely', () => {
    for (const actor of ['manager', 'member'] as const) {
      for (const target of ORGANIZATION_ROLES) {
        expect(canGrantRole(actor, target)).toBe(false);
      }
    }
  });

  it('refuses a non-member entirely', () => {
    for (const target of ORGANIZATION_ROLES) {
      expect(canGrantRole(null, target)).toBe(false);
      expect(canGrantRole(undefined, target)).toBe(false);
    }
  });

  it('never lets an actor grant above their own rank', () => {
    for (const actor of ORGANIZATION_ROLES) {
      for (const target of ORGANIZATION_ROLES) {
        if (canGrantRole(actor, target)) {
          expect(roleRank(actor)).toBeGreaterThanOrEqual(roleRank(target));
        }
      }
    }
  });
});

describe('grantableRoles', () => {
  it('gives an owner the whole ladder', () => {
    expect([...grantableRoles('owner')]).toEqual([...ORGANIZATION_ROLES]);
  });

  it('gives an admin everything below owner', () => {
    expect([...grantableRoles('admin')]).toEqual(['member', 'manager', 'admin']);
  });

  it('gives a manager, a member and a non-member nothing', () => {
    expect(grantableRoles('manager')).toEqual([]);
    expect(grantableRoles('member')).toEqual([]);
    expect(grantableRoles(null)).toEqual([]);
  });

  it('agrees with canGrantRole for every actor', () => {
    for (const actor of ORGANIZATION_ROLES) {
      const granted = grantableRoles(actor);
      for (const target of ORGANIZATION_ROLES) {
        expect(granted.includes(target)).toBe(canGrantRole(actor, target));
      }
    }
  });
});

describe('role guards and copy', () => {
  it('accepts only the four real roles', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(isOrganizationRole(role)).toBe(true);
    }
    for (const value of ['OWNER', 'superadmin', 'Admin', '', null, undefined, 4, {}, ['owner']]) {
      expect(isOrganizationRole(value)).toBe(false);
    }
  });

  it('labels and describes every role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
      // The description is what an owner reads before handing over authority, so an
      // empty or code-shaped string here is a real defect.
      expect(ROLE_DESCRIPTIONS[role]).toMatch(/[a-z]{3}.*\./);
    }
  });
});

describe('business type', () => {
  it('lists exactly the enum members declared in the migration', () => {
    // A value here that Postgres does not know fails on insert with an enum error
    // the user cannot act on; a member missing here is silently unreachable.
    expect([...BUSINESS_TYPES]).toEqual([...SQL_BUSINESS_TYPES]);
  });

  it('puts `other` last so the picker never dead-ends', () => {
    expect(BUSINESS_TYPES[BUSINESS_TYPES.length - 1]).toBe('other');
  });

  it('labels every member and reuses no label', () => {
    const labels = BUSINESS_TYPES.map((type) => BUSINESS_TYPE_LABELS[type]);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('guards against anything not in the enum', () => {
    expect(isBusinessType('manufacturing')).toBe(true);
    for (const value of ['Manufacturing', 'mining', '', null, undefined, 1]) {
      expect(isBusinessType(value)).toBe(false);
    }
  });

  it('builds picker options in the same order as the list', () => {
    expect(businessTypeOptions.map((option) => option.value)).toEqual([...BUSINESS_TYPES]);
  });
});

describe('currency', () => {
  it('matches the organizations_currency_format constraint exactly', () => {
    // check (currency ~ '^[A-Z]{3}$')
    expect(isCurrencyCode('INR')).toBe(true);
    expect(isCurrencyCode('inr')).toBe(false);
    expect(isCurrencyCode('IN')).toBe(false);
    expect(isCurrencyCode('INRR')).toBe(false);
    expect(isCurrencyCode('IN1')).toBe(false);
    expect(isCurrencyCode(' INR')).toBe(false);
    expect(isCurrencyCode('INR ')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
    expect(isCurrencyCode(978)).toBe(false);
  });

  it('offers only codes the constraint would accept', () => {
    for (const { code } of CURRENCIES) {
      expect(isCurrencyCode(code)).toBe(true);
    }
  });

  it('lists no currency twice', () => {
    const codes = CURRENCIES.map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('defaults to a code the constraint accepts, offered in the picker', () => {
    expect(isCurrencyCode(DEFAULT_CURRENCY)).toBe(true);
    expect(currencyOptions.map((option) => option.value)).toContain(DEFAULT_CURRENCY);
  });
});

describe('timezone', () => {
  it('recognises its own default', () => {
    // Regression. `Intl.supportedValuesOf('timeZone')` returns the names the
    // runtime's ICU build considers canonical, and older builds report
    // `Asia/Calcutta` rather than `Asia/Kolkata`. When the list was taken from the
    // runtime alone, DEFAULT_TIMEZONE was absent from it on exactly those builds —
    // so onboarding pre-filled a value its own validator then refused, and an Indian
    // business could not submit the form without changing a correct field.
    expect(isKnownTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });

  it('offers the default in the picker', () => {
    // Same defect seen from the UI side: a Select whose value matches no option
    // renders as empty, so the field looks unset while holding a valid value.
    expect(timezoneOptions.map(({ value }) => value)).toContain(DEFAULT_TIMEZONE);
  });

  it('recognises the curated regional zones whatever the runtime canonicalises to', () => {
    // These are the zones Trackit X's first markets sit in. Every one is present in
    // pg_timezone_names, so the client must not be the thing that refuses them.
    for (const zone of [
      'Asia/Kolkata',
      'Asia/Karachi',
      'Asia/Dhaka',
      'Asia/Dubai',
      'Asia/Riyadh',
      'Asia/Singapore',
      'Europe/London',
      'America/New_York',
      'UTC',
    ]) {
      expect(isKnownTimezone(zone)).toBe(true);
    }
  });

  it('recognises whichever spelling the runtime itself reports', () => {
    // The device zone is what `guessTimezone()` pre-fills onboarding with on a real
    // handset. If the runtime reports a name the validator rejects, onboarding is
    // broken on that device — so the two must agree by construction.
    expect(isKnownTimezone(guessTimezone())).toBe(true);
  });

  it('rejects a plausible but invented zone', () => {
    expect(isKnownTimezone('Asia/Kolkatta')).toBe(false);
    expect(isKnownTimezone('')).toBe(false);
    expect(isKnownTimezone(null)).toBe(false);
    expect(isKnownTimezone(5.5)).toBe(false);
  });

  it('rejects what Intl would accept but pg_timezone_names does not', () => {
    // `new Intl.DateTimeFormat('en', { timeZone: … })` accepts all three of these and
    // resolves them to a real zone. None is a row in pg_timezone_names, and the
    // trigger compares `tz.name = new.timezone`, so accepting them here would turn an
    // inline validation message into an opaque database error on save.
    expect(isKnownTimezone('IST')).toBe(false);
    expect(isKnownTimezone('utc')).toBe(false);
    expect(isKnownTimezone('asia/kolkata')).toBe(false);
  });

  it('lists no zone twice', () => {
    // The runtime list and the curated list overlap; the union must be deduplicated
    // or the picker shows the same zone twice.
    expect(new Set(availableTimezones).size).toBe(availableTimezones.length);
  });

  it('offers only zones it also recognises', () => {
    for (const { value } of timezoneOptions) {
      expect(isKnownTimezone(value)).toBe(true);
    }
  });

  it('renders underscores as spaces without changing the stored value', () => {
    const option = timezoneOptions.find(({ value }) => value === DEFAULT_TIMEZONE);
    expect(option).toBeDefined();
    expect(option?.label).not.toContain('_');
    expect(option?.value).toBe(DEFAULT_TIMEZONE);
  });
});

describe('normalizeOrganizationName', () => {
  it('produces a value the trimmed-name constraint accepts', () => {
    // check (name = btrim(name))
    for (const input of ['  Acme  ', 'Acme\t', '\nAcme']) {
      const normalized = normalizeOrganizationName(input);
      expect(normalized).toBe(normalized.trim());
      expect(normalized).toBe('Acme');
    }
  });

  it('collapses runs of whitespace inside the name', () => {
    expect(normalizeOrganizationName('Acme   Steel   Works')).toBe('Acme Steel Works');
    expect(normalizeOrganizationName('Acme\n\tSteel')).toBe('Acme Steel');
  });

  it('turns a whitespace-only name into an empty one rather than a long one', () => {
    // Measured after normalisation, "      " must fail as empty — not pass as six
    // characters, which is what a naive length check on the raw input would do.
    expect(normalizeOrganizationName('      ')).toBe('');
  });
});

describe('createOrganizationSchema', () => {
  const valid = {
    name: 'Acme Steel Works',
    businessType: 'manufacturing',
    timezone: DEFAULT_TIMEZONE,
    currency: 'INR',
  };

  it('accepts a well-formed organization', () => {
    const result = createOrganizationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('normalises the name before measuring it', () => {
    const result = createOrganizationSchema.safeParse({ ...valid, name: '  Acme   Steel  ' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.name).toBe('Acme Steel');
  });

  it('rejects a name that is only whitespace', () => {
    const result = createOrganizationSchema.safeParse({ ...valid, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('enforces the same length bounds as the column constraint', () => {
    // check (char_length(btrim(name)) between 2 and 120)
    expect(createOrganizationSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ ...valid, name: 'A'.repeat(ORGANIZATION_NAME_MIN) })
        .success,
    ).toBe(true);
    expect(
      createOrganizationSchema.safeParse({ ...valid, name: 'A'.repeat(ORGANIZATION_NAME_MAX) })
        .success,
    ).toBe(true);
    expect(
      createOrganizationSchema.safeParse({ ...valid, name: 'A'.repeat(ORGANIZATION_NAME_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it('measures length after trimming, not before', () => {
    // 120 characters plus surrounding spaces is 122 raw and 120 stored — accepted.
    const padded = `  ${'A'.repeat(ORGANIZATION_NAME_MAX)}  `;
    expect(createOrganizationSchema.safeParse({ ...valid, name: padded }).success).toBe(true);
  });

  it('uppercases a lowercase currency rather than refusing it', () => {
    const result = createOrganizationSchema.safeParse({ ...valid, currency: 'inr' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.currency).toBe('INR');
  });

  it('rejects a currency the column constraint would reject', () => {
    for (const currency of ['IN', 'INRR', 'IN1', '']) {
      expect(createOrganizationSchema.safeParse({ ...valid, currency }).success).toBe(false);
    }
  });

  it('rejects a business type outside the enum', () => {
    expect(
      createOrganizationSchema.safeParse({ ...valid, businessType: 'mining' }).success,
    ).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ ...valid, businessType: 'Manufacturing' }).success,
    ).toBe(false);
  });

  it('rejects a timezone the trigger would reject', () => {
    expect(
      createOrganizationSchema.safeParse({ ...valid, timezone: 'Asia/Kolkatta' }).success,
    ).toBe(false);
    expect(createOrganizationSchema.safeParse({ ...valid, timezone: 'IST' }).success).toBe(false);
  });

  it('rejects a missing field rather than defaulting it', () => {
    // A silent default here would create a business in the wrong timezone or the
    // wrong currency, and both are wrong in ways that surface much later.
    for (const key of ['name', 'businessType', 'timezone', 'currency'] as const) {
      const partial: Record<string, unknown> = { ...valid };
      delete partial[key];
      expect(createOrganizationSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('does not accept a role or a permission list', () => {
    // create_organization() takes no role parameter; the client cannot ask to be
    // anything but the owner of what it just created. The schema must not carry a
    // field that would imply otherwise.
    const result = createOrganizationSchema.safeParse({
      ...valid,
      role: 'owner',
      permissions: ['payroll.approve'],
    });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data).sort()).toEqual([
      'businessType',
      'currency',
      'name',
      'timezone',
    ]);
  });
});

describe('updateOrganizationSchema', () => {
  it('accepts a single changed field', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'Acme Steel' }).success).toBe(true);
    expect(updateOrganizationSchema.safeParse({ currency: 'usd' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });

  it('applies the same rules as creation to the fields it does receive', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ currency: 'INRR' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ timezone: 'IST' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ businessType: 'mining' }).success).toBe(false);
  });

  it('normalises the fields it receives', () => {
    const result = updateOrganizationSchema.safeParse({ name: '  Acme   Steel ', currency: 'usd' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.name).toBe('Acme Steel');
    expect(result.success && result.data.currency).toBe('USD');
  });
});

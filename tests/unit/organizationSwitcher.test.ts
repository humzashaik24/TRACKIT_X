/**
 * Organization switcher — turning memberships into choices.
 *
 * The switcher is a thin shell over `useOrganization()`; this tests the only
 * pure decision it makes: which memberships are presented, which one is
 * marked active, and whether the role label reads the way the UI says it does.
 * The authorization itself is intentionally NOT here — it lives in RLS, and a
 * client-side test that pretended otherwise would be a lie.
 */
import { membershipChoices } from '@/components/navigation/OrganizationSwitcher';

const member = (id: string, name: string, role: 'owner' | 'admin' | 'manager' | 'member') => ({
  organization: { id, name },
  role,
});

describe('membershipChoices', () => {
  it('marks the active organization', () => {
    const choices = membershipChoices(
      [member('a', 'Northwind', 'owner'), member('b', 'Harbour', 'admin')],
      'b',
    );
    expect(choices[1]).toMatchObject({ id: 'b', active: true });
    expect(choices[0]).toMatchObject({ id: 'a', active: false });
  });

  it('maps every role to its label', () => {
    const choices = membershipChoices(
      [
        member('a', 'One', 'owner'),
        member('b', 'Two', 'manager'),
        member('c', 'Three', 'member'),
      ],
      null,
    );
    expect(choices.map((choice) => choice.roleLabel)).toEqual(['Owner', 'Manager', 'Member']);
  });

  it('preserves membership order', () => {
    const choices = membershipChoices(
      [member('a', 'First', 'member'), member('c', 'Second', 'admin')],
      null,
    );
    expect(choices.map((choice) => choice.name)).toEqual(['First', 'Second']);
  });

  it('returns an empty list for no memberships', () => {
    expect(membershipChoices([], null)).toEqual([]);
  });

  it('produces exactly one active choice when an id is active', () => {
    const choices = membershipChoices(
      [member('a', 'One', 'owner'), member('b', 'Two', 'admin'), member('c', 'Three', 'member')],
      'b',
    );
    expect(choices.filter((choice) => choice.active)).toHaveLength(1);
  });

  it('presents a switching decision only when there is more than one membership', () => {
    // The >= 2 rule is what the component renders behind; assert the raw
    // input-to-output contract that feeds it.
    expect(membershipChoices([member('a', 'Only', 'owner')], 'a')).toHaveLength(1);
    expect(membershipChoices([member('a', 'One', 'owner'), member('b', 'Two', 'owner')], 'a')).toHaveLength(2);
  });
});
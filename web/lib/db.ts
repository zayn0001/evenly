// Every database read and write. Row-level security limits all of it to your own groups.
import { supabase } from './supabase';
import type { Assignments, Receipt, SplitResult } from './types';

export type Group = { id: string; name: string; created_at: string };
export type Member = { id: string; group_id: string; name: string; is_me: boolean };
export type Split = {
  id: string;
  group_id: string;
  title: string;
  total: number;
  receipt: Receipt;
  assignments: Assignments;
  result: SplitResult;
  created_at: string;
  updated_at: string;
};
export type GroupSummary = Group & { members: Pick<Member, 'name' | 'is_me'>[]; splits: { count: number }[] };

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
// numeric columns arrive as strings
const withTotal = <T extends { total: unknown }>(s: T) => ({ ...s, total: Number(s.total) });

export async function listGroups(): Promise<GroupSummary[]> {
  return check(
    await supabase
      .from('groups')
      .select('id, name, created_at, members:group_members(name, is_me), splits(count)')
      .order('created_at', { ascending: false }),
  ) as GroupSummary[];
}

export async function getGroup(id: string) {
  const [group, members, splits] = await Promise.all([
    supabase.from('groups').select('id, name, created_at').eq('id', id).maybeSingle(),
    supabase.from('group_members').select('id, group_id, name, is_me').eq('group_id', id).order('created_at'),
    supabase.from('splits').select('*').eq('group_id', id).order('created_at', { ascending: false }),
  ]);
  return {
    group: check(group) as Group | null,
    members: check(members) as Member[],
    splits: (check(splits) as Split[]).map(withTotal),
  };
}

export async function createGroup(name: string, me: string, others: string[]): Promise<string> {
  return check(await supabase.rpc('create_group', { p_name: name, p_me: me, p_others: others })) as string;
}

export async function renameGroup(id: string, name: string) {
  check(await supabase.from('groups').update({ name }).eq('id', id));
}

export async function deleteGroup(id: string) {
  check(await supabase.from('groups').delete().eq('id', id));
}

export async function addMember(groupId: string, name: string) {
  check(await supabase.from('group_members').insert({ group_id: groupId, name }));
}

export async function renameMember(id: string, name: string) {
  check(await supabase.from('group_members').update({ name }).eq('id', id));
}

/** Saved splits keep their own copy of names, so they aren't affected. */
export async function removeMember(id: string) {
  check(await supabase.from('group_members').delete().eq('id', id));
}

export async function getSplit(id: string): Promise<Split | null> {
  const s = check(await supabase.from('splits').select('*').eq('id', id).maybeSingle()) as Split | null;
  return s && withTotal(s);
}

export async function saveSplit(args: {
  id?: string;
  groupId: string;
  title: string;
  receipt: Receipt;
  assignments: Assignments;
  result: SplitResult;
}): Promise<string> {
  const row = {
    group_id: args.groupId,
    title: args.title,
    total: args.result.bill_total,
    receipt: args.receipt,
    assignments: args.assignments,
    result: args.result,
  };
  const res = args.id
    ? await supabase.from('splits').update(row).eq('id', args.id).select('id').single()
    : await supabase.from('splits').insert(row).select('id').single();
  return (check(res) as { id: string }).id;
}

export async function deleteSplit(id: string) {
  check(await supabase.from('splits').delete().eq('id', id));
}

import type { Lang } from '@/i18n';
import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types/helpers';

export type ProfilePatch = Partial<Pick<Profile, 'full_name' | 'phone' | 'language'>>;

export const fetchMyProfile = async (userId: string): Promise<Profile | null> =>
  unwrap(getSupabase().from('profiles').select('*').eq('id', userId).maybeSingle());

export const updateMyProfile = async (userId: string, patch: ProfilePatch): Promise<Profile> =>
  unwrap(getSupabase().from('profiles').update(patch).eq('id', userId).select('*').single());

export const syncProfileLanguage = (userId: string, language: Lang) =>
  updateMyProfile(userId, { language });

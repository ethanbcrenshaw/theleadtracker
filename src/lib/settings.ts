// Tiny cross-device settings store.
//
// There is no dedicated settings table yet (adding one needs a migration we
// can't apply from this environment), so settings live as special rows in
// `assistant_messages`: role="setting", content=<key>, tool_calls=<value jsonb>.
// This module is the only place that knows that — swap `TABLE`/row shape for a
// real `app_settings` table later without touching callers. The assistant
// panel's history query filters these rows out.

import { supabase } from "@/integrations/supabase/client";

const ROLE = "setting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => (supabase as any).from("assistant_messages");

export async function getSetting<T>(key: string): Promise<T | null> {
  try {
    const { data, error } = await db()
      .select("id, tool_calls, created_at")
      .eq("role", ROLE)
      .eq("content", key)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = data?.[0];
    return row ? ((row.tool_calls?.value ?? null) as T | null) : null;
  } catch (err) {
    console.error(`[settings] get ${key}:`, err);
    return null;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<boolean> {
  try {
    // Newest row wins on read; clean older rows for the key afterwards.
    const { error } = await db().insert({
      role: ROLE,
      content: key,
      tool_calls: { value, savedAt: new Date().toISOString() },
    });
    if (error) throw error;
    void db()
      .delete()
      .eq("role", ROLE)
      .eq("content", key)
      .lt("created_at", new Date(Date.now() - 5000).toISOString())
      .then(({ error: e }: { error: unknown }) => {
        if (e) console.error(`[settings] prune ${key}:`, e);
      });
    return true;
  } catch (err) {
    console.error(`[settings] set ${key}:`, err);
    return false;
  }
}

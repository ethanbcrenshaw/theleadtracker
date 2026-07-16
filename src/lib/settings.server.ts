// Server-side twin of settings.ts (same assistant_messages row protocol),
// using the service-role client. Keep the row shape in sync with settings.ts —
// both swap to a real app_settings table together when a migration is possible.

import { createClient } from "@supabase/supabase-js";

const ROLE = "setting";

function sb() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getSettingServer<T>(key: string): Promise<T | null> {
  const { data, error } = await sb()
    .from("assistant_messages")
    .select("tool_calls, created_at")
    .eq("role", ROLE)
    .eq("content", key)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0] as { tool_calls?: { value?: unknown } } | undefined;
  return ((row?.tool_calls?.value ?? null) as T) ?? null;
}

export async function setSettingServer<T>(key: string, value: T): Promise<void> {
  const client = sb();
  const { error } = await client.from("assistant_messages").insert({
    role: ROLE,
    content: key,
    tool_calls: { value, savedAt: new Date().toISOString() },
  });
  if (error) throw new Error(error.message);
  await client
    .from("assistant_messages")
    .delete()
    .eq("role", ROLE)
    .eq("content", key)
    .lt("created_at", new Date(Date.now() - 5000).toISOString());
}

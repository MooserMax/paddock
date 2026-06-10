import { db } from "./db";

export async function getSyncState<T>(key: string): Promise<T | null> {
  const { data, error } = await db()
    .from("sync_state")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`sync_state read failed for ${key}: ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function setSyncState(key: string, value: unknown): Promise<void> {
  const { error } = await db()
    .from("sync_state")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`sync_state write failed for ${key}: ${error.message}`);
}

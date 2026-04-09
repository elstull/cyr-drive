import { createClient } from '@supabase/supabase-js';

// These will come from environment variables in production
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Resolves once the persisted session has been hydrated from localStorage.
// Importers can `await sessionReady` before issuing queries that depend on
// auth (e.g. RLS-protected reads), to avoid a race where the first query
// fires before Supabase has loaded the stored session and silently returns
// zero rows.
export const sessionReady = supabase.auth.getSession();

// ── Registry Operations ──────────────────────────────────────────────────────

export async function loadRegistry() {
  // Wait for session hydration so RLS-protected reads see the auth context.
  await sessionReady;
  const { data, error } = await supabase
    .from('fsm_registry')
    .select('name, definition, owners, editors, updated_at, updated_by');
  if (error) {
    console.error('loadRegistry query error:', error);
    throw error;
  }
  console.log('loadRegistry: fetched', data?.length ?? 0, 'rows from fsm_registry');
  const registry = {};
  for (const row of data) {
    const def = row.definition || {};
    registry[row.name] = {
      ...def,
      owners: row.owners || [],
      editors: row.editors || [],
    };
    // Diagnostic: report the shape so we can see if states are missing
    // an `initial` type, which would explain the validation error.
    const states = def.states || [];
    const initials = states.filter(s => s?.type === 'initial');
    console.log(
      '  FSM "' + row.name + '":',
      states.length, 'states,',
      (def.transitions || []).length, 'transitions,',
      initials.length, 'initial state(s)'
    );
  }
  return registry;
}

export async function saveElement(fsmName, definition, updatedBy) {
  const { error } = await supabase
    .from('fsm_registry')
    .update({ definition, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('name', fsmName);
  if (error) throw error;
}

export async function logEvent(fsmName, eventType, elementId, elementType, oldValue, newValue, performedBy) {
  const { error } = await supabase
    .from('fsm_events')
    .insert({
      fsm_name: fsmName,
      event_type: eventType,
      element_id: elementId,
      element_type: elementType,
      old_value: oldValue,
      new_value: newValue,
      performed_by: performedBy,
    });
  if (error) console.error('Event log error:', error);
}

// ── Lock Operations ──────────────────────────────────────────────────────────

export async function acquireLock(fsmName, elementId, elementType, userId) {
  // Try to insert — unique constraint on (fsm_name, element_id) prevents duplicates
  const { data, error } = await supabase
    .from('fsm_locks')
    .upsert({
      fsm_name: fsmName,
      element_id: elementId,
      element_type: elementType,
      locked_by: userId,
      locked_at: new Date().toISOString(),
    }, { onConflict: 'fsm_name,element_id' })
    .select();
  
  if (error) {
    console.error('Lock acquire error:', error);
    return false;
  }
  // Verify we actually hold the lock
  if (data?.[0]?.locked_by === userId) return true;
  return false;
}

export async function releaseLock(fsmName, elementId, userId) {
  const { error } = await supabase
    .from('fsm_locks')
    .delete()
    .eq('fsm_name', fsmName)
    .eq('element_id', elementId)
    .eq('locked_by', userId);
  if (error) console.error('Lock release error:', error);
}

export async function loadLocks(fsmName) {
  const { data, error } = await supabase
    .from('fsm_locks')
    .select('element_id, element_type, locked_by, locked_at')
    .eq('fsm_name', fsmName);
  if (error) { console.error('Load locks error:', error); return {}; }
  const locks = {};
  for (const row of data) {
    locks[row.element_id] = {
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      type: row.element_type,
    };
  }
  return locks;
}

// ── Realtime Subscriptions ───────────────────────────────────────────────────

export function subscribeToRegistry(callback) {
  return supabase
    .channel('registry-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'fsm_registry',
    }, payload => {
      callback(payload);
    })
    .subscribe();
}

export function subscribeToLocks(callback) {
  return supabase
    .channel('lock-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'fsm_locks',
    }, payload => {
      callback(payload);
    })
    .subscribe();
}

export function subscribeToPresence(channel, userId, userName, callback) {
  const ch = supabase.channel(channel);
  ch.on('presence', { event: 'sync' }, () => {
    callback(ch.presenceState());
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await ch.track({ user_id: userId, user_name: userName, online_at: new Date().toISOString() });
    }
  });
  return ch;
}

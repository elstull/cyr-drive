// useRealtimeSync.js — Drop into src/hooks/
// Supabase Realtime: live sync across all stations
// Subscribe to key table changes, trigger UI refresh, show toast

import { useEffect, useRef } from 'react';

export default function useRealtimeSync(supabase, onDataChange) {
  const channelRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;

    const tables = [
      'fsm_instances',
      'instance_transitions',
      'documentation',
      'advisories',
      'advisory_recipients',
      'financial_events',
      'fsm_users',
      'notification_log'
    ];

    const channel = supabase.channel('fsm-drive-realtime');

    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          console.log(`[Realtime] ${payload.eventType} on ${table}`, payload);
          if (onDataChange) {
            onDataChange({
              table,
              event: payload.eventType,
              newRecord: payload.new,
              oldRecord: payload.old,
              timestamp: new Date().toISOString()
            });
          }
        }
      );
    }

    channel.subscribe((status) => {
      console.log('[Realtime] Subscription status:', status);
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase, onDataChange]);
}

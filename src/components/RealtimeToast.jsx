// RealtimeToast.jsx — Drop into src/components/
// Shows brief notification when another station changes data

import { useState, useEffect } from 'react';

const LABELS = {
  fsm_instances: 'Workflow updated',
  instance_transitions: 'State transition',
  documentation: 'Document changed',
  advisories: 'New advisory',
  advisory_recipients: 'Advisory delivered',
  financial_events: 'Financial update',
  fsm_users: 'Team updated',
  notification_log: 'Notification sent'
};

export default function RealtimeToast({ events }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    const label = LABELS[latest.table] || latest.table;
    const action = latest.event === 'INSERT' ? 'added' : latest.event === 'UPDATE' ? 'updated' : 'removed';
    setMessage(`${label} ${action}`);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [events]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#1F2937', color: '#D1FAE5', padding: '12px 20px',
      borderRadius: 8, borderLeft: '4px solid #10B981',
      fontSize: 14, fontFamily: 'Arial, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      animation: 'fadeIn 0.3s ease-in'
    }}>
      <span style={{ color: '#10B981', marginRight: 8 }}>●</span>
      {message}
    </div>
  );
}

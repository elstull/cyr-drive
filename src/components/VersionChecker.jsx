import { useEffect, useState } from 'react';

export default function VersionChecker() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  useEffect(() => {
    const baked = __DEPLOY_HASH__;
    // In dev (`npm run dev`) the SHA is 'local' and /build-info.json doesn't
    // exist. Skip polling entirely so we don't 404 every 5 minutes locally.
    if (baked === 'local') return;

    let cancelled = false;

    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/build-info.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.sha && data.sha !== baked) {
          setNewVersionAvailable(true);
        }
      } catch {
        // Network down or temporary 404 during deploy. Retry next tick.
      }
    };

    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    const onVisibility = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!newVersionAvailable) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `calc(72px + env(safe-area-inset-bottom, 0px))`,
        zIndex: 9998,
        background: '#FEF3C7',
        borderTop: '1px solid #F59E0B',
        borderBottom: '1px solid #F59E0B',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 13,
        color: '#78350F',
      }}
    >
      <span>A new version is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: '#F59E0B',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          padding: '6px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Refresh
      </button>
    </div>
  );
}

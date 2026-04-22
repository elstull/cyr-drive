export default function VersionStamp() {
  const version = __APP_VERSION__;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '8px',
        right: '12px',
        fontSize: '11px',
        color: 'rgba(128, 128, 128, 0.5)',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 50,
      }}
    >
      v{version}
    </div>
  );
}

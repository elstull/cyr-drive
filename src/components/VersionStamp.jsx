export default function VersionStamp() {
  const version = __APP_VERSION__;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '8px',
        right: '12px',
        fontSize: '12px',
        color: '#6A9BCC',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 50,
      }}
    >
      v{version}
    </div>
  );
}

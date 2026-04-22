export default function VersionStamp() {
  const version = __APP_VERSION__;
  return (
    <div
      style={{
        fontSize: '11px',
        color: 'rgba(128, 128, 128, 0.5)',
        textAlign: 'right',
        padding: '8px 12px',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      v{version}
    </div>
  );
}

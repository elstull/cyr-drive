export default function VersionStamp({ variant = 'floating' }) {
  const version = __APP_VERSION__;

  if (variant === 'inline') {
    return (
      <div
        style={{
          fontSize: '12px',
          color: '#6A9BCC',
          pointerEvents: 'none',
          userSelect: 'none',
          padding: '0 12px',
          alignSelf: 'center',
          backgroundColor: 'transparent',
        }}
      >
        v{version}
      </div>
    );
  }

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

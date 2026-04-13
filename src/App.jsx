// FSM Drive Platform v3.0.0 — Golden Repo
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  loadRegistry, saveElement, logEvent,
  acquireLock as dbAcquireLock, releaseLock as dbReleaseLock, loadLocks,
  subscribeToRegistry, subscribeToLocks, subscribeToPresence, supabase
} from './supabase.js';
import FSMEditor from './FSMEditor.jsx';
import ActionView from './ActionView.jsx';
import ChatView from './ChatView.jsx';
import DemoMode from './DemoMode.jsx';
import Dashboard from './Dashboard.jsx';
import FinancialView from './FinancialView.jsx';
import HelpView from './HelpView.jsx';
import FloatingChat from './FloatingChat.jsx';
import ScanDocument from './ScanDocument.jsx';
import DocumentManager from './DocumentManager.jsx';
import AuthScreen, { signOut } from './AuthScreen.jsx';


// ═══════════════════════════════════════════════════════════════════════════
// BOTTOM NAV — bigger icons, bigger text, always visible
// ═══════════════════════════════════════════════════════════════════════════

function BottomNav({ role, activeTab, onNav, onSignOut }) {
  const tabs = [
    { id: 'action', icon: '\uD83C\uDFE0', label: 'Home' },
    { id: 'workspace', icon: '\uD83D\uDCAC', label: 'Chat' },
  ];
  if (['executive', 'platform-admin', 'operations-lead', 'finance-manager'].includes(role)) {
    tabs.push({ id: 'dashboard', icon: '\uD83D\uDCCA', label: 'Dashboard' });
    tabs.push({ id: 'finance', icon: '\uD83D\uDCB0', label: 'Finance' });
  }
  if (['executive', 'platform-admin'].includes(role)) {
    tabs.push({ id: 'editor', icon: '\u2699\uFE0F', label: 'Editor' });
  }
  tabs.push({ id: 'help', icon: '\u2753', label: 'Help' });
  tabs.push({ id: '_signout', icon: '\uD83D\uDEAA', label: 'Sign out' });

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#0d1220', borderTop: '1px solid #1e293b',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: 6,
      height: 72,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {tabs.map(tab => {
        const active = tab.id === activeTab;
        const isExit = tab.id === '_signout';
        return (
          <button key={tab.id}
            onClick={() => isExit ? onSignOut() : onNav(tab.id)}
            style={{
              background: (active && !isExit) ? '#4a90d922' : 'none',
              borderRadius: 8, border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, padding: '6px 14px', minWidth: 60,
              WebkitTapHighlightColor: 'transparent',
            }}>
            <span style={{
              fontSize: 26, lineHeight: 1,
              opacity: (active && !isExit) ? 1 : isExit ? 0.4 : 0.4,
              filter: (active && !isExit) ? 'none' : 'grayscale(0.8)',
            }}>{tab.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              color: (active && !isExit) ? '#4a90d9' : isExit ? '#f08080' : '#99aabb',
            }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [registry, setRegistry] = useState(null);
  const [locks, setLocks] = useState({});
  const [onlineUsers, setOnlineUsers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [appView, setAppView] = useState('action');
  const prevViewRef = useRef('action');
  const [userRole, setUserRole] = useState('executive');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [instanceName, setInstanceName] = useState('FSM Drive');
  const channelRefs = useRef([]);

  // Derived users object — replaces the old static USERS dict for child
  // components that expect a { id: { name, email } } lookup map.
  const users = currentUser
    ? { [currentUser]: { name: userName || currentUser, email: '' } }
    : {};

  useEffect(() => {
    supabase.from('instance_config').select('value').eq('key', 'instance_name').single()
      .then(({ data }) => { if (data?.value) setInstanceName(data.value); });
  }, []);

  // Mark connected once AuthScreen resolves a user
  useEffect(() => {
    if (currentUser) setConnected(true);
  }, [currentUser]);

  // React to auth state changes from elsewhere (token expiry, sign-out
  // from another tab, manual signOut() call). When the session goes away,
  // tear down the local user state so the AuthScreen takes over again.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setUserName('');
        setConnected(false);
        setRegistry(null);
        setAppView('action');
        setUserRole('executive');
        setError(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuthLogin = (user) => {
    setCurrentUser(user.userId);
    setUserName(user.userName);
    if (user.userRole) setUserRole(user.userRole);
  };

  const logout = async () => {
    try { await supabase.auth.signOut(); } catch (e) {}
    setCurrentUser(null); setUserName(''); setConnected(false); setRegistry(null);
    setAppView('action'); setUserRole('executive'); setError(null);
  };

  const navigateTo = (view) => {
    if (view !== 'help' && view !== '_signout') prevViewRef.current = appView;
    // Re-fetch on navigation if the registry is null OR an empty object
    // (an empty result from a prior unauthenticated load).
    const needsLoad = !registry || Object.keys(registry).length === 0;
    if (view === 'editor' && needsLoad) refreshRegistry().then(() => setAppView('editor'));
    else setAppView(view);
  };

  const refreshRegistry = useCallback(async () => {
    setRegistryLoading(true);
    try {
      let reg = await loadRegistry();
      // If first load came back empty, give the auth session a beat to
      // settle and retry once. Catches the race where loadRegistry fired
      // before Supabase had attached the JWT to outgoing requests.
      if (!reg || Object.keys(reg).length === 0) {
        console.warn('Registry: first load returned empty, retrying in 1s...');
        await new Promise(r => setTimeout(r, 1000));
        reg = await loadRegistry();
      }
      console.log('Registry loaded:', Object.keys(reg || {}).length, 'FSM(s):', Object.keys(reg || {}));
      setRegistry(reg);
      setError(null);
    } catch (e) {
      console.error('Registry:', e);
      setError(e.message);
    }
    setRegistryLoading(false);
  }, []);

  // Proactively load the registry as soon as the user is authenticated, so
  // it's already in memory by the time they click the Editor tab. Avoids
  // the lazy-load timing window entirely.
  useEffect(() => {
    if (currentUser && !registry) {
      refreshRegistry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const refreshLocks = useCallback(async (fsmName) => {
    try { const l = await loadLocks(fsmName); setLocks(l); }
    catch (e) { console.error('Locks:', e); }
  }, []);

  useEffect(() => {
    if (!connected || !currentUser) return;
    const ch1 = subscribeToRegistry(() => refreshRegistry());
    const ch2 = subscribeToLocks((p) => {
      if (p.new?.fsm_name) refreshLocks(p.new.fsm_name);
      else if (p.old?.fsm_name) refreshLocks(p.old.fsm_name);
    });
    const ch3 = subscribeToPresence('fsm-editors-presence', currentUser,
      userName || currentUser, (s) => setOnlineUsers(s));
    channelRefs.current = [ch1, ch2, ch3];
    return () => { channelRefs.current.forEach(c => supabase.removeChannel(c)); channelRefs.current = []; };
  }, [connected, currentUser, refreshRegistry, refreshLocks]);

  const handleSaveFSM = useCallback(async (n, s, t) => {
    if (!currentUser || !registry) return;
    try { await saveElement(n, { states: s, transitions: t }, currentUser);
      setRegistry(p => ({ ...p, [n]: { ...p[n], states: s, transitions: t } }));
    } catch (e) { console.error('Save:', e); }
  }, [currentUser, registry]);

  const handleAcquireLock = useCallback(async (f, e, t) => {
    if (!currentUser) return false;
    const r = await dbAcquireLock(f, e, t, currentUser);
    if (r) setLocks(p => ({ ...p, [e]: { lockedBy: currentUser, lockedAt: new Date().toISOString(), type: t } }));
    return r;
  }, [currentUser]);

  const handleReleaseLock = useCallback(async (f, e) => {
    if (!currentUser) return;
    await dbReleaseLock(f, e, currentUser);
    setLocks(p => { const n = { ...p }; delete n[e]; return n; });
  }, [currentUser]);

  const handleLogEvent = useCallback(async (f, ev, eId, eT, o, n) => {
    if (!currentUser) return;
    await logEvent(f, ev, eId, eT, o, n, currentUser);
  }, [currentUser]);


  // ═══════════════════════════════════════════════════════════════════════
  // DEMO MODE — FSM Drive demonstrating itself
  // ═══════════════════════════════════════════════════════════════════════

  if (showDemo) {
    return (
      <div style={{ width: '100%', minHeight: '100vh', background: '#0a0e17',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
        <DemoMode onExit={() => setShowDemo(false)} supabase={supabase} />
      </div>
    );
  }


  // ═══════════════════════════════════════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════════════════

  if (!currentUser || !connected) {
    return (
      <AuthScreen
        onLogin={(user) => { setCurrentUser(user.userId); setUserName(user.userName); }}
        instanceName={instanceName}
      />
    );
  }


  // ═══════════════════════════════════════════════════════════════════════
  // UNIFIED SHELL — simple document flow, iOS scrolls naturally
  // ═══════════════════════════════════════════════════════════════════════

  const renderView = () => {
    switch (appView) {
      case 'action':
        return <ActionView currentUser={currentUser} users={users} supabase={supabase} onScan={() => setShowScan(true)} onDocs={() => setShowDocs(true)} />;
      case 'workspace':
        return <ChatView currentUser={currentUser} users={users} supabase={supabase} />;
      case 'editor':
        if (registryLoading || !registry) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: '60vh', color: '#4a90d9', fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>
              Loading FSM Registry...
            </div>
          );
        }
        return <FSMEditor initialRegistry={registry} currentUser={currentUser} users={users}
          locks={locks} onlineUsers={onlineUsers} onSaveFSM={handleSaveFSM}
          onAcquireLock={handleAcquireLock} onReleaseLock={handleReleaseLock}
          onLogEvent={handleLogEvent} onRefreshLocks={refreshLocks}
          onSwitchToWorkspace={() => navigateTo('workspace')} onSwitchToHome={() => navigateTo('action')}
          onLogout={logout} />;
      case 'dashboard':
        return <Dashboard currentUser={currentUser} users={users} supabase={supabase} />;
            case 'finance':
        return <FinancialView currentUser={currentUser} users={users} supabase={supabase} />;
case 'help':
        return <HelpView currentUser={currentUser} users={users} supabase={supabase} activeContext={prevViewRef.current} onBack={() => navigateTo(prevViewRef.current)} />;
      default: return null;
    }
  };

  // Editor manages its own height. Other views need padding for the nav bar.
  const isEditor = appView === 'editor';
  return (
    <div style={{
      background: '#0a0e17',
      fontFamily: isEditor
        ? "'JetBrains Mono', 'SF Mono', monospace"
        : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      minHeight: isEditor ? undefined : '100vh',
      height: isEditor ? '100vh' : undefined,
      overflow: isEditor ? 'hidden' : undefined,
      paddingBottom: isEditor ? 0 : 80,
    }}>
      {showDocs && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: '#0a0e17', zIndex: 10000, overflowY: 'auto', paddingBottom: 80,
        }}>
          <DocumentManager supabase={supabase} currentUser={currentUser} users={users}
            onClose={() => setShowDocs(false)} />
        </div>
      )}
      {showScan && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: '#0a0e17', zIndex: 10000, overflowY: 'auto', paddingBottom: 80,
        }}>
          <ScanDocument supabase={supabase} currentUser={currentUser} users={users}
            onClose={() => setShowScan(false)} activeInstances={[]} />
        </div>
      )}
      {renderView()}
      <FloatingChat supabase={supabase} currentUser={currentUser} users={users} activeView={appView} />
      <BottomNav role={userRole} activeTab={appView} onNav={navigateTo} onSignOut={signOut} />
    </div>
  );
}




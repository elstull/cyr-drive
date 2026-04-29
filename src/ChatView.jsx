import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlockRenderer } from './MermaidBlock';

// ═══════════════════════════════════════════════════════════════════════════
// CHAT VIEW — v1.1 (RC-001/003: chat history provisioning)
//
// v1.1 adds:
//   - Active conversation tracking (conversationId state)
//   - Conversation switcher: title + dropdown + "New" button between
//     the tab toggle and the messages area
//   - Auto-restore of most recent conversation on mount, so users return
//     to where they left off
//   - sendMessage now sends conversationId and captures the returned
//     conversation_id (so the server creates a thread on first message
//     and we track it from there)
//
// All v1 features preserved verbatim: voice input, markdown rendering,
// Mermaid graphics, Activity History tab, copy button, send-on-Enter.
// ═══════════════════════════════════════════════════════════════════════════

const DIM = '#8899aa';
const BLUE = '#4a90d9';
const GREEN = '#4ade80';
const RED = '#e03030';

// ── Helper: group conversations by recency for the picker ──
function groupByRecency(list) {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const c of list) {
    const d = new Date(c.last_message_at);
    if (d >= today) groups.today.push(c);
    else if (d >= yesterday) groups.yesterday.push(c);
    else if (d >= weekAgo) groups.thisWeek.push(c);
    else groups.older.push(c);
  }
  return groups;
}


export default function ChatView({ currentUser, users, supabase }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('chat');
  const [activityLog, setActivityLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [isListening, setIsListening] = useState(false);

  // ── RC-001/003: conversation state ──
  const [conversationId, setConversationId] = useState(null);
  const [conversationsList, setConversationsList] = useState([]);
  const [showConversations, setShowConversations] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const endRef = useRef(null);
  const recognitionRef = useRef(null);

  // ── Voice input setup ──
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev ? prev + ' ' + transcript : transcript);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.abort(); } catch {}
    };
  }, []);

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Voice start error:', e);
      }
    }
  };

  const hasVoice = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const handleCopy = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  const userName = users?.[currentUser]?.name?.split(' ')[0] || 'there';

  // ── Activity log loader (unchanged) ──
  const loadHistory = useCallback(async () => {
    if (!supabase) return;
    setLogLoading(true);
    try {
      const { data } = await supabase
        .from('activity_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(50);
      setActivityLog(data || []);
    } catch (e) { console.error('Log:', e); }
    setLogLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view, loadHistory]);

  // ── RC-001/003: load list of past conversations for this user ──
  const loadConversations = useCallback(async () => {
    if (!supabase || !currentUser) return [];
    setConversationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, message_count, last_message_at, created_at, status, pinned')
        .eq('owner_id', currentUser)
        .eq('status', 'active')
        .order('last_message_at', { ascending: false })
        .limit(50);
      if (error) { console.error('Load conversations error:', error); return []; }
      const list = data || [];
      setConversationsList(list);
      return list;
    } catch (e) {
      console.error('Load conversations exception:', e);
      return [];
    } finally {
      setConversationsLoading(false);
    }
  }, [supabase, currentUser]);

  // ── RC-001/003: load messages for a given conversation ──
  const loadMessages = useCallback(async (convId) => {
    if (!convId || !supabase) { setMessages([]); return; }
    try {
      const { data, error } = await supabase
        .from('assistant_conversations')
        .select('id, role, content, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (error) { console.error('Load messages error:', error); return; }
      const formatted = (data || []).map(m => ({
        role: m.role,
        content: m.content,
        time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      setMessages(formatted);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      console.error('Load messages exception:', e);
    }
  }, [supabase]);

  // ── RC-001/003: on mount, fetch the list and auto-restore most recent ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadConversations();
      if (cancelled) return;
      if (list.length > 0) {
        const mostRecent = list[0];
        setConversationId(mostRecent.id);
        await loadMessages(mostRecent.id);
      }
    })();
    return () => { cancelled = true; };
  }, [loadConversations, loadMessages]);

  // ── RC-001/003: start a fresh conversation ──
  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowConversations(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ── RC-001/003: switch to a different conversation ──
  const switchConversation = async (convId) => {
    if (convId === conversationId) {
      setShowConversations(false);
      return;
    }
    setConversationId(convId);
    setShowConversations(false);
    await loadMessages(convId);
  };

  const timeAgo = (d) => {
    if (!d) return '';
    const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    return Math.floor(mins / 1440) + 'd ago';
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    const msg = input.trim();
    setInput('');
    const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsg = { role: 'user', content: msg, time: time() };
    const history = [...messages, userMsg].slice(-12).map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', pending: true, time: time() }]);
    setLoading(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    const wantsPresentation = /\b(create|generate|make|build)\b.*\bpresentation\b/i.test(msg);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 && m.pending
            ? { role: 'assistant', content: 'Session expired, please sign in again.', time: time() }
            : m
        ));
        return;
      }
      const response = await fetch(wantsPresentation ? '/api/generate-presentation' : '/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: msg,
          history,
          userId: currentUser,
          userName: users?.[currentUser]?.name || currentUser,
          conversationId, // RC-001/003: server uses this to thread messages
        }),
      });

      if (wantsPresentation && response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/vnd') || contentType.includes('octet-stream')) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'presentation.pptx';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 && m.pending
              ? { role: 'assistant', content: 'Your presentation has been generated and downloaded.', time: time() }
              : m
          ));
          return;
        }
      }

      const data = await response.json();
      let reply = data?.reply || 'I had trouble connecting. Please try again.';

      // RC-001/003: capture the server-issued conversation_id
      if (data?.conversation_id && data.conversation_id !== conversationId) {
        setConversationId(data.conversation_id);
      }

      if (reply.includes('[PRESENTATION]')) {
        const presResponse = await fetch('/api/generate-presentation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ message: msg, context: reply, userId: currentUser, userName: users?.[currentUser]?.name || currentUser }),
        });
        if (presResponse.ok) {
          const contentType = presResponse.headers.get('content-type') || '';
          if (contentType.includes('application/vnd') || contentType.includes('octet-stream')) {
            const blob = await presResponse.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'presentation.pptx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            reply = reply.replace('[PRESENTATION]', '').trim() + '\n\nYour presentation has been downloaded.';
          }
        }
      }

      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.pending
          ? { role: 'assistant', content: reply, time: time() }
          : m
      ));

      // RC-001/003: refresh conversations list so the picker shows the
      // newly-created (or newly-updated) thread without a manual reload
      loadConversations();
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 && m.pending
          ? { role: 'assistant', content: 'I had trouble reaching the server. Check your connection and try again.', time: time() }
          : m
      ));
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // RC-001/003: derived view state for the conversation picker
  const activeConversation = conversationsList.find(c => c.id === conversationId);
  const activeTitle = activeConversation?.title || (conversationId ? '...' : 'New conversation');
  const groups = groupByRecency(conversationsList);

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px' }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
          Chat
        </div>
        <div style={{ fontSize: 12, color: DIM }}>
          Ask FSM Drive anything about your business
        </div>
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setView('chat')} style={{
          flex: 1, padding: '10px', textAlign: 'center', borderRadius: 8,
          background: view === 'chat' ? '#111827' : 'transparent',
          border: '1px solid ' + (view === 'chat' ? BLUE : '#1e293b'),
          color: view === 'chat' ? BLUE : DIM, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}>{'\uD83D\uDCAC'} Conversation</button>
        <button onClick={() => setView('history')} style={{
          flex: 1, padding: '10px', textAlign: 'center', borderRadius: 8,
          background: view === 'history' ? '#111827' : 'transparent',
          border: '1px solid ' + (view === 'history' ? BLUE : '#1e293b'),
          color: view === 'history' ? BLUE : DIM, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          WebkitTapHighlightColor: 'transparent',
        }}>{'\uD83D\uDCCB'} Activity History</button>
      </div>

      {/* ── CONVERSATION VIEW ── */}
      {view === 'chat' && (
        <>
          {/* RC-001/003: conversation switcher */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#0a0e17', border: '1px solid #1e293b',
              borderRadius: 8, padding: '6px 10px',
            }}>
              <button
                onClick={() => setShowConversations(s => !s)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: 0, color: '#e2e8f0', fontSize: 12, fontWeight: 600,
                  fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}
                title={showConversations ? 'Hide conversations' : 'Show past conversations'}
              >
                <span style={{ fontSize: 12, color: DIM, flexShrink: 0 }}>{'\uD83D\uDD52'}</span>
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: conversationId ? '#e2e8f0' : DIM,
                }}>
                  {activeTitle}
                </span>
                <span style={{ fontSize: 10, color: DIM, flexShrink: 0 }}>
                  {showConversations ? '\u25B2' : '\u25BC'}
                </span>
              </button>
              <button
                onClick={newConversation}
                style={{
                  background: BLUE + '22', border: '1px solid ' + BLUE + '66',
                  borderRadius: 4, padding: '3px 10px', color: BLUE,
                  fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}
                title="Start a new conversation"
              >
                + New
              </button>
            </div>

            {/* Expanded list of past conversations */}
            {showConversations && (
              <div style={{
                marginTop: 6, background: '#0a0e17', border: '1px solid #1e293b',
                borderRadius: 8, padding: '8px 4px', maxHeight: 300, overflowY: 'auto',
              }}>
                {conversationsLoading && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: DIM }}>Loading...</div>
                )}
                {!conversationsLoading && conversationsList.length === 0 && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                    No past conversations yet. Send a message to start one.
                  </div>
                )}
                {!conversationsLoading && [
                  ['Today', groups.today],
                  ['Yesterday', groups.yesterday],
                  ['This week', groups.thisWeek],
                  ['Earlier', groups.older],
                ].map(([label, list]) => (
                  list.length > 0 && (
                    <div key={label}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                        color: DIM, padding: '6px 12px 2px', textTransform: 'uppercase',
                      }}>{label}</div>
                      {list.map(c => (
                        <button
                          key={c.id}
                          onClick={() => switchConversation(c.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            width: '100%', padding: '6px 12px',
                            background: c.id === conversationId ? BLUE + '15' : 'transparent',
                            border: 'none', borderRadius: 4, cursor: 'pointer',
                            color: c.id === conversationId ? BLUE : '#c8d4e0',
                            fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <span style={{ fontSize: 9, color: DIM, flexShrink: 0, width: 18 }}>
                            {c.id === conversationId ? '\u2713' : ''}
                          </span>
                          <span style={{
                            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontWeight: c.id === conversationId ? 600 : 400,
                          }}>{c.title}</span>
                          <span style={{ fontSize: 9, color: DIM, flexShrink: 0 }}>
                            {timeAgo(c.last_message_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Messages */}
          <div style={{
            background: '#111827', border: '1px solid #3a4a5e', borderRadius: 12,
            padding: '12px', minHeight: 300, maxHeight: 'calc(100vh - 380px)',
            overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
            marginBottom: 12,
          }}>
            {messages.length === 0 && (
              <div style={{ color: DIM, fontSize: 13, textAlign: 'center', padding: '40px 16px', lineHeight: 1.8 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{'\uD83D\uDCAC'}</div>
                Hi {userName}, I am FSM Drive.
                <br />Ask me anything about your business.
                <br /><span style={{ fontSize: 11, color: '#445566' }}>Try: "What needs my attention?" or "How are shipments doing?"</span>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '85%', padding: '10px 14px', borderRadius: 14,
                  background: m.role === 'user' ? BLUE + '22' : '#0a0e17',
                  border: '1px solid ' + (m.role === 'user' ? BLUE + '88' : '#3a4a5e'),
                  color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
                }}>
                  {m.role === 'assistant' ? (
                    m.pending ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: BLUE, fontSize: 12 }}>
                        <span style={{ animation: 'pulse 1s infinite' }}>{'\u25CF'}</span> Thinking...
                      </div>
                    ) : (
                      <div className="chat-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlockRenderer }}>{m.content}</ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <div>{m.content}</div>
                  )}
                  {!m.pending && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: 8, marginTop: 6,
                    }}>
                      <span style={{ fontSize: 9, color: DIM }}>{m.time}</span>
                      {m.role === 'assistant' && (
                        <button
                          onClick={() => handleCopy(m.content, i)}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: copiedIndex === i ? GREEN : DIM, fontSize: 10,
                            padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          {copiedIndex === i ? '\u2713 Copied!' : '\uD83D\uDCCB Copy'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Input with voice button */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: '#111827', border: '1px solid #3a4a5e', borderRadius: 12,
            padding: '10px 14px',
          }}>
            <textarea
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              placeholder={isListening ? 'Listening...' : 'Type your message...'}
              style={{
                flex: 1, background: 'transparent', border: 'none', color: '#e2e8f0',
                fontSize: 16, fontFamily: 'inherit', outline: 'none',
                resize: 'none', overflowY: 'auto', overflowX: 'hidden', maxHeight: 120, minHeight: 40,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                lineHeight: '1.4', padding: 0,
                WebkitAppearance: 'none',
              }}
            />
            {hasVoice && (
              <button onClick={toggleVoice} title={isListening ? 'Stop listening' : 'Voice input'} style={{
                width: 38, height: 38, borderRadius: '50%',
                background: isListening ? RED : 'transparent',
                border: '1px solid ' + (isListening ? RED : '#3a4a5e'),
                color: isListening ? '#fff' : DIM, fontSize: 16,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontFamily: 'inherit',
                animation: isListening ? 'pulse 1s infinite' : 'none',
                WebkitTapHighlightColor: 'transparent',
              }}>{'\uD83C\uDF99'}</button>
            )}
            <button onClick={sendMessage} disabled={!input.trim()} style={{
              background: input.trim() ? BLUE : '#1e293b',
              border: 'none', borderRadius: 8, padding: '10px 16px',
              color: input.trim() ? '#fff' : DIM, fontSize: 14, fontWeight: 600,
              cursor: input.trim() ? 'pointer' : 'default', fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}>{'\u2191'}</button>
          </div>
        </>
      )}

      {/* ── ACTIVITY HISTORY VIEW ── */}
      {view === 'history' && (
        <>
          {logLoading && (
            <div style={{ textAlign: 'center', padding: '20px', color: BLUE, fontSize: 13 }}>Loading history...</div>
          )}
          {!logLoading && activityLog.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: DIM, fontSize: 13 }}>
              No activity recorded yet. Run the demo to see activity here.
            </div>
          )}
          {activityLog.map((a, i) => (
            <div key={i} style={{
              background: '#111827', border: '1px solid #1e293b', borderRadius: 10,
              padding: '12px 14px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                    {a.user_name || a.user_id}
                  </span>
                </div>
                <span style={{ fontSize: 10, color: DIM }}>{timeAgo(a.occurred_at)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#c8d4e0', fontWeight: 600, marginBottom: 4 }}>{a.title}</div>
              {a.detail && <div style={{ fontSize: 12, color: '#8899aa', lineHeight: 1.5 }}>{a.detail}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {a.action_type && (
                  <span style={{ fontSize: 10, color: DIM, background: '#0a0e17', border: '1px solid #1e293b',
                    padding: '2px 8px', borderRadius: 4 }}>{a.action_type}</span>
                )}
                {a.entity_id && (
                  <span style={{ fontSize: 10, color: BLUE, background: BLUE + '12', border: '1px solid ' + BLUE + '33',
                    padding: '2px 8px', borderRadius: 4 }}>{a.entity_id}</span>
                )}
                {a.division && (
                  <span style={{ fontSize: 10, color: DIM, background: '#0a0e17', border: '1px solid #1e293b',
                    padding: '2px 8px', borderRadius: 4 }}>{a.division}</span>
                )}
              </div>
            </div>
          ))}
          {!logLoading && activityLog.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button onClick={loadHistory} style={{
                background: 'none', border: '1px solid #2a3a4e', borderRadius: 8,
                color: '#8899aa', fontSize: 11, padding: '8px 20px', cursor: 'pointer',
                fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
              }}>Refresh</button>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .chat-md p { margin: 0 0 8px 0; }
        .chat-md p:last-child { margin-bottom: 0; }
        .chat-md h1 { font-size: 16px; font-weight: 700; margin: 8px 0 6px; color: #fff; }
        .chat-md h2 { font-size: 14px; font-weight: 700; margin: 8px 0 6px; color: #fff; }
        .chat-md h3 { font-size: 13px; font-weight: 700; margin: 6px 0 4px; color: #fff; }
        .chat-md strong { color: #fff; font-weight: 700; }
        .chat-md ul, .chat-md ol { margin: 4px 0 8px 0; padding-left: 20px; }
        .chat-md li { margin: 2px 0; }
        .chat-md code { background: #1e293b; color: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 12px; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; }
        .chat-md pre { background: #050810; border: 1px solid #2a3a4e; border-radius: 6px; padding: 10px; overflow-x: auto; margin: 6px 0; }
        .chat-md pre code { background: transparent; padding: 0; font-size: 11px; color: #e2e8f0; }
        .chat-md table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }
        .chat-md th, .chat-md td { border: 1px solid #3a4a5e; padding: 6px 10px; text-align: left; }
        .chat-md th { background: #1a2332; font-weight: 700; color: #fff; }
        .chat-md a { color: #4a90d9; text-decoration: underline; }
        .chat-md blockquote { border-left: 3px solid #4a90d9; padding-left: 10px; margin: 6px 0; color: #c8d4e0; }
      `}</style>
    </div>
  );
}
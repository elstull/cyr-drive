import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// ═══════════════════════════════════════════════════════════════════════════
// MERMAID DIAGRAM RENDERER
//
// Renders Mermaid diagram markup inline in Chat responses.
// Used as a custom code block renderer in ReactMarkdown.
//
// Supported diagram types for FSM Drive:
//   - stateDiagram-v2  → FSM workflows, Response FSMs
//   - flowchart        → Process flows, handoff points
//   - sequenceDiagram  → Inter-user communication, notification pipeline
//   - timeline         → Advisory status, escalation history
//   - pie              → Distribution charts (Living P&L)
//   - gantt            → Project timelines, implementation sequences
//
// ═══════════════════════════════════════════════════════════════════════════

// Initialize Mermaid with FSM Drive theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    // Colors matching FSM Drive dark theme
    primaryColor: '#1e3a5f',
    primaryTextColor: '#e0e8f0',
    primaryBorderColor: '#4a90d9',
    secondaryColor: '#2a2a3e',
    secondaryTextColor: '#c0c8d0',
    secondaryBorderColor: '#6b7280',
    tertiaryColor: '#1a2a1a',
    tertiaryTextColor: '#a0d0a0',
    tertiaryBorderColor: '#4ade80',
    // Background
    background: '#0f1419',
    mainBkg: '#1e293b',
    nodeBorder: '#4a90d9',
    // Text
    textColor: '#e0e8f0',
    titleColor: '#e0e8f0',
    // Lines and arrows
    lineColor: '#6b7280',
    // State diagrams
    labelColor: '#e0e8f0',
    altBackground: '#1e293b',
    // Notes
    noteBkgColor: '#2a2a3e',
    noteTextColor: '#c0c8d0',
    noteBorderColor: '#4a90d9',
    stateBorder: '#4a90d9',
    stateBkg: '#1e293b',
    nodeSpacing: 30,
    rankSpacing: 30,
  },
  flowchart: { curve: 'basis', padding: 20 },
  sequence: { actorMargin: 50, mirrorActors: false },
  state: {
    padding: 8,
    dividerColor: '#1e293b',
  },
  themeCSS: '.state-note { display: none; } .divider { stroke: #1e293b; } .cluster rect { rx: 8; }',
  fontFamily: 'Arial, sans-serif',
  fontSize: 14,
  securityLevel: 'strict',
});

let diagramCounter = 0;

export default function MermaidBlock({ code }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const idRef = useRef(`mermaid-${Date.now()}-${diagramCounter++}`);

  useEffect(() => {
    if (!code || !containerRef.current) return;

    const renderDiagram = async () => {
      try {
        // Validate first
        const isValid = await mermaid.parse(code);
        if (isValid !== undefined && !isValid) {
          setError('Invalid diagram syntax');
          return;
        }

        // Render
        const { svg: renderedSvg } = await mermaid.render(idRef.current, code);
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        console.warn('Mermaid render error:', err);
        setError(err.message || 'Failed to render diagram');
      }
    };

    renderDiagram();
  }, [code]);

  if (error) {
    return (
      <div style={{
        background: '#1e293b',
        border: '1px solid #e0303044',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '8px 0',
        fontSize: 12,
        color: '#f08080',
        fontFamily: 'monospace',
      }}>
        <div style={{ marginBottom: 4, fontWeight: 'bold' }}>Diagram rendering error</div>
        <div style={{ color: '#8899aa' }}>{error}</div>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: '#4a90d9', fontSize: 11 }}>Show source</summary>
          <pre style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: '#8899aa', fontSize: 11 }}>{code}</pre>
        </details>
      </div>
    );
  }

  return (
    <div style={{
      background: '#0f1419',
      border: '1px solid #4a90d922',
      borderRadius: 8,
      margin: '12px 0',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: '#1e293b',
          borderBottom: expanded ? '1px solid #4a90d922' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, color: '#4a90d9', fontWeight: 600 }}>
          📊 Diagram
        </span>
        <span style={{ fontSize: 10, color: '#6b7280' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Diagram container */}
      {expanded && (
        <div
          ref={containerRef}
          style={{
            padding: '16px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 100,
            overflow: 'auto',
          }}
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        >
          {!svg && (
            <div style={{ color: '#6b7280', fontSize: 12 }}>
              Rendering diagram...
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM CODE RENDERER FOR REACTMARKDOWN
//
// Drop this into ReactMarkdown's components prop to automatically
// render mermaid code blocks as diagrams and all other code normally.
//
// Usage in ChatView:
//   <ReactMarkdown
//     remarkPlugins={[remarkGfm]}
//     components={{ code: CodeBlockRenderer }}
//   >
//     {message.content}
//   </ReactMarkdown>
//
// ═══════════════════════════════════════════════════════════════════════════

export function CodeBlockRenderer({ node, inline, className, children, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  // Mermaid diagrams
  if (!inline && language === 'mermaid') {
    const code = String(children).replace(/\n$/, '');
    return <MermaidBlock code={code} />;
  }

  // Regular code blocks
  if (!inline && language) {
    return (
      <pre style={{
        background: '#1e293b',
        border: '1px solid #4a90d922',
        borderRadius: 6,
        padding: '10px 14px',
        margin: '8px 0',
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
      }}>
        <code className={className} {...props} style={{ color: '#e0e8f0', fontFamily: 'monospace' }}>
          {children}
        </code>
      </pre>
    );
  }

  // Inline code
  return (
    <code
      style={{
        background: '#1e293b',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: '0.9em',
        color: '#4ade80',
        fontFamily: 'monospace',
      }}
      {...props}
    >
      {children}
    </code>
  );
}

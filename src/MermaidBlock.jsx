import { useEffect, useRef, useState, Component } from 'react';
import mermaid from 'mermaid';
import GraphicViewer from './components/GraphicViewer.jsx';

// ─────────────────────────────────────────────────────────────────────
// MERMAID DIAGRAM RENDERER — v2.2
// v2.2: mindmap branches now colorize by section. Mermaid's default
//       mindmap rendering picks all branch backgrounds from one color
//       (primaryColor) which made every node identical dark navy.
//       Two complementary fixes:
//         1. cScale0..cScale11 theme variables — Mermaid's documented
//            palette that mindmaps consume by branch index
//         2. .section-N CSS overrides in themeCSS — practical fallback
//            because mindmap coloring via theme variables is inconsistent
//            across Mermaid versions (see GitHub mermaid-js#5156)
//       Whichever path the renderer honors takes effect.
// v2.1: Fix React error #60 — cannot have both dangerouslySetInnerHTML
//       and children on the same element.
// ─────────────────────────────────────────────────────────────────────

let mermaidInitialized = false;
function ensureMermaidInit() {
  if (mermaidInitialized) return;
  try {
    // Branch-color palette — re-used for both cScale theme variables and
    // .section-N CSS overrides. Eight distinct hues; sections 8..11 cycle
    // back through the first four for very wide mindmaps.
    const branchPalette = [
      '#4a90d9', // blue
      '#4ade80', // green
      '#f59e0b', // amber
      '#8b5cf6', // purple
      '#ef4444', // red
      '#14b8a6', // teal
      '#ec4899', // pink
      '#6366f1', // indigo
      '#f97316', // orange
      '#06b6d4', // cyan
      '#a855f7', // violet
      '#22c55e', // bright green
    ];

    // Build cScale0..cScale11 theme variables from the palette.
    const cScale = {};
    branchPalette.forEach((color, i) => {
      cScale[`cScale${i}`] = color;
      cScale[`cScalePeer${i}`] = color;       // border/peer color
      cScale[`cScaleLabel${i}`] = '#ffffff';  // text on colored background
    });

    // Build .section-N CSS overrides. Mermaid renders each top-level
    // mindmap branch with class `section-N` (and -1 for root); children
    // inherit the parent's section number. Targeting rect/circle/path
    // covers all node shapes mindmap may use.
    let sectionCSS = '';
    branchPalette.forEach((color, i) => {
      sectionCSS += `
        .mindmap-node.section-${i} > rect,
        .mindmap-node.section-${i} > circle,
        .mindmap-node.section-${i} > path,
        .section-${i} .node-bkg { fill: ${color} !important; stroke: ${color} !important; }
        .mindmap-node.section-${i} .node-label,
        .section-${i} text { fill: #ffffff !important; }
        .edge.section-${i} > path { stroke: ${color} !important; }
      `;
    });
    // Root node (section -1) gets a distinct treatment so it stands apart.
    sectionCSS += `
      .mindmap-node.section--1 > rect,
      .mindmap-node.section--1 > circle,
      .mindmap-node.section--1 > path,
      .section-root .node-bkg { fill: #1e293b !important; stroke: #4a90d9 !important; stroke-width: 2px !important; }
      .mindmap-node.section--1 .node-label,
      .section-root text { fill: #e0e8f0 !important; font-weight: 600 !important; }
    `;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor: '#1e3a5f',
        primaryTextColor: '#e0e8f0',
        primaryBorderColor: '#4a90d9',
        secondaryColor: '#2a2a3e',
        secondaryTextColor: '#c0c8d0',
        secondaryBorderColor: '#6b7280',
        tertiaryColor: '#1a2a1a',
        tertiaryTextColor: '#a0d0a0',
        tertiaryBorderColor: '#4ade80',
        background: '#0f1419',
        mainBkg: '#1e293b',
        nodeBorder: '#4a90d9',
        textColor: '#e0e8f0',
        titleColor: '#e0e8f0',
        lineColor: '#6b7280',
        labelColor: '#e0e8f0',
        altBackground: '#1e293b',
        noteBkgColor: '#2a2a3e',
        noteTextColor: '#c0c8d0',
        noteBorderColor: '#4a90d9',
        // Pie chart palette (unchanged)
        pie1: '#4a90d9',
        pie2: '#4ade80',
        pie3: '#f59e0b',
        pie4: '#8b5cf6',
        pie5: '#ef4444',
        pie6: '#14b8a6',
        pie7: '#ec4899',
        pie8: '#6366f1',
        pieStrokeColor: '#1e293b',
        pieStrokeWidth: '2px',
        pieTitleTextSize: '16px',
        pieTitleTextColor: '#e0e8f0',
        pieSectionTextSize: '12px',
        pieSectionTextColor: '#e0e8f0',
        pieLegendTextSize: '12px',
        pieLegendTextColor: '#e0e8f0',
        pieOpacity: '0.9',
        // Mindmap branch palette (NEW in v2.2)
        ...cScale,
      },
      flowchart: { curve: 'basis', padding: 20 },
      sequence: { actorMargin: 50, mirrorActors: false },
      fontFamily: 'Arial, sans-serif',
      fontSize: 14,
      securityLevel: 'loose',
      themeCSS: `
        .statediagram-cluster rect { fill: transparent !important; stroke: transparent !important; }
        .statediagram-cluster line { stroke: transparent !important; }
        .divider { stroke: transparent !important; }
        .cluster rect { fill: transparent !important; stroke: transparent !important; }
        .nodeLabel { color: #e0e8f0 !important; }
        rect.basic { rx: 6 !important; }
        .pieCircle { stroke: #1e293b !important; stroke-width: 2px !important; }
        .pieTitleText { fill: #e0e8f0 !important; font-size: 16px !important; }
        .slice { stroke: #1e293b !important; }
        .legend text { fill: #e0e8f0 !important; }
        ${sectionCSS}
      `,
    });
    mermaidInitialized = true;
  } catch (e) {
    console.warn('Mermaid init error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────────
class DiagramErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('Mermaid diagram error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          background: '#1e293b',
          border: '1px solid #4a90d922',
          borderRadius: 8,
          padding: '12px 16px',
          margin: '8px 0',
          fontSize: 12,
        }}>
          <div style={{ color: '#f59e0b', marginBottom: 4, fontWeight: 'bold' }}>
            Diagram could not be rendered
          </div>
          <div style={{ color: '#6b7280' }}>
            {this.state.error?.message || 'Unknown rendering error'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────
// MERMAID BLOCK
// ─────────────────────────────────────────────────────────────────────
function MermaidBlockInner({ code }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;

    ensureMermaidInit();

    const renderDiagram = async () => {
      try {
        const cleanCode = code.trim();
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, cleanCode);
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        console.warn('Mermaid render error:', err);
        setError(err.message || 'Failed to render diagram');
        setSvg('');
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

  if (!svg) {
    return (
      <div style={{ padding: 16, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
        Rendering diagram...
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function MermaidBlock({ code }) {
  return (
    <DiagramErrorBoundary>
      <GraphicViewer>
        <MermaidBlockInner code={code} />
      </GraphicViewer>
    </DiagramErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CUSTOM CODE RENDERER FOR REACTMARKDOWN
// ─────────────────────────────────────────────────────────────────────
export function CodeBlockRenderer({ node, inline, className, children, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  if (!inline && language === 'mermaid') {
    const code = String(children).replace(/\n$/, '');
    return (
      <DiagramErrorBoundary>
        <GraphicViewer>
          <MermaidBlockInner code={code} />
        </GraphicViewer>
      </DiagramErrorBoundary>
    );
  }

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
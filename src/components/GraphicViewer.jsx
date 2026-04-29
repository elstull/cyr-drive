import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  Sun,
  Moon,
  Move,
  Square,
  ScanSearch,
  Maximize,
  Expand,
} from "lucide-react";

/**
 * GraphicViewer v3.1
 *
 * v3.1 fix: the in-chat placeholder is now a single-line breadcrumb
 *   (~32px tall) instead of a stacked broken-Tailwind header + 120px
 *   light-blue panel. Cause was Tailwind layout classes on the
 *   InlineBlock header (`flex items-center justify-between ...`) that
 *   never applied at runtime (no Tailwind config in this project), so
 *   the title and Detach/Return button stacked vertically rather than
 *   laying out as a horizontal bar. Both attached and detached inline
 *   states now use inline styles consistently, matching the
 *   DetachedWindow chrome treatment from earlier iterations.
 *
 * v3 features preserved verbatim: detachable Mermaid/SVG/Three.js viewer
 * with drag, resize, marquee zoom, wheel zoom, fit-to-window, dark-mode
 * toggle, maximize, keyboard shortcuts, and 3D canvas auto-detect.
 *
 * Usage:
 *   <GraphicViewer title="Export Order FSM">
 *     <svg>...</svg>
 *   </GraphicViewer>
 */
export default function GraphicViewer({ children, title = "Graphic" }) {
  // ---------------- State ----------------
  const [detached, setDetached] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [bgDark, setBgDark] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: 120, y: 80 });
  const [size, setSize] = useState({ width: 900, height: 680 });
  const [intrinsic, setIntrinsic] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [is3D, setIs3D] = useState(false);

  // ---------------- Refs ----------------
  const windowRef = useRef(null);
  const contentAreaRef = useRef(null);
  const contentInnerRef = useRef(null);
  const chromeTimerRef = useRef(null);

  // ---------------- 3D detection ----------------
  useLayoutEffect(() => {
    if (!contentInnerRef.current) return;
    const canvas = contentInnerRef.current.querySelector("canvas");
    setIs3D(!!canvas);
  }, [children, detached]);

  // ---------------- Intrinsic size measurement ----------------
  useLayoutEffect(() => {
    if (!contentInnerRef.current || !detached) return;
    const firstChild = contentInnerRef.current.firstElementChild;
    if (firstChild) {
      if (firstChild.tagName === "svg") {
        const vb = firstChild.viewBox?.baseVal;
        if (vb && vb.width && vb.height) {
          setIntrinsic({ width: vb.width, height: vb.height });
          return;
        }
      }
      const rect = firstChild.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setIntrinsic({
          width: rect.width / zoom,
          height: rect.height / zoom,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detached, children]);

  // ---------------- Chrome auto-hide ----------------
  const bumpChromeVisibility = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (!detached) {
      setChromeVisible(true);
      return;
    }
    bumpChromeVisibility();
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [detached, bumpChromeVisibility]);

  // ---------------- Keyboard shortcuts (while detached) ----------------
  useEffect(() => {
    if (!detached) return;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        setDetached(false);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(10, z * 1.25));
        e.preventDefault();
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(0.1, z / 1.25));
        e.preventDefault();
      } else if (e.key === "0") {
        fitToWindow();
        e.preventDefault();
      } else if (e.key === "1") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        setMaximized((m) => !m);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        setPan((p) => ({ ...p, x: p.x + 40 }));
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setPan((p) => ({ ...p, x: p.x - 40 }));
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        setPan((p) => ({ ...p, y: p.y + 40 }));
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        setPan((p) => ({ ...p, y: p.y - 40 }));
        e.preventDefault();
      }
      bumpChromeVisibility();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detached, intrinsic, size]);

  // ---------------- Fit-to-window ----------------
  const fitToWindow = useCallback(() => {
    if (!contentAreaRef.current || !intrinsic.width || !intrinsic.height) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const area = contentAreaRef.current.getBoundingClientRect();
    const availableW = area.width - 40;
    const availableH = area.height - 40;
    const zx = availableW / intrinsic.width;
    const zy = availableH / intrinsic.height;
    const newZoom = Math.max(0.1, Math.min(10, Math.min(zx, zy)));
    setZoom(newZoom);
    setPan({ x: 0, y: 0 });
  }, [intrinsic]);

  // ---------------- Title-bar drag (move window) ----------------
  const startWindowDrag = useCallback(
    (e) => {
      if (maximized) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = { ...pos };
      const onMove = (ev) => {
        setPos({
          x: Math.max(0, startPos.x + (ev.clientX - startX)),
          y: Math.max(0, startPos.y + (ev.clientY - startY)),
        });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [pos, maximized]
  );

  // ---------------- Resize grip ----------------
  const startResize = useCallback(
    (e, edge = 'corner') => {
      if (maximized) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = { ...size };
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const maxW = window.innerWidth;
        const maxH = window.innerHeight;
        setSize({
          width: edge === 'bottom'
            ? startSize.width
            : Math.max(300, Math.min(maxW, startSize.width + dx)),
          height: edge === 'right'
            ? startSize.height
            : Math.max(240, Math.min(maxH, startSize.height + dy)),
        });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [size, maximized]
  );

  // ---------------- Content-area pan (2D only) ----------------
  const startContentDrag = useCallback(
    (e) => {
      if (is3D) return;
      if (e.shiftKey) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPan = { ...pan };
      const onMove = (ev) => {
        setPan({
          x: startPan.x + (ev.clientX - startX),
          y: startPan.y + (ev.clientY - startY),
        });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [pan, is3D]
  );

  // ---------------- Marquee zoom (2D only) ----------------
  const startMarquee = useCallback(
    (e) => {
      if (is3D) return;
      if (!e.shiftKey) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const areaRect = contentAreaRef.current.getBoundingClientRect();
      const startX = e.clientX - areaRect.left;
      const startY = e.clientY - areaRect.top;
      setMarquee({ startX, startY, currentX: startX, currentY: startY });
      const onMove = (ev) => {
        const currentX = ev.clientX - areaRect.left;
        const currentY = ev.clientY - areaRect.top;
        setMarquee({ startX, startY, currentX, currentY });
      };
      const onUp = (ev) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const endX = ev.clientX - areaRect.left;
        const endY = ev.clientY - areaRect.top;
        const rx = Math.min(startX, endX);
        const ry = Math.min(startY, endY);
        const rw = Math.abs(endX - startX);
        const rh = Math.abs(endY - startY);
        setMarquee(null);
        if (rw < 20 || rh < 20) return;
        const newZoomX = areaRect.width / rw;
        const newZoomY = areaRect.height / rh;
        const zoomFactor = Math.min(newZoomX, newZoomY);
        const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));
        const marqueeCenterX = rx + rw / 2;
        const marqueeCenterY = ry + rh / 2;
        const areaCenterX = areaRect.width / 2;
        const areaCenterY = areaRect.height / 2;
        const panDeltaX = areaCenterX - marqueeCenterX;
        const panDeltaY = areaCenterY - marqueeCenterY;
        setZoom(newZoom);
        setPan((p) => ({
          x: (p.x + panDeltaX) * zoomFactor,
          y: (p.y + panDeltaY) * zoomFactor,
        }));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [is3D, zoom]
  );

  // ---------------- Wheel zoom ----------------
  const handleWheel = useCallback(
    (e) => {
      if (!e.ctrlKey) return;
      if (is3D) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => Math.max(0.1, Math.min(10, z * factor)));
    },
    [is3D]
  );

  // ---------------- Reset view ----------------
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ---------------- Detached window geometry ----------------
  const windowChrome = {
    background: bgDark ? "#1a1a2e" : "white",
    border: bgDark ? "1px solid #444" : "1px solid #666",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  const windowStyle = maximized
    ? {
        position: "fixed",
        left: 16,
        top: 16,
        width: "calc(100vw - 32px)",
        height: "calc(100vh - 32px)",
        zIndex: 1000,
        ...windowChrome,
      }
    : {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex: 1000,
        ...windowChrome,
      };

  // ─────────────────────────────────────────────────────────────────────
  // INLINE BLOCK (v3.1 — fully inline-styled, no Tailwind dependence)
  //
  //   Detached state: single-line breadcrumb (~32px) with Return inline
  //   Attached state: thin header (~32px) with Detach inline + content
  // ─────────────────────────────────────────────────────────────────────
  const InlineBlock = (
    <div style={{
      margin: '12px 0',
      borderRadius: 8,
      overflow: 'hidden',
      background: detached ? 'transparent' : 'rgba(15, 20, 25, 0.4)',
      border: detached ? 'none' : '1px solid rgba(74, 144, 217, 0.15)',
    }}>
      {detached ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px',
          background: 'rgba(74, 144, 217, 0.08)',
          border: '1px dashed rgba(74, 144, 217, 0.4)',
          borderRadius: 6,
          fontSize: 12,
          color: '#8899aa',
          fontStyle: 'italic',
        }}>
          <span style={{ fontSize: 14, fontStyle: 'normal' }}>{'\u2197'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {title} is in a floating window. Press Esc or click Return to bring it back.
          </span>
          <button
            type="button"
            onClick={() => setDetached(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(74, 144, 217, 0.15)',
              border: '1px solid rgba(74, 144, 217, 0.4)',
              borderRadius: 4,
              padding: '3px 10px',
              color: '#4a90d9',
              fontSize: 11,
              fontFamily: 'inherit',
              fontWeight: 600,
              fontStyle: 'normal',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            title="Return graphic to Chat (Esc)"
          >
            <RotateCcw size={11} />
            Return
          </button>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            borderBottom: '1px solid rgba(74, 144, 217, 0.15)',
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#e0e8f0',
              letterSpacing: '0.02em',
            }}>
              {title}
            </span>
            <button
              type="button"
              onClick={() => {
                const defaultW = Math.min(900, window.innerWidth * 0.8);
                const defaultH = Math.min(600, window.innerHeight * 0.8);
                setSize({ width: defaultW, height: defaultH });
                setDetached(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(74, 144, 217, 0.15)',
                border: '1px solid rgba(74, 144, 217, 0.4)',
                borderRadius: 4,
                padding: '3px 10px',
                color: '#4a90d9',
                fontSize: 11,
                fontFamily: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Open in detachable viewer"
            >
              <Expand size={11} />
              Detach
            </button>
          </div>
          <div ref={contentInnerRef} style={{ padding: 12, overflow: 'auto' }}>
            {children}
          </div>
        </>
      )}
    </div>
  );

  // ---------------- Detached window ----------------
  const DetachedWindow = detached ? (
    <div
      ref={windowRef}
      style={windowStyle}
      className="gv-detached"
      tabIndex={0}
      onMouseMove={bumpChromeVisibility}
    >
      {/* Title bar */}
      <div
        onMouseDown={startWindowDrag}
        onDoubleClick={() => setMaximized((m) => !m)}
        style={{
          cursor: maximized ? "default" : "move",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: bgDark ? "#2a2a3e" : "#f5f5f5",
          color: bgDark ? "#e0e0e0" : "#333333",
          borderBottom: bgDark ? "1px solid #3a3a4e" : "1px solid #e5e7eb",
          flexShrink: 0,
          opacity: chromeVisible ? 1 : 0.3,
          transition: "opacity 0.2s",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!maximized && <Move size={14} style={{ color: '#9ca3af' }} />}
          <span style={{
            userSelect: 'none',
            fontSize: 13,
            fontWeight: 600,
            color: bgDark ? '#e0e0e0' : '#374151',
          }}>
            {title}
          </span>
          {is3D && (
            <span style={{
              marginLeft: 8,
              borderRadius: 4,
              background: bgDark ? 'rgba(139, 92, 246, 0.3)' : '#ede9fe',
              padding: '2px 6px',
              fontSize: 10,
              fontWeight: 600,
              color: bgDark ? '#c4b5fd' : '#6d28d9',
            }}>
              3D
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {!is3D && (
            <>
              <ToolbarButton
                onClick={() => setZoom((z) => Math.min(10, z * 1.25))}
                title="Zoom in (+)"
              >
                <ZoomIn size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
                title="Zoom out (-)"
              >
                <ZoomOut size={14} />
              </ToolbarButton>
              <ToolbarButton onClick={fitToWindow} title="Fit to window (0)">
                <ScanSearch size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                title="Actual size (1)"
              >
                <Square size={14} />
              </ToolbarButton>
            </>
          )}
          <ToolbarButton
            onClick={() => setBgDark((b) => !b)}
            title={bgDark ? "Light background" : "Dark background"}
          >
            {bgDark ? <Sun size={14} /> : <Moon size={14} />}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setMaximized((m) => !m)}
            title={
              maximized ? "Restore window (Ctrl+M)" : "Maximize (Ctrl+M)"
            }
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize size={14} />}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              resetView();
              if (maximized) setMaximized(false);
            }}
            title="Reset view"
          >
            <RotateCcw size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setDetached(false)}
            title="Return graphic to Chat (Esc)"
          >
            <X size={14} />
          </ToolbarButton>
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentAreaRef}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if (e.shiftKey) {
            startMarquee(e);
          } else {
            startContentDrag(e);
          }
        }}
        style={{
          cursor: is3D ? "default" : marquee ? "crosshair" : "grab",
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: bgDark ? "#1a1a2e" : "#ffffff",
        }}
      >
        <div
          ref={contentInnerRef}
          className="gv-content-inner"
          style={{
            position: "absolute",
            inset: 0,
            transform: is3D
              ? undefined
              : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {children}
        </div>

        {/* Marquee rectangle */}
        {marquee && (
          <div
            style={{
              position: "absolute",
              left: Math.min(marquee.startX, marquee.currentX),
              top: Math.min(marquee.startY, marquee.currentY),
              width: Math.abs(marquee.currentX - marquee.startX),
              height: Math.abs(marquee.currentY - marquee.startY),
              border: "2px dashed rgba(59, 130, 246, 0.8)",
              background: "rgba(59, 130, 246, 0.1)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          borderTop: bgDark ? "1px solid #3a3a4e" : "1px solid #e5e7eb",
          background: bgDark ? "#2a2a3e" : "transparent",
          padding: "4px 12px",
          fontSize: 11,
          color: bgDark ? "#e0e0e0" : "#6b7280",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          whiteSpace: "normal",
          flexShrink: 0,
          opacity: chromeVisible ? 1 : 0.3,
          transition: "opacity 0.2s",
        }}
      >
        <span
          title={
            is3D
              ? "3D canvas \u2014 use the diagram's own controls to rotate, pan, and zoom"
              : "Drag to pan \u2022 Shift+drag to zoom to area \u2022 Ctrl+wheel to zoom \u2022 0 fits \u2022 1 actual size"
          }
          style={{ cursor: "help" }}
        >
          {is3D ? "3D canvas" : "Drag to pan"}
        </span>
        {!is3D && <span>{Math.round(zoom * 100)}%</span>}
      </div>

      {/* Resize handles */}
      {!maximized && (
        <>
          <div
            onMouseDown={(e) => startResize(e, 'bottom')}
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 0,
              height: 4,
              cursor: 'ns-resize',
              zIndex: 15,
            }}
            title="Drag to resize height"
          />
          <div
            onMouseDown={(e) => startResize(e, 'right')}
            style={{
              position: 'absolute',
              top: 12,
              bottom: 12,
              right: 0,
              width: 4,
              cursor: 'ew-resize',
              zIndex: 15,
            }}
            title="Drag to resize width"
          />
          <div
            onMouseDown={(e) => startResize(e, 'corner')}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 12,
              height: 12,
              cursor: 'nwse-resize',
              background:
                'linear-gradient(135deg, transparent 0%, transparent 30%, #888 30%, #888 45%, transparent 45%, transparent 60%, #888 60%, #888 75%, transparent 75%)',
              zIndex: 20,
            }}
            title="Drag to resize"
          />
        </>
      )}
    </div>
  ) : null;

  return (
    <>
      <style>{`
        .gv-detached .gv-content-inner svg {
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
        }
      `}</style>
      {InlineBlock}
      {DetachedWindow}
    </>
  );
}

function ToolbarButton({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 20,
        height: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        color: '#333333',
        cursor: 'pointer',
        padding: 0,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = '#e0e0e0'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      {children}
    </button>
  );
}

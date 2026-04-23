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
 * GraphicViewer v3
 *
 * A diagram studio embedded in FSM Drive Chat. Wraps any rendered graphic
 * (SVG, canvas, Mermaid, Three.js, Plotly, etc.) with:
 *
 *   Inline mode: a small header with a "Detach" button; content renders
 *   in the Chat flow at its natural size.
 *
 *   Detached mode: a floating window the user can:
 *     - Drag (title bar)
 *     - Resize (bottom-right grip, or edge grips)
 *     - Zoom 0.1x to 10x (buttons, Ctrl+wheel, keyboard +/-)
 *     - Pan when zoomed (click-and-drag on content)
 *     - Marquee zoom (Shift+drag to zoom to a rectangle)
 *     - Zoom-to-fit (keyboard "0", button)
 *     - Zoom-to-100% (keyboard "1", button)
 *     - Maximize (button, or Ctrl+M)
 *     - Toggle light/dark background (button)
 *     - Re-attach (Escape, X button, or Return in inline placeholder)
 *
 *   Chrome auto-hides after 3 seconds of inactivity, reveals on mouse
 *   movement. Keyboard shortcuts work whenever the window is focused.
 *
 *   Multi-instance: each <GraphicViewer> instance carries its own state,
 *   so multiple graphics can be detached side-by-side.
 *
 * 3D handling: the viewer detects <canvas> children and disables its own
 * pan/zoom/marquee when canvas is present, letting the 3D library's
 * native controls (orbit, pan, dolly) handle internal manipulation.
 * The viewer still provides the window chrome (drag, resize, maximize,
 * detach).
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
  const [marquee, setMarquee] = useState(null); // { startX, startY, currentX, currentY }
  const [chromeVisible, setChromeVisible] = useState(true);
  const [is3D, setIs3D] = useState(false);

  // ---------------- Refs ----------------
  const windowRef = useRef(null);
  const contentAreaRef = useRef(null);
  const contentInnerRef = useRef(null);
  const chromeTimerRef = useRef(null);

  // ---------------- 3D detection ----------------
  // On mount and whenever children change, look for a <canvas> element
  // among the rendered children. If found, this is a 3D/canvas-based
  // graphic and we should disable our own pan/zoom/marquee.
  useLayoutEffect(() => {
    if (!contentInnerRef.current) return;
    const canvas = contentInnerRef.current.querySelector("canvas");
    setIs3D(!!canvas);
  }, [children, detached]);

  // ---------------- Intrinsic size measurement ----------------
  // Needed for zoom-to-fit calculations. We measure the natural
  // bounding box of the content (unscaled).
  useLayoutEffect(() => {
    if (!contentInnerRef.current || !detached) return;
    // Measure without transform applied: find the first child element
    // and read its natural size.
    const firstChild = contentInnerRef.current.firstElementChild;
    if (firstChild) {
      // Prefer SVG's intrinsic width/height if available.
      if (firstChild.tagName === "svg") {
        const vb = firstChild.viewBox?.baseVal;
        if (vb && vb.width && vb.height) {
          setIntrinsic({ width: vb.width, height: vb.height });
          return;
        }
      }
      // Fallback to getBoundingClientRect, accounting for current zoom.
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
      // Don't capture if user is typing in an input inside the graphic
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
    // Subtract a little padding from the available area.
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
    (e) => {
      if (maximized) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = { ...size };
      const onMove = (ev) => {
        setSize({
          width: Math.max(360, startSize.width + (ev.clientX - startX)),
          height: Math.max(280, startSize.height + (ev.clientY - startY)),
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
  // Click and drag on the content area pans the graphic.
  // Skipped for 3D because the 3D library handles its own mouse input.
  const startContentDrag = useCallback(
    (e) => {
      if (is3D) return;
      if (e.shiftKey) return; // shift+drag starts marquee instead
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
        // Compute the marquee rectangle and zoom to fit it.
        const endX = ev.clientX - areaRect.left;
        const endY = ev.clientY - areaRect.top;
        const rx = Math.min(startX, endX);
        const ry = Math.min(startY, endY);
        const rw = Math.abs(endX - startX);
        const rh = Math.abs(endY - startY);
        setMarquee(null);
        // Require a minimum size so accidental clicks don't zoom.
        if (rw < 20 || rh < 20) return;
        // Compute new zoom so the marquee rectangle fills the area.
        const newZoomX = areaRect.width / rw;
        const newZoomY = areaRect.height / rh;
        const zoomFactor = Math.min(newZoomX, newZoomY);
        const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));
        // Compute new pan so the marquee center moves to the viewport center.
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
      if (is3D) return; // 3D lib handles its own wheel
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
  // When maximized, snap to viewport minus a small margin.
  // Chrome is set as explicit inline styles because this file's Tailwind
  // classes are not being applied at runtime (the rest of the app uses
  // inline styles). Without these the floating window has no visible edge.
  const windowChrome = {
    background: "white",
    border: "1px solid #666",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
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

  // ---------------- Inline block ----------------
  const InlineBlock = (
    <div
      className={`my-3 rounded-lg border ${
        detached
          ? "border-dashed border-gray-400 bg-gray-50 dark:bg-gray-800"
          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      }`}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {title}
        </span>
        <div className="flex gap-1">
          {detached ? (
            <button
              type="button"
              onClick={() => setDetached(false)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
              title="Return graphic to Chat"
            >
              <RotateCcw size={14} />
              Return
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                // Measure the inline graphic's natural rendered size so
                // the detached window opens just large enough to contain
                // it, clamped to sensible min/max. Must happen before
                // setDetached(true) because the inline node is what holds
                // the currently-rendered graphic.
                let naturalW = 600;
                let naturalH = 400;
                const inlineEl = contentInnerRef.current;
                if (inlineEl) {
                  const svgEl = inlineEl.querySelector("svg");
                  const target =
                    svgEl || inlineEl.firstElementChild || inlineEl;
                  const rect = target.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    naturalW = rect.width;
                    naturalH = rect.height;
                  }
                }
                const maxW = window.innerWidth * 0.8;
                const maxH = window.innerHeight * 0.8;
                const w = Math.max(400, Math.min(maxW, naturalW + 40));
                const h = Math.max(320, Math.min(maxH, naturalH + 80));
                setSize({ width: w, height: h });
                setPos({ x: 80, y: 60 });
                setDetached(true);
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Open in detachable viewer"
            >
              <Expand size={14} />
              Detach
            </button>
          )}
        </div>
      </div>
      {detached ? (
        <div className="flex h-32 items-center justify-center text-sm italic text-gray-500 dark:text-gray-400">
          Viewing in detached window &mdash; press Esc or click Return to recall
        </div>
      ) : (
        <div ref={contentInnerRef} className="overflow-auto p-3">
          {children}
        </div>
      )}
    </div>
  );

  // ---------------- Detached window ----------------
  const DetachedWindow = detached ? (
    <div
      ref={windowRef}
      style={windowStyle}
      className="flex flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-2xl dark:border-gray-600 dark:bg-gray-900"
      tabIndex={0}
      onMouseMove={bumpChromeVisibility}
    >
      {/* Title bar */}
      <div
        onMouseDown={startWindowDrag}
        onDoubleClick={() => setMaximized((m) => !m)}
        className={`flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 transition-opacity ${
          chromeVisible ? "opacity-100" : "opacity-30 hover:opacity-100"
        }`}
        style={{ cursor: maximized ? "default" : "move" }}
      >
        <div className="flex items-center gap-2">
          {!maximized && <Move size={14} className="text-gray-400" />}
          <span className="select-none text-sm font-medium text-gray-700 dark:text-gray-200">
            {title}
          </span>
          {is3D && (
            <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
              3D
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
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
        className={`relative flex-1 overflow-hidden ${
          bgDark ? "bg-gray-900" : "bg-white"
        }`}
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if (e.shiftKey) {
            startMarquee(e);
          } else {
            startContentDrag(e);
          }
        }}
        style={{ cursor: is3D ? "default" : marquee ? "crosshair" : "grab" }}
      >
        <div
          ref={contentInnerRef}
          style={{
            transform: is3D
              ? undefined
              : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: is3D ? 0 : 0,
            display: "inline-block",
            // For 3D we let the canvas fill the area.
            width: is3D ? "100%" : "auto",
            height: is3D ? "100%" : "auto",
          }}
        >
          <div
            style={
              is3D
                ? { width: "100%", height: "100%" }
                : { transform: "translate(-50%, -50%)" }
            }
          >
            {children}
          </div>
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

      {/* Status bar \u2014 short label + tooltip; wraps rather than forcing
          the window wider than its contents need. */}
      <div
        className={`transition-opacity ${
          chromeVisible ? "opacity-100" : "opacity-30 hover:opacity-100"
        }`}
        style={{
          borderTop: "1px solid #e5e7eb",
          padding: "4px 12px",
          fontSize: 11,
          color: "#6b7280",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          whiteSpace: "normal",
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

      {/* Resize grip */}
      {!maximized && (
        <div
          onMouseDown={startResize}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgba(100,100,100,0.4) 50%)",
            zIndex: 10,
          }}
          title="Drag to resize"
        />
      )}
    </div>
  ) : null;

  return (
    <>
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
      className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

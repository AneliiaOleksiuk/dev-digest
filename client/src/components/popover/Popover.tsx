/* Popover — generic hover-triggered floating panel. Unlike vendor/ui's
   click-only Dropdown, this opens on hover-intent (debounced) and accepts
   arbitrary children, not a fixed items list. Portaled to <body> and
   positioned in viewport coordinates so it can't be clipped by an ancestor's
   `overflow: hidden` / `overflow-x: auto` (e.g. the PR list's tableCard) and
   is clamped to stay fully on-screen near a viewport edge. */
"use client";

import React from "react";
import { createPortal } from "react-dom";

interface Position {
  top: number;
  left: number;
}

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

function clampedPosition(triggerRect: DOMRect, panelRect: DOMRect): Position {
  const left =
    triggerRect.left + panelRect.width > window.innerWidth - VIEWPORT_MARGIN
      ? Math.max(VIEWPORT_MARGIN, triggerRect.right - panelRect.width)
      : triggerRect.left;
  const top =
    triggerRect.bottom + panelRect.height + TRIGGER_GAP > window.innerHeight - VIEWPORT_MARGIN
      ? Math.max(VIEWPORT_MARGIN, triggerRect.top - panelRect.height - TRIGGER_GAP)
      : triggerRect.bottom + TRIGGER_GAP;
  return { top, left };
}

export function Popover({
  trigger,
  children,
  openDelayMs = 200,
  closeDelayMs = 150,
  panelStyle,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  openDelayMs?: number;
  closeDelayMs?: number;
  panelStyle?: React.CSSProperties;
  /** Fires as soon as opening/closing is scheduled — earlier than `open` itself
   *  becoming true, so a consumer can start lazily loading panel content during
   *  the same open-intent delay instead of after the panel is already visible. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<Position | null>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const scheduleOpen = () => {
    clearTimers();
    onOpenChange?.(true);
    openTimer.current = setTimeout(() => setOpen(true), openDelayMs);
  };
  const scheduleClose = () => {
    clearTimers();
    onOpenChange?.(false);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setPosition(null);
    }, closeDelayMs);
  };

  // Position the portaled panel from the trigger's viewport rect, clamped so
  // it never runs off-screen. Panel first mounts off-screen+hidden (its size
  // isn't known before it's in the DOM); this measures it and corrects the
  // position in the same paint cycle, so there's no visible jump.
  const repositionPanel = React.useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!triggerRect || !panelRect) return;
    setPosition(clampedPosition(triggerRect, panelRect));
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !panelRef.current) return;

    repositionPanel();
    const observer = new ResizeObserver(repositionPanel);
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [open, repositionPanel]);

  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", repositionPanel);
    window.addEventListener("scroll", repositionPanel, true);
    return () => {
      window.removeEventListener("resize", repositionPanel);
      window.removeEventListener("scroll", repositionPanel, true);
    };
  }, [open, repositionPanel]);

  React.useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
      setPosition(null);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  React.useEffect(() => clearTimers, []);

  return (
    <>
      <div
        ref={triggerRef}
        style={{ display: "inline-block" }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        {trigger}
      </div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? "visible" : "hidden",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 9,
              boxShadow: "var(--shadow-modal)",
              zIndex: 10001,
              animation: position ? "ddpop .12s ease" : undefined,
              ...panelStyle,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

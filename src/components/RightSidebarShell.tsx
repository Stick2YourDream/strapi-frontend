import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "../css/right-friends-sidebar.css";

const RIGHT_SIDEBAR_COLLAPSE_KEY = "dashboard:right-sidebar-collapsed";

const readDesktopCollapsed = () => {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(RIGHT_SIDEBAR_COLLAPSE_KEY);
  if (stored === null) return true;
  return stored === "1";
};

const readIsDesktopViewport = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 961px)").matches;
};

type RightSidebarShellProps = {
  ariaLabel?: string;
  headTitle: string;
  headSubtitle?: string;
  headIcon: ReactNode;
  headTooltip?: string;
  onHeadClick?: () => void;
  className?: string;
  children: ReactNode;
};

export default function RightSidebarShell({
  ariaLabel = "Right sidebar",
  headTitle,
  headSubtitle,
  headIcon,
  headTooltip,
  onHeadClick,
  className = "",
  children,
}: RightSidebarShellProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<boolean>(readDesktopCollapsed);
  const [isDesktop, setIsDesktop] = useState<boolean>(readIsDesktopViewport);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 961px)");
    const update = () => setIsDesktop(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const { body } = document;
    if (!isDesktop) {
      body.classList.remove("ysp-right-sidebar-collapsed", "ysp-right-sidebar-expanded");
      return;
    }
    body.classList.toggle("ysp-right-sidebar-collapsed", collapsed);
    body.classList.toggle("ysp-right-sidebar-expanded", !collapsed);
    return () => {
      body.classList.remove("ysp-right-sidebar-collapsed", "ysp-right-sidebar-expanded");
    };
  }, [collapsed, isDesktop]);

  if (!isDesktop) return null;

  const panelClassName = [
    "right-friends-sidebar",
    collapsed ? "is-collapsed" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const handleToggle = () => setCollapsed((prev) => !prev);

  return (
    <aside className={panelClassName} aria-label={ariaLabel}>
      <button
        type="button"
        className={`right-sidebar-toggle${collapsed ? " is-collapsed" : ""}`}
        onClick={handleToggle}
        aria-pressed={!collapsed}
        aria-label={collapsed ? "Expand right sidebar" : "Collapse right sidebar"}
        title={collapsed ? "Expand right sidebar" : "Collapse right sidebar"}
      >
        {collapsed ? (
          <ChevronLeft size={16} className="sidebar-toggle-icon" aria-hidden="true" />
        ) : (
          <ChevronRight size={16} className="sidebar-toggle-icon" aria-hidden="true" />
        )}
      </button>

      {onHeadClick ? (
        <button
          type="button"
          className="right-sidebar-head"
          onClick={onHeadClick}
          data-right-tooltip={headTooltip || headTitle}
        >
          <span className="right-sidebar-head-icon" aria-hidden="true">
            {headIcon}
          </span>
          <span className="right-sidebar-head-copy">
            <strong>{headTitle}</strong>
            {headSubtitle ? <span>{headSubtitle}</span> : null}
          </span>
        </button>
      ) : (
        <div className="right-sidebar-head is-static" data-right-tooltip={headTooltip || headTitle}>
          <span className="right-sidebar-head-icon" aria-hidden="true">
            {headIcon}
          </span>
          <span className="right-sidebar-head-copy">
            <strong>{headTitle}</strong>
            {headSubtitle ? <span>{headSubtitle}</span> : null}
          </span>
        </div>
      )}

      <div className="right-sidebar-panel">{children}</div>
    </aside>
  );
}

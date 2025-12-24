import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  age?: string;
  hobbies?: string;
  bio?: string;
};

type SidebarProps = {
  active: "dashboard" | "friends" | "me";
};

export default function Sidebar({ active }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showMoreProfile, setShowMoreProfile] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const pickMediaUrl = (mediaField: any): string | undefined => {
    if (!mediaField) return undefined;
    const candidate =
      (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
      (Array.isArray(mediaField) ? mediaField[0] : mediaField);
    if (!candidate) return undefined;
    const attrs = normalize(candidate);
    let url =
      attrs.url ||
      attrs.formats?.large?.url ||
      attrs.formats?.medium?.url ||
      attrs.formats?.small?.url ||
      attrs.formats?.thumbnail?.url;
    if (!url) return undefined;
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const res = await api.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`);
        const entry = res.data?.data?.[0];
        if (!entry) return;
        const attrs = normalize(entry);
        const displayName =
          attrs.firstName || attrs.lastName
            ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim()
            : attrs.handle || attrs.username || user.username;
        setProfileSummary({
          displayName,
          avatarUrl: pickMediaUrl(attrs.avatar),
          age: attrs.age || "",
          hobbies: attrs.hobbies || "",
          bio: attrs.bio || "",
        });
      } catch {
        // ignore sidebar profile errors
      }
    };
    load();
  }, [user]);

  // Close mobile menu when the active page changes
  useEffect(() => {
    setMenuOpen(false);
  }, [active]);

  const nameForDisplay = useMemo(
    () => profileSummary?.displayName || user?.username || "Me",
    [profileSummary?.displayName, user?.username]
  );

  return (
    <div className={`sidebar-shell ${menuOpen ? "open" : ""}`}>
      <div className="sidebar-topbar">
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </div>
        <button
          type="button"
          className={`hamburger ${menuOpen ? "is-open" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle navigation menu"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <aside className="dash-nav">
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </div>
        <div className="nav-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", width: "100%" }}>
          {profileSummary && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {profileSummary.avatarUrl && (
                <img
                  src={profileSummary.avatarUrl}
                  alt={nameForDisplay}
                  className="avatar-octagon"
                  style={{ width: 54, height: 54 }}
                />
              )}
              <div style={{ color: "#c7cede" }}>
                <strong>{nameForDisplay}</strong>
              </div>
            </div>
          )}
          <button
            className="btn ghost nav-btn"
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
              setMenuOpen(false);
            }}
          >
            Logout
          </button>
        </div>
        <div className="nav-links">
          <button
            className="btn ghost nav-btn"
            onClick={() => {
              navigate("/dashboard");
              setMenuOpen(false);
            }}
            style={active === "dashboard" ? { boxShadow: "0 0 0 2px rgba(127,168,255,0.35)" } : undefined}
          >
            Dashboard
          </button>
          <button
            className="btn ghost nav-btn"
            onClick={() => {
              navigate("/friends");
              setMenuOpen(false);
            }}
            style={active === "friends" ? { boxShadow: "0 0 0 2px rgba(127,168,255,0.35)" } : undefined}
          >
            Friends
          </button>
          <button
            className="btn ghost nav-btn"
            onClick={() => {
              navigate("/me");
              setMenuOpen(false);
            }}
            style={active === "me" ? { boxShadow: "0 0 0 2px rgba(127,168,255,0.35)" } : undefined}
          >
            Me
          </button>
        </div>
        {user && (
          <div style={{ marginTop: "12px", width: "100%" }}>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setShowMoreProfile((v) => !v)}
              style={{ width: "100%", marginBottom: showMoreProfile ? "8px" : 0 }}
            >
              {showMoreProfile ? "Hide details" : "Bio"}
            </button>
            {showMoreProfile && (
              <div className="bio-panel">
                <div className="bio-line"><strong>Name:</strong> {nameForDisplay}</div>
                <div className="bio-line"><strong>Age:</strong> {profileSummary?.age || "-"}</div>
                <div className="bio-line"><strong>Hobbies:</strong> {profileSummary?.hobbies || "-"}</div>
                <div className="bio-line"><strong>Bio:</strong> {profileSummary?.bio || "-"}</div>
              </div>
            )}
          </div>
        )}
      </aside>

      {menuOpen && <button className="sidebar-overlay" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu overlay" />}
    </div>
  );
}

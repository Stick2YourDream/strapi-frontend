import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
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
  const [showProfileMenu, setShowProfileMenu] = useState(false);

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
          handle: attrs.handle || user.username,
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

  const handleLogoClick = () => {
    navigate("/");
    setMenuOpen(false);
  };

  const handleProfileAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setMenuOpen(false);
  };

  // prefer handle if loaded, else username/email
  const secondaryLine = profileSummary?.handle || user?.username || user?.email || "Profile";

  return (
    <div className={`sidebar-shell ${menuOpen ? "open" : ""}`}>
      <div className="sidebar-topbar">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </button>
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
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </button>
        <div className="nav-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", width: "100%" }}>
          {profileSummary && (
            <div style={{ position: "relative", width: "100%" }}>
              <button
                type="button"
                onClick={() => setShowProfileMenu((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "10px 12px",
                  borderRadius: "12px",
                  color: "#c7cede",
                  cursor: "pointer",
                }}
              >
                {profileSummary.avatarUrl && (
                  <img
                    src={profileSummary.avatarUrl}
                    alt={nameForDisplay}
                    className="avatar-octagon"
                    style={{ width: 48, height: 48, borderRadius: "50%" }}
                  />
                )}
                <div style={{ textAlign: "left" }}>
                  <strong style={{ display: "block" }}>{nameForDisplay}</strong>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#9ca3af",
                      display: "block",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={secondaryLine}
                  >
                    {secondaryLine}
                  </span>
                </div>
              </button>

              {showProfileMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "110%",
                    left: 0,
                    right: 0,
                    background: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                    overflow: "hidden",
                    zIndex: 15,
                  }}
                >
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/dashboard")}
                  >
                    My Dashboard
                  </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/me")}
                >
                  My Profile
                </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/friends")}
                  >
                    My Friends
                  </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => {
                      logout();
                      navigate("/login");
                      setShowProfileMenu(false);
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
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

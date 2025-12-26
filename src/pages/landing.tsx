import "../css/landing.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
};

export default function Landing() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

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

  // Lightweight SEO metadata management without extra deps
  useEffect(() => {
    const title = "Stick2YourDreams | Build momentum with friends who show up";
    const description =
      "Stick2YourDreams is a focused, private space to share progress, swap feedback, and keep accountability with friends. Log micro goals, share posts, and message your crew.";
    const url = window.location.origin + "/";

    const prevTitle = document.title;
    const metaName = (name: string) =>
      (document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null) ??
      (() => {
        const m = document.createElement("meta");
        m.setAttribute("name", name);
        document.head.appendChild(m);
        return m;
      })();
    const metaProp = (property: string) =>
      (document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null) ??
      (() => {
        const m = document.createElement("meta");
        m.setAttribute("property", property);
        document.head.appendChild(m);
        return m;
      })();
    const linkRel = (rel: string) =>
      (document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null) ??
      (() => {
        const l = document.createElement("link");
        l.setAttribute("rel", rel);
        document.head.appendChild(l);
        return l;
      })();

    const prevDescription = metaName("description")?.content;
    const prevOgTitle = metaProp("og:title")?.content;
    const prevOgDesc = metaProp("og:description")?.content;
    const prevOgUrl = metaProp("og:url")?.content;
    const prevCanonical = linkRel("canonical")?.href;

    document.title = title;
    metaName("description").content = description;
    metaName("keywords").content =
      "accountability, creators, founders, productivity, social app, friends, feedback, goals";
    metaName("robots").content = "index, follow";
    metaProp("og:type").content = "website";
    metaProp("og:title").content = title;
    metaProp("og:description").content = description;
    metaProp("og:url").content = url;
    metaProp("og:site_name").content = "Stick2YourDreams";
    linkRel("canonical").href = url;

    // JSON-LD for richer SERP context
    const ld = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Stick2YourDreams",
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Web",
      description,
      url,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Private friend network for accountability",
        "Post updates with media",
        "Direct messages for fast feedback",
        "Micro-goal tracking and streaks",
      ],
      author: { "@type": "Organization", name: "Stick2YourDreams" },
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify(ld);
    document.head.appendChild(script);

    return () => {
      document.title = prevTitle;
      if (prevDescription !== undefined) metaName("description").content = prevDescription;
      if (prevOgTitle !== undefined) metaProp("og:title").content = prevOgTitle;
      if (prevOgDesc !== undefined) metaProp("og:description").content = prevOgDesc;
      if (prevOgUrl !== undefined) metaProp("og:url").content = prevOgUrl;
      if (prevCanonical !== undefined) linkRel("canonical").href = prevCanonical;
      document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileSummary(null);
      return;
    }

    const loadProfile = async () => {
      try {
        const res = await api.get("/profiles/me?populate=avatar");
        const data = res.data?.data;
        const entry = Array.isArray(data) ? data[0] : data;
        const attrs = normalize(entry);
        if (!attrs || Array.isArray(attrs)) return;
        const displayName =
          attrs.firstName || attrs.lastName
            ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim()
            : attrs.handle || attrs.username || user.username;
        setProfileSummary({
          displayName,
          handle: attrs.handle || user.username,
          avatarUrl: pickMediaUrl(attrs.avatar),
        });
      } catch {
        setProfileSummary({
          displayName: user.username,
          handle: user.username,
        });
      }
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [user]);

  const nameForDisplay = useMemo(
    () => profileSummary?.displayName || user?.username || "Account",
    [profileSummary?.displayName, user?.username]
  );

  const secondaryLine = profileSummary?.handle || user?.username || user?.email || "Profile";

  const handleProfileAction = (path: string) => {
    navigate(path);
    setProfileMenuOpen(false);
  };

  return (
    <div className="landing-page">
      <div className="landing-shell">
        <header className="landing-nav">
          <div className="brand-mark">
            <span>S2YD</span>
            <span>Stick2YourDreams</span>
          </div>
          <div className="nav-actions">
            {user ? (
              <div className="landing-profile">
                <button
                  type="button"
                  className="landing-profile-button"
                  onClick={() => setProfileMenuOpen((v) => !v)}
                  aria-expanded={profileMenuOpen}
                >
                  {profileSummary?.avatarUrl && (
                    <img
                      src={profileSummary.avatarUrl}
                      alt={nameForDisplay}
                      className="landing-profile-avatar"
                    />
                  )}
                  <div className="landing-profile-meta">
                    <strong>{nameForDisplay}</strong>
                    <span className="landing-profile-handle" title={secondaryLine}>
                      {secondaryLine}
                    </span>
                  </div>
                  <span className={`landing-profile-caret ${profileMenuOpen ? "open" : ""}`}>
                    v
                  </span>
                </button>
                {profileMenuOpen && (
                  <div className="landing-profile-menu">
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/me")}
                    >
                      My Profile
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/friends")}
                    >
                      My Friends
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => {
                        logout();
                        setProfileMenuOpen(false);
                        navigate("/login");
                      }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button className="btn-ghost" onClick={() => navigate("/login")}>
                  Log in
                </button>
                <button className="btn-primary" onClick={() => navigate("/register")}>
                  Get started
                </button>
              </>
            )}
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <div className="hero-badges">
              <span className="pill">Creators & Builders</span>
              <span className="pill">Private messages</span>
              <span className="pill">Daily momentum</span>
            </div>
            <h1>
              Build momentum with friends who actually show up for your dreams.
            </h1>
            <p>
              Stick2YourDreams is a focused space for sharing progress, swapping feedback,
              and keeping promises to yourself. No fluff—just the crew you trust and the
              accountability you need.
            </p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => navigate("/register")}>
                Start free
              </button>
              <button className="btn-ghost" onClick={() => navigate("/login")}>
                Already with us?
              </button>
            </div>
          </div>

          <div className="hero-card">
            <h3>Today&apos;s Focus</h3>
            <p>What we&apos;re shipping together this week.</p>
            <div className="hero-grid">
              <div className="mini-card">
                <strong>Friend Signals</strong>
                <p>See who&apos;s active, who needs a nudge, and who just shipped.</p>
              </div>
              <div className="mini-card">
                <strong>Share Posts</strong>
                <p>Drop a quick win, a screenshot, or a link for feedback.</p>
              </div>
              <div className="mini-card">
                <strong>Private Threads</strong>
                <p>Keep real conversations going without getting buried in noise.</p>
              </div>
              <div className="mini-card">
                <strong>Micro Goals</strong>
                <p>Log tiny goals daily so you and your circle stay in sync.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Built for people who make things</h2>
            <span className="muted">Creators, founders, designers, builders.</span>
          </div>
          <div className="feature-grid">
            <div className="feature">
              <h3>Frictionless invites</h3>
              <p>Find friends by handle and get instant context with bios and posts.</p>
            </div>
            <div className="feature">
              <h3>Signals not noise</h3>
              <p>Activity cues highlight who&apos;s moving so you can support fast.</p>
            </div>
            <div className="feature">
              <h3>Media-forward</h3>
              <p>Drop images, videos, and quick updates—no formatting battles.</p>
            </div>
            <div className="feature">
              <h3>Private threads</h3>
              <p>DMs that stay lightweight, focused, and discoverable with your crew.</p>
            </div>
            <div className="feature">
              <h3>Momentum metrics</h3>
              <p>Track streaks and tiny wins to keep the habit alive week over week.</p>
            </div>
            <div className="feature">
              <h3>Secure & trusted</h3>
              <p>Built on Strapi with modern auth—your circle stays private.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>What you get in week one</h2>
            <span className="muted">You don&apos;t need months—just show up and post.</span>
          </div>
          <div className="metrics">
            <div className="metric">
              <strong>+3</strong>
              <span>new accountability partners</span>
            </div>
            <div className="metric">
              <strong>12</strong>
              <span>daily micro goals shipped</span>
            </div>
            <div className="metric">
              <strong>4x</strong>
              <span>faster feedback loops</span>
            </div>
            <div className="metric">
              <strong>0</strong>
              <span>doom scroll distractions</span>
            </div>
          </div>
        </section>

        <section className="cta">
          <div>
            <h3>Ready to stick to your dream?</h3>
            <p>Join the crew that celebrates your output, not your busywork.</p>
          </div>
          <div className="cta-actions">
            <button className="btn-primary" onClick={() => navigate("/register")}>
              Claim your spot
            </button>
            <button className="btn-ghost" onClick={() => navigate("/login")}>
              I already have an account
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

import "../css/landing.css";
import { CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";

export default function WhatMakesUsDifferent() {
  const navigate = useNavigate();
  const { user } = useAuth();

  usePageMeta({
    title: "What makes us different | Your Social Place",
    description:
      "See what makes Your Social Place different: accountability-first design, safer defaults, and real momentum.",
    type: "website",
    canonical: "https://s2ydconnection.com/what-makes-us-different",
  });

  return (
    <div className="landing-page">
      <div className="landing-shell">
        <nav className="landing-nav" aria-label="Primary">
          <button
            type="button"
            className="landing-brand"
            onClick={() => navigate("/")}
            aria-label="Go to Your Social Place home"
          >
            <span className="landing-brand-mark" aria-hidden="true">
              <img src="/logo2.png" alt="Your Social Place logo" />
            </span>
            <span className="landing-brand-text">Your Social Place</span>
          </button>
          <div className="landing-links">
            <a href="/">Home</a>
            <a href="/guidelines">Guidelines</a>
            <a href="/safety">Safety</a>
            <a href="/report">Report</a>
          </div>
          <div className="nav-actions">
            {user ? (
              <button className="btn-ghost" onClick={() => navigate("/dashboard")}>
                Go to dashboard
              </button>
            ) : (
              <>
                <button className="btn-primary" onClick={() => navigate("/register")}>
                  Signup Now
                </button>
                <button className="btn-ghost" onClick={() => navigate("/login")}>
                  Log in
                </button>
              </>
            )}
          </div>
        </nav>

        <section className="section">
          <div className="section-header">
            <h2>What makes us different</h2>
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
              <p>Drop images, videos, and quick updates-no formatting battles.</p>
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
              <p>Built on Strapi with modern auth-your circle stays private.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>What you get</h2>
            <span className="muted">Define trust within our community.</span>
          </div>
          <ul className="trust-list">
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>No doomscrolling features</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Encouragement and accountability first</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Clear rules with fast reporting</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Safer defaults, private-by-default profiles</span>
            </li>
          </ul>
        </section>

        <section className="section safety-section" id="safety">
          <div className="section-header">
            <h2>Safety &amp; Moderation</h2>
            <span className="muted">Clear expectations, quick action, respectful space.</span>
          </div>
          <div className="safety-grid">
            <div className="safety-card">
              <h3>Report in a few taps</h3>
              <p>
                Flag a post or user from any profile. Reports go straight into our review queue.
              </p>
            </div>
            <div className="safety-card">
              <h3>Mute or block instantly</h3>
              <p>Mute stops inbound messages. Block removes all communication between two users.</p>
            </div>
            <div className="safety-card">
              <h3>Private-by-default</h3>
              <p>
                Share at your pace. Keep your updates in a smaller circle until you decide
                otherwise.
              </p>
            </div>
          </div>
          <div className="safety-steps" id="reporting">
            <div className="safety-step">
              <span className="safety-step-number">1</span>
              <div>
                <strong>Report</strong>
                <p>Tell us what happened and why it feels unsafe or off-topic.</p>
              </div>
            </div>
            <div className="safety-step">
              <span className="safety-step-number">2</span>
              <div>
                <strong>Review</strong>
                <p>Our team reviews context, history, and impact.</p>
              </div>
            </div>
            <div className="safety-step">
              <span className="safety-step-number">3</span>
              <div>
                <strong>Action</strong>
                <p>We remove content, warn, or restrict accounts based on severity.</p>
              </div>
            </div>
          </div>
          <div className="safety-actions">
            <a className="btn-ghost" href="/guidelines#reporting">
              Read Community Guidelines
            </a>
            <a className="btn-primary" href="/report">
              How reporting works
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}

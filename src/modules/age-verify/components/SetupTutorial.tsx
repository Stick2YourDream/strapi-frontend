import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGE_VERIFY_BASE_PATH } from "../constants";

type TutorialStep = {
  title: string;
  summary: string;
  objectives: string[];
  variables: string[];
  reward: string;
  icon: React.ReactNode;
  shortLabel: string;
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "Quest 1: Pick your deployment mode",
    shortLabel: "Deploy",
    summary:
      "Decide where the verify app and API will live. Local, staging, or prod.",
    objectives: [
      "Pick a public base URL for the verify UI.",
      "Pick an API base URL for the verify backend.",
      "Decide if you want QR flow or direct mobile link flow.",
    ],
    variables: [
      "VITE_AGE_VERIFY_PUBLIC_URL=https://yourapp.com/age-verify",
      "VITE_AGE_VERIFY_API_URL=https://yourapp.com/api/age-verify",
    ],
    reward: "Unlocks the QR + mobile handoff flow.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3l3 6 6 .9-4.5 4.4 1.1 6.3L12 17l-5.6 3 1.1-6.3L3 9.9 9 9l3-6z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    title: "Quest 2: Configure the backend",
    shortLabel: "Backend",
    summary: "Set the backend port, CORS, and signing secrets.",
    objectives: [
      "Set the public base URL used in QR/mobile links.",
      "Allow your frontend domain(s).",
      "Set a strong JWT secret for tokens.",
    ],
    variables: [
      "PUBLIC_BASE_URL=https://yourapp.com/age-verify",
      "AGE_VERIFY_ALLOWED_DOMAINS=yourapp.com",
      "AGE_VERIFY_JWT_SECRET=change-me",
    ],
    reward: "Verified tokens are signed and trusted.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 5h16v4H4V5zm0 6h16v4H4v-4zm0 6h16v2H4v-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    title: "Quest 3: Choose your data store",
    shortLabel: "Database",
    summary:
      "You can use any database. Strapi is only an example, not a requirement.",
    objectives: [
      "Decide how you want to store verified status.",
      "Option A: Receive a webhook and update your own DB.",
      "Option B: Use Strapi fields (example only).",
    ],
    variables: [
      "AGE_VERIFY_WEBHOOK_URL=https://api.yourapp.com/age-verify/webhook",
      "AGE_VERIFY_WEBHOOK_TOKEN=your-bearer-token",
      "AGE_VERIFY_WEBHOOK_SECRET=shared-secret",
      "AGE_VERIFY_STRAPI_URL=https://your-strapi.com (example only)",
      "AGE_VERIFY_STRAPI_TOKEN=your-strapi-token (example only)",
    ],
    reward: "Your users can be marked verified in any database.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 7c0-2.2 3.6-4 8-4s8 1.8 8 4-3.6 4-8 4-8-1.8-8-4zm0 5c0 2.2 3.6 4 8 4s8-1.8 8-4M4 12v5c0 2.2 3.6 4 8 4s8-1.8 8-4v-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    title: "Quest 4: Connect your app",
    shortLabel: "Connect",
    summary: "Send users to verify, then handle the return token.",
    objectives: [
      "Pass returnUrl when creating a session.",
      "On return, read ageVerificationToken from the URL.",
      "Validate token using /api/verify-token.",
    ],
    variables: [
      "returnUrl=https://yourapp.com/register",
      "POST /api/age-verify/session with { returnUrl }",
      "POST /api/age-verify/verify-token with { token }",
    ],
    reward: "Your app can gate access by age + liveness.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M10 7H8a5 5 0 0 0 0 10h2m4 0h2a5 5 0 0 0 0-10h-2M8 12h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Quest 5: Launch and monitor",
    shortLabel: "Launch",
    summary: "Finalize security settings and keep an eye on logs.",
    objectives: [
      "Deploy backend and frontend with HTTPS.",
      "Tune face match thresholds if needed.",
      "Enable AGE_VERIFY_DEBUG only in staging.",
    ],
    variables: [
      "AGE_VERIFY_FACE_MATCH_REQUIRED=true",
      "AGE_VERIFY_FACE_MATCH_MIN_SCORE=0.2",
      "AGE_VERIFY_FACE_MATCH_MAX_DISTANCE=0.13",
      "AGE_VERIFY_DEBUG=false",
    ],
    reward: "Production-ready verification flow.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2l4 8 8 2-6 6 1 8-7-4-7 4 1-8-6-6 8-2 4-8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
];

export default function SetupTutorial() {
  const [stepIndex, setStepIndex] = useState(0);
  const navigate = useNavigate();
  const steps = useMemo(() => TUTORIAL_STEPS, []);
  const step = steps[stepIndex];
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);
  const xpEarned = (stepIndex + 1) * 250;

  return (
    <div className="tutorial-page">
      <div className="tutorial-header">
        <div>
          <p className="tutorial-eyebrow">Setup campaign</p>
          <h1>Age Verify Setup Quest</h1>
          <p className="tutorial-sub">
            Follow the quests to wire this verify app into any database.
            Strapi is shown only as an example.
          </p>
        </div>
        <div className="tutorial-xp">
          <span className="tutorial-level">Level {stepIndex + 1}</span>
          <span className="tutorial-xp-count">{xpEarned} XP</span>
          <button
            className="btn ghost"
            type="button"
            onClick={() => navigate(`${AGE_VERIFY_BASE_PATH}/settings`)}
          >
            Open settings
          </button>
        </div>
      </div>

      <div className="tutorial-map" aria-label="Setup quest map">
        {steps.map((item, index) => {
          const isActive = index === stepIndex;
          const isDone = index < stepIndex;
          return (
            <div className="tutorial-map-item" key={item.title}>
              <button
                type="button"
                className={`tutorial-map-card${isActive ? " is-active" : ""}${
                  isDone ? " is-done" : ""
                }`}
                onClick={() => setStepIndex(index)}
                aria-pressed={isActive}
              >
                <span className="tutorial-map-icon">{item.icon}</span>
                <span className="tutorial-map-label">
                  <span className="tutorial-map-step">Quest {index + 1}</span>
                  <span>{item.shortLabel}</span>
                </span>
              </button>
              {index < steps.length - 1 && (
                <span className="tutorial-map-arrow" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M5 12h14m-4-4 4 4-4 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="tutorial-progress">
        <div className="tutorial-progress-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="tutorial-progress-label">
          Quest {stepIndex + 1} of {steps.length} ({progress}%)
        </span>
      </div>

      <div className="tutorial-card">
        <div className="tutorial-card-title">
          <span className="tutorial-quest-badge">Quest</span>
          <span className="tutorial-card-icon">{step.icon}</span>
          <h2>{step.title}</h2>
        </div>
        <p className="tutorial-summary">{step.summary}</p>

        <div className="tutorial-grid">
          <div className="tutorial-panel">
            <h3>Objectives</h3>
            <ul>
              {step.objectives.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="tutorial-panel">
            <h3>Variables to set</h3>
            <ul className="tutorial-vars">
              {step.variables.map((item) => (
                <li key={item}>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="tutorial-reward">
          <span className="tutorial-reward-label">Reward</span>
          <span>{step.reward}</span>
        </div>
      </div>

      <div className="tutorial-actions">
        <button
          className="btn ghost"
          type="button"
          onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          disabled={stepIndex === 0}
        >
          Previous
        </button>
        {stepIndex < steps.length - 1 ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => setStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
          >
            Next quest
          </button>
        ) : (
          <button
            className="btn primary"
            type="button"
            onClick={() => navigate(AGE_VERIFY_BASE_PATH)}
          >
            Finish and start verification
          </button>
        )}
      </div>

      <div className="tutorial-footer">
        <button
          className="btn ghost"
          type="button"
          onClick={() => navigate(AGE_VERIFY_BASE_PATH)}
        >
          Back to verification
        </button>
      </div>
    </div>
  );
}

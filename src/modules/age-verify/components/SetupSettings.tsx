import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGE_VERIFY_BASE_PATH } from "../constants";

type FrontendSettings = {
  apiBaseUrl: string;
  publicBaseUrl: string;
  clientKey: string;
  debug: boolean;
  skipFaceMatch: boolean;
  faceMatchTimeoutMs: string;
};

type BackendSettings = {
  port: string;
  publicBaseUrl: string;
  allowedOrigins: string;
  allowedDomains: string;
  clientKeys: string;
  jwtSecret: string;
  jwtTtl: string;
  jwtIssuer: string;
  jwtAudience: string;
  faceMatchRequired: boolean;
  faceMatchMinScore: string;
  faceMatchMaxDistance: string;
  ocrAlways: boolean;
  webhookUrl: string;
  webhookToken: string;
  webhookSecret: string;
  webhookTimeoutMs: string;
  strapiUrl: string;
  strapiUrls: string;
  strapiToken: string;
  strapiUserPath: string;
  strapiVerifyField: string;
  strapiVerifiedAtField: string;
  strapiTokenField: string;
  strapiSessionField: string;
  strapiProviderField: string;
  strapiProviderValue: string;
  strapiTimeoutMs: string;
  strapiSetOnDenied: boolean;
};

type SettingsState = {
  applyToRuntime: boolean;
  frontend: FrontendSettings;
  backend: BackendSettings;
};

const SETTINGS_KEY = "ageVerifySettings.v1";
const SETTINGS_EVENT = "ageVerifySettingsUpdated";

const buildDefaults = (): SettingsState => ({
  applyToRuntime: false,
  frontend: {
    apiBaseUrl: String(
      import.meta.env.VITE_AGE_VERIFY_API_URL ||
        import.meta.env.VITE_VERIFY_API_URL ||
        "/api/age-verify"
    ),
    publicBaseUrl: String(
      import.meta.env.VITE_AGE_VERIFY_PUBLIC_URL ||
        import.meta.env.VITE_VERIFY_PUBLIC_URL ||
        "http://localhost:5173/age-verify"
    ),
    clientKey: String(
      import.meta.env.VITE_AGE_VERIFY_CLIENT_KEY ||
        import.meta.env.VITE_VERIFY_CLIENT_KEY ||
        "change-me-client-key"
    ),
    debug:
      String(
        import.meta.env.VITE_AGE_VERIFY_DEBUG ||
          import.meta.env.VITE_VERIFY_DEBUG ||
          "true"
      ).toLowerCase() !== "false",
    skipFaceMatch:
      String(
        import.meta.env.VITE_AGE_VERIFY_SKIP_FACE_MATCH ||
          import.meta.env.VITE_SKIP_FACE_MATCH ||
          ""
      ).toLowerCase() === "true",
    faceMatchTimeoutMs: String(
      import.meta.env.VITE_AGE_VERIFY_FACE_MATCH_TIMEOUT_MS ||
        import.meta.env.VITE_FACE_MATCH_TIMEOUT_MS ||
        "2500"
    ),
  },
  backend: {
    port: "1337",
    publicBaseUrl: "http://localhost:5173/age-verify",
    allowedOrigins:
      "http://localhost:5173,https://verify.yoursocialplace.com,https://yoursocialplace.com",
    allowedDomains: "localhost,verify.yoursocialplace.com,yoursocialplace.com",
    clientKeys: "change-me-client-key",
    jwtSecret: "change-me",
    jwtTtl: "30d",
    jwtIssuer: "ysp-age-verify",
    jwtAudience: "ysp-clients",
    faceMatchRequired: false,
    faceMatchMinScore: "0.2",
    faceMatchMaxDistance: "0.13",
    ocrAlways: false,
    webhookUrl: "",
    webhookToken: "",
    webhookSecret: "",
    webhookTimeoutMs: "4000",
    strapiUrl: "",
    strapiUrls: "",
    strapiToken: "",
    strapiUserPath: "/api/users",
    strapiVerifyField: "ageVerified",
    strapiVerifiedAtField: "ageVerifiedAt",
    strapiTokenField: "ageVerificationToken",
    strapiSessionField: "ageVerificationSessionId",
    strapiProviderField: "ageVerificationProvider",
    strapiProviderValue: "ysp-age-verify",
    strapiTimeoutMs: "4000",
    strapiSetOnDenied: false,
  },
});

const loadSettings = () => {
  if (typeof window === "undefined") return buildDefaults();
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return buildDefaults();
    const parsed = JSON.parse(raw);
    return { ...buildDefaults(), ...parsed };
  } catch {
    return buildDefaults();
  }
};

const saveSettings = (settings: SettingsState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const buildFrontendEnv = (settings: SettingsState) => {
  const { frontend } = settings;
  return [
    `VITE_AGE_VERIFY_API_URL=${frontend.apiBaseUrl}`,
    `VITE_AGE_VERIFY_PUBLIC_URL=${frontend.publicBaseUrl}`,
    `VITE_AGE_VERIFY_CLIENT_KEY=${frontend.clientKey}`,
    `VITE_AGE_VERIFY_DEBUG=${frontend.debug ? "true" : "false"}`,
    `VITE_AGE_VERIFY_SKIP_FACE_MATCH=${frontend.skipFaceMatch ? "true" : "false"}`,
    `VITE_AGE_VERIFY_FACE_MATCH_TIMEOUT_MS=${frontend.faceMatchTimeoutMs || "2500"}`,
  ].join("\n");
};

const buildBackendEnv = (settings: SettingsState) => {
  const { backend } = settings;
  return [
    `PORT=${backend.port}`,
    `PUBLIC_BASE_URL=${backend.publicBaseUrl}`,
    `ALLOWED_ORIGINS=${backend.allowedOrigins}`,
    `AGE_VERIFY_ALLOWED_DOMAINS=${backend.allowedDomains}`,
    `AGE_VERIFY_CLIENT_KEYS=${backend.clientKeys}`,
    `AGE_VERIFY_JWT_SECRET=${backend.jwtSecret}`,
    `AGE_VERIFY_JWT_TTL=${backend.jwtTtl}`,
    `AGE_VERIFY_JWT_ISSUER=${backend.jwtIssuer}`,
    `AGE_VERIFY_JWT_AUDIENCE=${backend.jwtAudience}`,
    `AGE_VERIFY_FACE_MATCH_REQUIRED=${backend.faceMatchRequired ? "true" : "false"}`,
    `AGE_VERIFY_FACE_MATCH_MIN_SCORE=${backend.faceMatchMinScore}`,
    `AGE_VERIFY_FACE_MATCH_MAX_DISTANCE=${backend.faceMatchMaxDistance}`,
    `AGE_VERIFY_OCR_ALWAYS=${backend.ocrAlways ? "true" : "false"}`,
    `AGE_VERIFY_WEBHOOK_URL=${backend.webhookUrl}`,
    `AGE_VERIFY_WEBHOOK_TOKEN=${backend.webhookToken}`,
    `AGE_VERIFY_WEBHOOK_SECRET=${backend.webhookSecret}`,
    `AGE_VERIFY_WEBHOOK_TIMEOUT_MS=${backend.webhookTimeoutMs}`,
    `AGE_VERIFY_STRAPI_URL=${backend.strapiUrl}`,
    `AGE_VERIFY_STRAPI_URLS=${backend.strapiUrls}`,
    `AGE_VERIFY_STRAPI_TOKEN=${backend.strapiToken}`,
    `AGE_VERIFY_STRAPI_USER_PATH=${backend.strapiUserPath}`,
    `AGE_VERIFY_STRAPI_VERIFY_FIELD=${backend.strapiVerifyField}`,
    `AGE_VERIFY_STRAPI_VERIFIED_AT_FIELD=${backend.strapiVerifiedAtField}`,
    `AGE_VERIFY_STRAPI_TOKEN_FIELD=${backend.strapiTokenField}`,
    `AGE_VERIFY_STRAPI_SESSION_FIELD=${backend.strapiSessionField}`,
    `AGE_VERIFY_STRAPI_PROVIDER_FIELD=${backend.strapiProviderField}`,
    `AGE_VERIFY_STRAPI_PROVIDER_VALUE=${backend.strapiProviderValue}`,
    `AGE_VERIFY_STRAPI_TIMEOUT_MS=${backend.strapiTimeoutMs}`,
    `AGE_VERIFY_STRAPI_SET_ON_DENIED=${backend.strapiSetOnDenied ? "true" : "false"}`,
  ].join("\n");
};

type SectionKey = "frontend" | "backend" | "database";

export default function SetupSettings() {
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const [activeSection, setActiveSection] = useState<SectionKey>("frontend");
  const navigate = useNavigate();
  const frontendEnv = useMemo(() => buildFrontendEnv(settings), [settings]);
  const backendEnv = useMemo(() => buildBackendEnv(settings), [settings]);

  const updateFrontend = (patch: Partial<FrontendSettings>) => {
    setSettings((prev) => ({ ...prev, frontend: { ...prev.frontend, ...patch } }));
  };

  const updateBackend = (patch: Partial<BackendSettings>) => {
    setSettings((prev) => ({ ...prev, backend: { ...prev.backend, ...patch } }));
  };

  const handleSave = () => {
    saveSettings(settings);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
    }
  };

  const handleReset = () => {
    const next = buildDefaults();
    setSettings(next);
    saveSettings(next);
  };

  const copyText = async (value: string) => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <p className="tutorial-eyebrow">Settings</p>
          <h1>Age Verify Control Panel</h1>
          <p className="tutorial-sub">
            Update your verify configuration. Strapi fields are optional examples.
          </p>
        </div>
        <div className="settings-actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => navigate(`${AGE_VERIFY_BASE_PATH}/tutorial`)}
          >
            Back to tutorial
          </button>
          <button className="btn primary" type="button" onClick={handleSave}>
            Save & apply
          </button>
        </div>
      </header>

      <div className="settings-body">
        <nav className="settings-nav">
          <button
            type="button"
            className={`settings-tab${activeSection === "frontend" ? " is-active" : ""}`}
            onClick={() => setActiveSection("frontend")}
          >
            Frontend
          </button>
          <button
            type="button"
            className={`settings-tab${activeSection === "backend" ? " is-active" : ""}`}
            onClick={() => setActiveSection("backend")}
          >
            Backend
          </button>
          <button
            type="button"
            className={`settings-tab${activeSection === "database" ? " is-active" : ""}`}
            onClick={() => setActiveSection("database")}
          >
            Database
          </button>
        </nav>

        <div className="settings-panel">
          {activeSection === "frontend" && (
            <section className="settings-section">
              <h2>Frontend runtime</h2>
              <p className="settings-hint">
                Toggle runtime overrides to apply these settings automatically in the
                verify UI.
              </p>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.applyToRuntime}
                  onChange={(e) => setSettings((prev) => ({ ...prev, applyToRuntime: e.target.checked }))}
                />
                <span>Apply settings to the live verify UI</span>
              </label>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Verify API URL</span>
                  <input
                    value={settings.frontend.apiBaseUrl}
                    onChange={(e) => updateFrontend({ apiBaseUrl: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>Public Verify URL</span>
                  <input
                    value={settings.frontend.publicBaseUrl}
                    onChange={(e) => updateFrontend({ publicBaseUrl: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>Client API Key</span>
                  <input
                    value={settings.frontend.clientKey}
                    onChange={(e) => updateFrontend({ clientKey: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>Face Match Timeout (ms)</span>
                  <input
                    value={settings.frontend.faceMatchTimeoutMs}
                    onChange={(e) => updateFrontend({ faceMatchTimeoutMs: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-toggles">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.frontend.debug}
                    onChange={(e) => updateFrontend({ debug: e.target.checked })}
                  />
                  <span>Show debug logs in UI</span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.frontend.skipFaceMatch}
                    onChange={(e) => updateFrontend({ skipFaceMatch: e.target.checked })}
                  />
                  <span>Skip face match (debug only)</span>
                </label>
              </div>
              <div className="settings-export">
                <div>
                  <h3>Frontend .env</h3>
                  <pre>{frontendEnv}</pre>
                </div>
                <button className="btn ghost" type="button" onClick={() => void copyText(frontendEnv)}>
                  Copy frontend .env
                </button>
              </div>
            </section>
          )}

          {activeSection === "backend" && (
            <section className="settings-section">
              <h2>Backend API</h2>
              <p className="settings-hint">
                These variables configure the verify backend service.
              </p>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>PORT</span>
                  <input value={settings.backend.port} onChange={(e) => updateBackend({ port: e.target.value })} />
                </label>
                <label className="settings-field">
                  <span>PUBLIC_BASE_URL</span>
                  <input
                    value={settings.backend.publicBaseUrl}
                    onChange={(e) => updateBackend({ publicBaseUrl: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>ALLOWED_ORIGINS</span>
                  <input
                    value={settings.backend.allowedOrigins}
                    onChange={(e) => updateBackend({ allowedOrigins: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_ALLOWED_DOMAINS</span>
                  <input
                    value={settings.backend.allowedDomains}
                    onChange={(e) => updateBackend({ allowedDomains: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_CLIENT_KEYS</span>
                  <input
                    value={settings.backend.clientKeys}
                    onChange={(e) => updateBackend({ clientKeys: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_JWT_SECRET</span>
                  <input
                    value={settings.backend.jwtSecret}
                    onChange={(e) => updateBackend({ jwtSecret: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_JWT_TTL</span>
                  <input value={settings.backend.jwtTtl} onChange={(e) => updateBackend({ jwtTtl: e.target.value })} />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_JWT_ISSUER</span>
                  <input
                    value={settings.backend.jwtIssuer}
                    onChange={(e) => updateBackend({ jwtIssuer: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_JWT_AUDIENCE</span>
                  <input
                    value={settings.backend.jwtAudience}
                    onChange={(e) => updateBackend({ jwtAudience: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-toggles">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.backend.faceMatchRequired}
                    onChange={(e) => updateBackend({ faceMatchRequired: e.target.checked })}
                  />
                  <span>Require face match</span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.backend.ocrAlways}
                    onChange={(e) => updateBackend({ ocrAlways: e.target.checked })}
                  />
                  <span>Always run OCR (even if barcode succeeds)</span>
                </label>
              </div>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>FACE_MATCH_MIN_SCORE</span>
                  <input
                    value={settings.backend.faceMatchMinScore}
                    onChange={(e) => updateBackend({ faceMatchMinScore: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>FACE_MATCH_MAX_DISTANCE</span>
                  <input
                    value={settings.backend.faceMatchMaxDistance}
                    onChange={(e) => updateBackend({ faceMatchMaxDistance: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>WEBHOOK_URL</span>
                  <input
                    value={settings.backend.webhookUrl}
                    onChange={(e) => updateBackend({ webhookUrl: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>WEBHOOK_TOKEN</span>
                  <input
                    value={settings.backend.webhookToken}
                    onChange={(e) => updateBackend({ webhookToken: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>WEBHOOK_SECRET</span>
                  <input
                    value={settings.backend.webhookSecret}
                    onChange={(e) => updateBackend({ webhookSecret: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>WEBHOOK_TIMEOUT_MS</span>
                  <input
                    value={settings.backend.webhookTimeoutMs}
                    onChange={(e) => updateBackend({ webhookTimeoutMs: e.target.value })}
                  />
                </label>
              </div>
              <div className="settings-export">
                <div>
                  <h3>Backend .env</h3>
                  <pre>{backendEnv}</pre>
                </div>
                <button className="btn ghost" type="button" onClick={() => void copyText(backendEnv)}>
                  Copy backend .env
                </button>
              </div>
            </section>
          )}

          {activeSection === "database" && (
            <section className="settings-section">
              <h2>Database (Strapi optional)</h2>
              <p className="settings-hint">
                You can use any database. Use the webhook or verify token to
                update your own data store. Strapi fields are optional examples.
              </p>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>AGE_VERIFY_STRAPI_URL</span>
                  <input
                    value={settings.backend.strapiUrl}
                    onChange={(e) => updateBackend({ strapiUrl: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_STRAPI_URLS</span>
                  <input
                    value={settings.backend.strapiUrls}
                    onChange={(e) => updateBackend({ strapiUrls: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_STRAPI_TOKEN</span>
                  <input
                    value={settings.backend.strapiToken}
                    onChange={(e) => updateBackend({ strapiToken: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>AGE_VERIFY_STRAPI_USER_PATH</span>
                  <input
                    value={settings.backend.strapiUserPath}
                    onChange={(e) => updateBackend({ strapiUserPath: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>VERIFY FIELD</span>
                  <input
                    value={settings.backend.strapiVerifyField}
                    onChange={(e) => updateBackend({ strapiVerifyField: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>VERIFIED_AT FIELD</span>
                  <input
                    value={settings.backend.strapiVerifiedAtField}
                    onChange={(e) => updateBackend({ strapiVerifiedAtField: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>TOKEN FIELD</span>
                  <input
                    value={settings.backend.strapiTokenField}
                    onChange={(e) => updateBackend({ strapiTokenField: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>SESSION FIELD</span>
                  <input
                    value={settings.backend.strapiSessionField}
                    onChange={(e) => updateBackend({ strapiSessionField: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>PROVIDER FIELD</span>
                  <input
                    value={settings.backend.strapiProviderField}
                    onChange={(e) => updateBackend({ strapiProviderField: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>PROVIDER VALUE</span>
                  <input
                    value={settings.backend.strapiProviderValue}
                    onChange={(e) => updateBackend({ strapiProviderValue: e.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>STRAPI TIMEOUT</span>
                  <input
                    value={settings.backend.strapiTimeoutMs}
                    onChange={(e) => updateBackend({ strapiTimeoutMs: e.target.value })}
                  />
                </label>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.backend.strapiSetOnDenied}
                  onChange={(e) => updateBackend({ strapiSetOnDenied: e.target.checked })}
                />
                <span>Set verify field to false on denied (optional)</span>
              </label>
            </section>
          )}
        </div>
      </div>

      <div className="settings-footer">
        <button className="btn ghost" type="button" onClick={handleReset}>
          Reset to defaults
        </button>
        <button
          className="btn primary"
          type="button"
          onClick={() => navigate(AGE_VERIFY_BASE_PATH)}
        >
          Back to verification
        </button>
      </div>
    </div>
  );
}

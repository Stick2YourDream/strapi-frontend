import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import "../css/dashboard.css";
import "../css/moderation.css";
import { usePageMeta } from "../hooks/usePageMeta";

type ReportItem = {
  id: number;
  targetType: string;
  targetId: string;
  reason: string;
  details?: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt?: string;
  reporter?: {
    id: number;
    email?: string | null;
    label?: string | null;
  } | null;
  targetLabel?: string | null;
};

type ModerationState = {
  warningCount?: number;
  strikeLevel?: number;
  blockedUntil?: string | null;
  lastWarningAt?: string | null;
};

type ModerationUser = {
  id: number;
  displayName: string;
  email?: string;
  appRole?: string;
  blocked?: boolean;
  profile?: {
    firstName?: string;
    lastName?: string;
    handle?: string;
  } | null;
  moderation?: ModerationState | null;
};

type ReportFilter = "all" | "open" | "reviewed" | "dismissed";

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const statusLabel = (moderation?: ModerationState | null) => {
  if (!moderation) return "Active";
  if (Number(moderation.strikeLevel) >= 3) return "Banned";
  if (moderation.blockedUntil) {
    const formatted = formatDateTime(moderation.blockedUntil);
    return formatted ? `Blocked until ${formatted}` : "Blocked";
  }
  return "Active";
};

export default function Moderation() {
  const { user } = useAuth();
  const isStaff = user?.appRole === "admin" || user?.appRole === "moderator";
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportFilter, setReportFilter] = useState<ReportFilter>("open");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportUpdating, setReportUpdating] = useState<Record<number, boolean>>({});

  const [userQuery, setUserQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [userResults, setUserResults] = useState<ModerationUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userAction, setUserAction] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const pageSize = 10;
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);

  usePageMeta({
    title: "Moderation | Your Social Place",
    description: "Review reports and manage account restrictions.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    if (!isStaff) return;
    let active = true;
    const loadReports = async () => {
      setReportsLoading(true);
      setReportError(null);
      try {
        const res = await api.get("/moderation/reports");
        if (!active) return;
        setReports(res.data?.data ?? []);
      } catch (err) {
        if (!active) return;
        setReportError("Unable to load reports.");
      } finally {
        if (active) setReportsLoading(false);
      }
    };
    void loadReports();
    return () => {
      active = false;
    };
  }, [isStaff]);

  useEffect(() => {
    if (!isStaff) return;
    let active = true;

    const loadUsers = async () => {
      setUserLoading(true);
      setUserError(null);
      try {
        const res = await api.get("/moderation/users", {
          params: {
            query: activeQuery || undefined,
            page,
            pageSize,
          },
        });
        if (!active) return;
        setUserResults(res.data?.data ?? []);
        const pagination = res.data?.meta?.pagination;
        const total = Number(pagination?.total || 0);
        const count = Number(pagination?.pageCount || 0);
        setTotalUsers(Number.isFinite(total) ? total : 0);
        setPageCount(Number.isFinite(count) ? count : 0);
        if (count > 0 && page > count) {
          setPage(count);
        }
      } catch {
        if (!active) return;
        setUserError("Unable to load users.");
        setUserResults([]);
        setTotalUsers(0);
        setPageCount(0);
      } finally {
        if (active) setUserLoading(false);
      }
    };

    void loadUsers();
    return () => {
      active = false;
    };
  }, [activeQuery, isStaff, page, pageSize]);

  if (!isStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  const filteredReports = useMemo(() => {
    if (reportFilter === "all") return reports;
    return reports.filter((report) => report.status === reportFilter);
  }, [reportFilter, reports]);

  const updateReportStatus = async (reportId: number, status: ReportItem["status"]) => {
    if (reportUpdating[reportId]) return;
    setReportUpdating((prev) => ({ ...prev, [reportId]: true }));
    try {
      await api.put(`/moderation/reports/${reportId}`, { status });
      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId ? { ...report, status } : report
        )
      );
    } catch {
      setReportError("Unable to update report.");
    } finally {
      setReportUpdating((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
    }
  };

  const handleUserSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = userQuery.trim();
    setActiveQuery(query);
    setPage(1);
  };

  const handleRestrictUser = async (targetId: number, action: string) => {
    if (userAction[targetId]) return;
    setUserAction((prev) => ({ ...prev, [targetId]: true }));
    try {
      const res = await api.post(`/moderation/users/${targetId}/restrict`, { action });
      const updated = res.data?.data;
      setUserResults((prev) =>
        prev.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                moderation: {
                  warningCount: updated.warningCount,
                  strikeLevel: updated.strikeLevel,
                  blockedUntil: updated.blockedUntil,
                  lastWarningAt: updated.lastWarningAt,
                },
              }
            : entry
        )
      );
    } catch {
      setUserError("Unable to update restriction.");
    } finally {
      setUserAction((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  };

  const handleSeedDemoUsers = async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    setDemoStatus(null);
    try {
      const res = await api.post("/moderation/demo-users/seed");
      const data = res.data?.data;
      const createdUsers = Number(data?.createdUsers || 0);
      const createdPosts = Number(data?.createdPosts || 0);
      const createdComments = Number(data?.createdComments || 0);
      const createdMessages = Number(data?.createdMessages || 0);
      const password = data?.password ? ` Default password: ${data.password}` : "";
      setDemoStatus(
        `Seeded ${createdUsers} users, ${createdPosts} posts, ${createdComments} comments, ${createdMessages} messages.${password}`
      );
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const message =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Unable to seed demo users.";
        setDemoStatus(String(message));
      } else {
        setDemoStatus("Unable to seed demo users.");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  const handleDeleteDemoUsers = async () => {
    if (demoBusy) return;
    const confirmed = window.confirm(
      "Delete all demo users and their content? This cannot be undone."
    );
    if (!confirmed) return;
    setDemoBusy(true);
    setDemoStatus(null);
    try {
      const res = await api.delete("/moderation/demo-users");
      const data = res.data?.data;
      const deletedUsers = Number(data?.deletedUsers || 0);
      setDemoStatus(`Deleted ${deletedUsers} demo users and related data.`);
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const message =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Unable to delete demo users.";
        setDemoStatus(String(message));
      } else {
        setDemoStatus("Unable to delete demo users.");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <Sidebar active="moderation" />
      <div className="main-content moderation-content">
        <section className="panel moderation-hero">
          <div>
            <p className="eyebrow">Moderation</p>
            <h2 className="moderation-title">Reports and account controls</h2>
            <p className="panel-sub">
              Review user reports and apply account restrictions when needed.
            </p>
          </div>
        </section>

        <div className="panel-grid moderation-grid">
          <section className="panel moderation-panel">
            <div className="moderation-panel-header">
              <div>
                <h3 className="moderation-panel-title">Reports</h3>
                <p className="panel-sub">All reports submitted by community members.</p>
              </div>
              <select
                className="auth-input moderation-filter"
                value={reportFilter}
                onChange={(event) => setReportFilter(event.target.value as ReportFilter)}
              >
                <option value="open">Open</option>
                <option value="reviewed">Reviewed</option>
                <option value="dismissed">Dismissed</option>
                <option value="all">All</option>
              </select>
            </div>

            {reportsLoading && <div className="status">Loading reports...</div>}
            {reportError && <div className="status status-error">{reportError}</div>}
            {!reportsLoading && filteredReports.length === 0 && (
              <div className="status">No reports in this view.</div>
            )}
            <div className="moderation-report-list">
              {filteredReports.map((report) => (
                <div key={report.id} className="moderation-report-card">
                  <div className="moderation-report-header">
                    <div>
                      <strong className="moderation-report-title">
                        {report.reason}
                      </strong>
                      <div className="moderation-report-meta">
                        Target: {report.targetType} {report.targetId}
                        {report.targetLabel ? ` (${report.targetLabel})` : ""}
                      </div>
                    </div>
                    <span
                      className={`moderation-report-status status-${report.status}`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <div className="moderation-report-meta">
                    Reported by: {report.reporter?.label || "Unknown"}
                    {report.reporter?.email ? ` (${report.reporter.email})` : ""}
                  </div>
                  {report.details && <p className="moderation-report-details">{report.details}</p>}
                  <div className="moderation-report-footer">
                    <span className="moderation-report-meta">
                      {formatDateTime(report.createdAt)}
                    </span>
                    <div className="moderation-action-row">
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "reviewed")}
                      >
                        Mark reviewed
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "dismissed")}
                      >
                        Dismiss
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "open")}
                      >
                        Reopen
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel moderation-panel">
            <div className="moderation-panel-header">
              <div>
                <h3 className="moderation-panel-title">User restrictions</h3>
                <p className="panel-sub">
                  Search by name, handle, email, or user ID.
                </p>
              </div>
            </div>

            <form className="moderation-search" onSubmit={handleUserSearch}>
              <input
                className="auth-input"
                placeholder="Search users..."
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
              />
              <button className="btn primary" type="submit" disabled={userLoading}>
                {userLoading ? "Searching..." : "Search"}
              </button>
            </form>

            {userLoading && <div className="status">Loading users...</div>}
            {userError && <div className="status status-error">{userError}</div>}
            {!userLoading && userResults.length === 0 && activeQuery && (
              <div className="status">No users found.</div>
            )}
            {!userLoading && userResults.length === 0 && !activeQuery && (
              <div className="status">No users yet.</div>
            )}
            <div className="moderation-user-pagination">
              <span className="moderation-report-meta">
                {totalUsers
                  ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(
                      page * pageSize,
                      totalUsers
                    )} of ${totalUsers}`
                  : "Showing 0 users"}
              </span>
              <div className="moderation-action-row">
                <button
                  className="btn ghost"
                  type="button"
                  disabled={page <= 1 || userLoading}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span className="moderation-report-meta">
                  Page {pageCount ? page : 0} of {pageCount || 0}
                </span>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={pageCount === 0 || page >= pageCount || userLoading}
                  onClick={() => setPage((prev) => Math.min(pageCount || 1, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="moderation-user-list">
              {userResults.map((entry) => (
                <div key={entry.id} className="moderation-user-card">
                  <div>
                    <strong>{entry.displayName}</strong>
                    <div className="moderation-report-meta">
                      {entry.email || entry.profile?.handle || "No email on file"}
                    </div>
                    <div className="moderation-report-meta">
                      Role: {entry.appRole || "user"} - {statusLabel(entry.moderation)}
                    </div>
                  </div>
                  <div className="moderation-action-row">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "block-7")}
                    >
                      Block 7 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "block-30")}
                    >
                      Block 30 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "ban")}
                    >
                      Ban
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "unblock")}
                    >
                      Unblock
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel moderation-panel moderation-demo-panel">
            <div className="moderation-panel-header">
              <div>
                <h3 className="moderation-panel-title">Demo user data</h3>
                <p className="panel-sub">
                  Seed or remove demo accounts, posts, comments, and messages.
                </p>
              </div>
            </div>
            <div className="moderation-action-row">
              <button
                className="btn ghost"
                type="button"
                disabled={demoBusy}
                onClick={() => void handleSeedDemoUsers()}
              >
                {demoBusy ? "Working..." : "Create demo users"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={demoBusy}
                onClick={() => void handleDeleteDemoUsers()}
              >
                {demoBusy ? "Working..." : "Delete demo data"}
              </button>
            </div>
            {demoStatus && <div className="status">{demoStatus}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

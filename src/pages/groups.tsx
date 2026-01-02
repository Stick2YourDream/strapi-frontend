import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import "../css/groups.css";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";

type GroupSummary = {
  id: number | string;
  documentId?: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  backgroundImage?: string;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
  role?: "admin" | "member";
};

type GroupInvite = {
  id: number | string;
  group: GroupSummary;
  inviterName: string;
};

type GroupUpdate = {
  id: number | string;
  message: string;
  group?: GroupSummary;
  actor?: string;
  createdAt?: string;
};

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
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

const hexToRgba = (value: string, alpha: number) => {
  const hex = (value || "").replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

const toGroupSummary = (entry: any): GroupSummary => {
  const attrs = normalize(entry);
  return {
    id: entry?.id ?? attrs.documentId ?? attrs.id,
    documentId: entry?.documentId ?? attrs.documentId,
    name: attrs.name || "Group",
    description: attrs.description || "",
    visibility: attrs.visibility === "public" ? "public" : "private",
    backgroundImage: pickMediaUrl(attrs.backgroundImage),
    gradientStart: attrs.gradientStart || "",
    gradientEnd: attrs.gradientEnd || "",
    gradientAngle: Number(attrs.gradientAngle ?? 135),
  };
};

const buildGroupStyle = (group: GroupSummary) => {
  const hasGradient = Boolean(group.gradientStart || group.gradientEnd);
  const angle = Number.isFinite(group.gradientAngle || 0) ? group.gradientAngle : 135;
  const gradient = hasGradient
    ? `linear-gradient(${angle}deg, ${hexToRgba(
        group.gradientStart || "#2563eb",
        0.85
      )}, ${hexToRgba(group.gradientEnd || "#22d3ee", 0.85)})`
    : "linear-gradient(135deg, rgba(8, 12, 22, 0.9), rgba(8, 12, 22, 0.4))";
  if (group.backgroundImage) {
    return {
      backgroundImage: `${gradient}, url("${group.backgroundImage}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { backgroundImage: gradient };
};

const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

export default function Groups() {
  const navigate = useNavigate();
  const { user } = useAuth();
  usePageMeta({
    title: "Groups | Stick2YourDreams Connect",
    description: "Create groups, invite friends, and build shared momentum.",
  });

  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const [publicGroups, setPublicGroups] = useState<GroupSummary[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [updates, setUpdates] = useState<GroupUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [useGradient, setUseGradient] = useState(true);
  const [gradientStart, setGradientStart] = useState("#2563eb");
  const [gradientEnd, setGradientEnd] = useState("#22d3ee");
  const [gradientAngle, setGradientAngle] = useState(135);
  const [useImage, setUseImage] = useState(false);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [memberRes, inviteRes, publicRes, updateRes] = await Promise.all([
        api.get(
          `/group-members?filters[user][id][$eq]=${user.id}` +
            `&populate=group&pagination[pageSize]=200`
        ),
        api.get(
          `/group-invites?filters[invitee][id][$eq]=${user.id}` +
            `&filters[status][$eq]=pending&populate=group&populate=inviter&sort=createdAt:desc`
        ),
        api.get(`/groups?filters[visibility][$eq]=public&pagination[pageSize]=200`),
        api.get(
          `/group-notifications?filters[recipient][id][$eq]=${user.id}` +
            `&populate=group&populate=actor&sort=createdAt:desc&pagination[pageSize]=8`
        ),
      ]);

      const memberGroups: GroupSummary[] = (memberRes.data?.data ?? [])
        .map((member: any) => {
          const memberAttrs = normalize(member);
          const groupEntry = getEntity(memberAttrs.group ?? member.group);
          if (!groupEntry) return null;
          const group = toGroupSummary(groupEntry);
          const role = memberAttrs.role === "admin" ? "admin" : "member";
          return { ...group, role };
        })
        .filter(Boolean) as GroupSummary[];

      const inviteList: GroupInvite[] = (inviteRes.data?.data ?? [])
        .map((invite: any) => {
          const attrs = normalize(invite);
          const groupEntry = getEntity(attrs.group);
          const inviterEntry = getEntity(attrs.inviter);
          if (!groupEntry) return null;
          const inviterAttrs = normalize(inviterEntry);
          const inviterName =
            inviterAttrs.username || inviterAttrs.email || "Someone";
          return {
            id: invite.id ?? attrs.documentId,
            group: toGroupSummary(groupEntry),
            inviterName,
          };
        })
        .filter(Boolean) as GroupInvite[];

      const publicList: GroupSummary[] = (publicRes.data?.data ?? [])
        .map((entry: any) => toGroupSummary(entry))
        .filter(Boolean) as GroupSummary[];

      const memberIds = new Set(
        memberGroups.map((group) => String(group.documentId ?? group.id))
      );
      const availablePublic = publicList.filter(
        (group) => !memberIds.has(String(group.documentId ?? group.id))
      );

      const updateList: GroupUpdate[] = (updateRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const groupEntry = getEntity(attrs.group);
          const actorEntry = getEntity(attrs.actor);
          return {
            id: entry.id ?? attrs.documentId,
            message: attrs.message || "",
            group: groupEntry ? toGroupSummary(groupEntry) : undefined,
            actor: normalize(actorEntry)?.username || normalize(actorEntry)?.email,
            createdAt: attrs.createdAt,
          };
        })
        .filter((entry: GroupUpdate) => entry.message) as GroupUpdate[];

      setMyGroups(memberGroups);
      setInvites(inviteList);
      setPublicGroups(availablePublic);
      setUpdates(updateList);
    } catch {
      setError("Unable to load groups right now.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!backgroundFile) {
      setPreviewImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(backgroundFile);
    setPreviewImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [backgroundFile]);

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setCreateStatus("Add a group name to continue.");
      return;
    }
    setCreating(true);
    setCreateStatus(null);
    try {
      let backgroundId: number | undefined;
      if (useImage && backgroundFile) {
        const fd = new FormData();
        fd.append("files", backgroundFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        backgroundId = uploadRes.data?.[0]?.id;
      }

      const payload: any = {
        name: groupName.trim(),
        description: groupDescription.trim(),
        visibility,
      };
      if (useGradient) {
        payload.gradientStart = gradientStart;
        payload.gradientEnd = gradientEnd;
        payload.gradientAngle = gradientAngle;
      }
      if (backgroundId) payload.backgroundImage = backgroundId;

      await api.post("/groups", { data: payload });
      setGroupName("");
      setGroupDescription("");
      setVisibility("private");
      setUseGradient(true);
      setGradientStart("#2563eb");
      setGradientEnd("#22d3ee");
      setGradientAngle(135);
      setUseImage(false);
      setBackgroundFile(null);
      setCreateStatus("Group created! Invite your crew.");
      await loadGroups();
    } catch {
      setCreateStatus("Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const handleJoinGroup = async (group: GroupSummary) => {
    try {
      await api.post("/group-members", { data: { group: group.id } });
      await loadGroups();
    } catch {
      setError("Unable to join group.");
    }
  };

  const handleAcceptInvite = async (inviteId: number | string) => {
    try {
      await api.put(`/group-invites/${inviteId}`, { data: { status: "accepted" } });
      await loadGroups();
    } catch {
      setError("Unable to accept invite.");
    }
  };

  const handleDeclineInvite = async (inviteId: number | string) => {
    try {
      await api.put(`/group-invites/${inviteId}`, { data: { status: "declined" } });
      await loadGroups();
    } catch {
      setError("Unable to decline invite.");
    }
  };

  const previewGroup: GroupSummary = useMemo(
    () => ({
      id: "preview",
      name: groupName || "Your group vibe",
      description: groupDescription || "Add a description that sets the tone.",
      visibility,
      backgroundImage: useImage ? previewImageUrl || undefined : undefined,
      gradientStart,
      gradientEnd,
      gradientAngle,
    }),
    [
      groupDescription,
      groupName,
      visibility,
      previewImageUrl,
      useImage,
      gradientStart,
      gradientEnd,
      gradientAngle,
    ]
  );

  return (
    <div className="dashboard-shell">
      <Sidebar active="groups" />
      <div className="main-content group-shell">
        <div className="topbar-greeting">
          <span className="topbar-greeting-title">Groups</span>
          <span className="topbar-greeting-sub">
            Build micro-communities for every dream you are chasing.
          </span>
        </div>
        <TopbarSearch />

        <div className="group-hero">
          <div className="group-hero__text">
            <p className="eyebrow">Create</p>
            <h1>Make it yours</h1>
            <p className="subhead">
              Spin up a public lounge or a private squad. Pick a vibe, add a gradient,
              and let the momentum stack.
            </p>
          </div>
          <div className="group-hero__preview" style={buildGroupStyle(previewGroup)}>
            <div className="group-hero__preview-content">
              <span className="pill">{visibility === "public" ? "Public" : "Private"}</span>
              <h3>{previewGroup.name}</h3>
              <p>{previewGroup.description}</p>
            </div>
          </div>
        </div>

        {error && <p className="status status-error">{error}</p>}
        {loading && <p className="status">Loading groups...</p>}

        <div className="panel-grid">
          <section className="panel group-create-panel">
            <div className="panel-header">
              <p className="eyebrow">New group</p>
              <h3>Launch a space</h3>
              <p className="panel-sub">
                Pick a name, keep it public or private, and drop in a background vibe.
              </p>
            </div>
            <div className="form-grid group-form">
              <input
                className="auth-input"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
              />
              <textarea
                className="auth-input"
                rows={3}
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="Short description (optional)"
              />
              <div className="group-toggle-row">
                <label className="group-toggle">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === "public"}
                    onChange={() => setVisibility("public")}
                  />
                  <span>Public</span>
                </label>
                <label className="group-toggle">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === "private"}
                    onChange={() => setVisibility("private")}
                  />
                  <span>Private</span>
                </label>
              </div>
              <div className="group-toggle-row">
                <label className="group-toggle">
                  <input
                    type="checkbox"
                    checked={useGradient}
                    onChange={() => setUseGradient((prev) => !prev)}
                  />
                  <span>Use gradient</span>
                </label>
                <label className="group-toggle">
                  <input
                    type="checkbox"
                    checked={useImage}
                    onChange={() => setUseImage((prev) => !prev)}
                  />
                  <span>Use image</span>
                </label>
              </div>
              {useGradient && (
                <div className="group-gradient-row">
                  <label>
                    <span>Start</span>
                    <input
                      type="color"
                      value={gradientStart}
                      onChange={(e) => setGradientStart(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>End</span>
                    <input
                      type="color"
                      value={gradientEnd}
                      onChange={(e) => setGradientEnd(e.target.value)}
                    />
                  </label>
                  <label className="group-angle">
                    <span>Angle</span>
                    <input
                      type="range"
                      min={0}
                      max={180}
                      value={gradientAngle}
                      onChange={(e) => setGradientAngle(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              {useImage && (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    setBackgroundFile(e.target.files?.[0] ? e.target.files[0] : null)
                  }
                />
              )}
              {createStatus && <div className="status">{createStatus}</div>}
              <button
                className="btn primary"
                type="button"
                onClick={handleCreateGroup}
                disabled={creating}
              >
                {creating ? "Creating..." : "Create group"}
              </button>
            </div>
          </section>

          <section className="panel group-invite-panel">
            <div className="panel-header">
              <p className="eyebrow">Invites</p>
              <h3>Pending invites</h3>
              <p className="panel-sub">Tap to accept and join the vibe.</p>
            </div>
            {invites.length === 0 && <p className="status">No invites yet.</p>}
            <div className="group-invite-list">
              {invites.map((invite) => (
                <div className="group-invite-card" key={invite.id}>
                  <div>
                    <strong>{invite.group.name}</strong>
                    <p className="group-invite-meta">
                      Invited by {invite.inviterName}
                    </p>
                  </div>
                  <div className="group-invite-actions">
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => handleDeclineInvite(invite.id)}
                    >
                      Decline
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => handleAcceptInvite(invite.id)}
                    >
                      Join
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel group-update-panel">
            <div className="panel-header">
              <p className="eyebrow">Updates</p>
              <h3>Fresh activity</h3>
              <p className="panel-sub">Quick hits from the crews you follow.</p>
            </div>
            {updates.length === 0 && <p className="status">No new updates yet.</p>}
            <div className="group-update-list">
              {updates.map((update) => (
                <button
                  key={update.id}
                  className="group-update-card"
                  type="button"
                  onClick={() => {
                    if (update.group) {
                      navigate(`/groups/${update.group.documentId ?? update.group.id}`);
                    }
                  }}
                >
                  <div className="group-update-meta">
                    <strong>{update.group?.name || "Group update"}</strong>
                    <span>{formatTime(update.createdAt)}</span>
                  </div>
                  <p>{update.message}</p>
                </button>
              ))}
            </div>
          </section>
        </div>

        <section className="group-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">My groups</p>
              <h3>Spaces you manage or follow</h3>
            </div>
          </div>
          <div className="group-card-grid">
            {myGroups.map((group) => (
              <div
                key={group.id}
                className="group-card"
                style={buildGroupStyle(group)}
              >
                <div className="group-card__overlay" />
                <div className="group-card__content">
                  <div className="group-card__tags">
                    <span className="pill">{group.visibility}</span>
                    {group.role && <span className="pill subtle">{group.role}</span>}
                  </div>
                  <h4>{group.name}</h4>
                  <p>{group.description || "No description yet."}</p>
                </div>
                <div className="group-card__actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() =>
                      navigate(`/groups/${group.documentId ?? group.id}`)
                    }
                  >
                    Open group
                  </button>
                </div>
              </div>
            ))}
            {myGroups.length === 0 && !loading && (
              <p className="status">You have not joined any groups yet.</p>
            )}
          </div>
        </section>

        <section className="group-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">Discover</p>
              <h3>Public groups you can join</h3>
            </div>
          </div>
          <div className="group-card-grid">
            {publicGroups.map((group) => (
              <div
                key={group.id}
                className="group-card"
                style={buildGroupStyle(group)}
              >
                <div className="group-card__overlay" />
                <div className="group-card__content">
                  <div className="group-card__tags">
                    <span className="pill">public</span>
                  </div>
                  <h4>{group.name}</h4>
                  <p>{group.description || "Open invite, fresh energy."}</p>
                </div>
                <div className="group-card__actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() =>
                      navigate(`/groups/${group.documentId ?? group.id}`)
                    }
                  >
                    Preview
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => handleJoinGroup(group)}
                  >
                    Join
                  </button>
                </div>
              </div>
            ))}
            {publicGroups.length === 0 && !loading && (
              <p className="status">No public groups to explore yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

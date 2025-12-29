import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../css/dashboard.css";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";

type GroupDetail = {
  id: number | string;
  documentId?: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  backgroundImage?: string;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
  ownerName?: string;
  ownerId?: number;
};

type GroupMember = {
  id: number | string;
  userId: number;
  name: string;
  role: "admin" | "member";
};

type GroupInvite = {
  id: number | string;
  inviteeName: string;
};

type GroupPost = {
  id: number | string;
  title?: string;
  body?: string;
  mediaUrls: string[];
  createdAt?: string;
  ownerName?: string;
  ownerId?: number;
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

const pickMediaUrls = (mediaField: any): string[] => {
  if (!mediaField) return [];
  const items =
    (Array.isArray(mediaField?.data) ? mediaField.data : mediaField?.data) ??
    (Array.isArray(mediaField) ? mediaField : []);
  if (!Array.isArray(items)) return [];
  return items
    .map((entry: any) => pickMediaUrl(entry))
    .filter((url: any) => typeof url === "string");
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

const buildGroupStyle = (group: GroupDetail) => {
  const hasGradient = Boolean(group.gradientStart || group.gradientEnd);
  const angle = Number.isFinite(group.gradientAngle || 0) ? group.gradientAngle : 135;
  const gradient = hasGradient
    ? `linear-gradient(${angle}deg, ${hexToRgba(
        group.gradientStart || "#2563eb",
        0.75
      )}, ${hexToRgba(group.gradientEnd || "#22d3ee", 0.75)})`
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

const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov)$/i.test(value);

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  usePageMeta({
    title: "Group | Stick2YourDreams Connect",
    description: "Share updates, media, and momentum with your group.",
  });

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [myRole, setMyRole] = useState<"admin" | "member" | null>(null);
  const [myMembershipId, setMyMembershipId] = useState<number | string | null>(null);
  const [pendingInviteId, setPendingInviteId] = useState<number | string | null>(null);

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postFiles, setPostFiles] = useState<File[]>([]);
  const [postStatus, setPostStatus] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [settingsName, setSettingsName] = useState("");
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsVisibility, setSettingsVisibility] = useState<"public" | "private">("private");
  const [settingsUseGradient, setSettingsUseGradient] = useState(true);
  const [settingsGradientStart, setSettingsGradientStart] = useState("#2563eb");
  const [settingsGradientEnd, setSettingsGradientEnd] = useState("#22d3ee");
  const [settingsGradientAngle, setSettingsGradientAngle] = useState(135);
  const [settingsUseImage, setSettingsUseImage] = useState(false);
  const [settingsImageFile, setSettingsImageFile] = useState<File | null>(null);
  const [settingsPreviewImageUrl, setSettingsPreviewImageUrl] = useState<string | null>(null);
  const [settingsClearImage, setSettingsClearImage] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const mapGroup = useCallback((entry: any): GroupDetail => {
    const attrs = normalize(entry);
    const ownerEntry = getEntity(attrs.owner);
    const ownerAttrs = normalize(ownerEntry);
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
      ownerName: ownerAttrs.username || ownerAttrs.email || "",
      ownerId: ownerEntry?.id ?? ownerAttrs.id,
    };
  }, []);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const groupRes = await api.get(
        `/groups/${groupId}?populate=backgroundImage&populate=owner`
      );
      const groupEntry = groupRes.data?.data ?? groupRes.data;
      if (!groupEntry) {
        setError("Group not found.");
        return;
      }
      const detail = mapGroup(groupEntry);
      const groupNumericId = groupEntry.id ?? detail.id;

      const [myMemberRes, membersRes, postsRes, inviteRes, adminInviteRes] = await Promise.all([
        user?.id
          ? api.get(
              `/group-members?filters[group][id][$eq]=${groupNumericId}` +
                `&filters[user][id][$eq]=${user.id}&pagination[pageSize]=1`
            )
          : Promise.resolve({ data: { data: [] } }),
        api
          .get(
            `/group-members?filters[group][id][$eq]=${groupNumericId}` +
              `&populate=user&pagination[pageSize]=200`
          )
          .catch(() => ({ data: { data: [] } })),
        api
          .get(
            `/group-posts?filters[group][id][$eq]=${groupNumericId}` +
              `&populate=media&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => ({ data: { data: [] } })),
        user?.id
          ? api
              .get(
                `/group-invites?filters[group][id][$eq]=${groupNumericId}` +
                  `&filters[invitee][id][$eq]=${user.id}` +
                  `&filters[status][$eq]=pending&pagination[pageSize]=1`
              )
              .catch(() => ({ data: { data: [] } }))
          : Promise.resolve({ data: { data: [] } }),
        api
          .get(
            `/group-invites?filters[group][id][$eq]=${groupNumericId}` +
              `&filters[status][$eq]=pending&populate=invitee&pagination[pageSize]=200`
          )
          .catch(() => ({ data: { data: [] } })),
      ]);

      const memberEntry = myMemberRes.data?.data?.[0];
      const memberAttrs = normalize(memberEntry);
      const role = memberAttrs?.role === "admin" ? "admin" : memberAttrs?.role === "member" ? "member" : null;

      setMyRole(role);
      setMyMembershipId(memberEntry?.id ?? null);
      setPendingInviteId(inviteRes.data?.data?.[0]?.id ?? null);

      const membersList: GroupMember[] = (membersRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const userEntry = getEntity(attrs.user);
          const userAttrs = normalize(userEntry);
          return {
            id: entry.id ?? attrs.documentId,
            userId: userEntry?.id ?? userAttrs.id,
            name: userAttrs.username || userAttrs.email || "Member",
            role: attrs.role === "admin" ? "admin" : "member",
          };
        })
        .filter((entry: GroupMember) => entry.userId) as GroupMember[];

      const postList: GroupPost[] = (postsRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const ownerEntry = getEntity(attrs.owner);
          const ownerAttrs = normalize(ownerEntry);
          return {
            id: entry.id ?? attrs.documentId,
            title: attrs.title || "",
            body: attrs.body || "",
            mediaUrls: pickMediaUrls(attrs.media),
            createdAt: attrs.createdAt,
            ownerName: ownerAttrs.username || ownerAttrs.email || "Member",
            ownerId: ownerEntry?.id ?? ownerAttrs.id,
          };
        })
        .filter(Boolean) as GroupPost[];

      setGroup(detail);
      setMembers(membersList);
      setPosts(postList);

      const inviteList: GroupInvite[] = (adminInviteRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const inviteeEntry = getEntity(attrs.invitee);
          const inviteeAttrs = normalize(inviteeEntry);
          return {
            id: entry.id ?? attrs.documentId,
            inviteeName: inviteeAttrs.username || inviteeAttrs.email || "Invitee",
          };
        })
        .filter((entry: GroupInvite) => entry.inviteeName);
      setInvites(role === "admin" ? inviteList : []);

      setSettingsName(detail.name);
      setSettingsDescription(detail.description || "");
      setSettingsVisibility(detail.visibility);
      const hasGradient = Boolean(detail.gradientStart || detail.gradientEnd);
      setSettingsUseGradient(hasGradient);
      setSettingsGradientStart(detail.gradientStart || "#2563eb");
      setSettingsGradientEnd(detail.gradientEnd || "#22d3ee");
      setSettingsGradientAngle(detail.gradientAngle ?? 135);
      setSettingsUseImage(Boolean(detail.backgroundImage));
      setSettingsImageFile(null);
      setSettingsClearImage(false);
    } catch {
      setError("Unable to load this group.");
    } finally {
      setLoading(false);
    }
  }, [groupId, mapGroup, user?.id]);

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    if (!settingsImageFile) {
      setSettingsPreviewImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(settingsImageFile);
    setSettingsPreviewImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [settingsImageFile]);

  const handleJoinGroup = async () => {
    if (!group) return;
    try {
      await api.post("/group-members", { data: { group: group.id } });
      await loadGroup();
    } catch {
      setError("Unable to join this group.");
    }
  };

  const handleAcceptInvite = async () => {
    if (!pendingInviteId) return;
    try {
      await api.put(`/group-invites/${pendingInviteId}`, { data: { status: "accepted" } });
      await loadGroup();
    } catch {
      setError("Unable to accept invite.");
    }
  };

  const handleDeclineInvite = async () => {
    if (!pendingInviteId) return;
    try {
      await api.put(`/group-invites/${pendingInviteId}`, { data: { status: "declined" } });
      setPendingInviteId(null);
    } catch {
      setError("Unable to decline invite.");
    }
  };

  const handleInviteMember = async () => {
    if (!group || !inviteIdentifier.trim()) {
      setInviteStatus("Enter a username or email.");
      return;
    }
    setInviting(true);
    setInviteStatus(null);
    try {
      await api.post("/group-invites", {
        data: { group: group.id, identifier: inviteIdentifier.trim() },
      });
      setInviteIdentifier("");
      setInviteStatus("Invite sent.");
      await loadGroup();
    } catch {
      setInviteStatus("Unable to send invite.");
    } finally {
      setInviting(false);
    }
  };

  const handleCreatePost = async () => {
    if (!group) return;
    const body = postBody.trim();
    if (!body && postFiles.length === 0) {
      setPostStatus("Add a message or media.");
      return;
    }
    setPosting(true);
    setPostStatus(null);
    try {
      let mediaIds: number[] = [];
      if (postFiles.length) {
        const fd = new FormData();
        postFiles.forEach((file) => fd.append("files", file));
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        mediaIds = (uploadRes.data ?? []).map((item: any) => item?.id).filter(Boolean);
      }

      await api.post("/group-posts", {
        data: {
          title: postTitle.trim(),
          body,
          media: mediaIds.length ? mediaIds : undefined,
          group: group.id,
        },
      });
      setPostTitle("");
      setPostBody("");
      setPostFiles([]);
      await loadGroup();
    } catch {
      setPostStatus("Unable to post right now.");
    } finally {
      setPosting(false);
    }
  };

  const handleRemovePost = async (postId: number | string) => {
    try {
      await api.delete(`/group-posts/${postId}`);
      await loadGroup();
    } catch {
      setError("Unable to delete post.");
    }
  };

  const handleRoleChange = async (memberId: number | string, role: "admin" | "member") => {
    try {
      await api.put(`/group-members/${memberId}`, { data: { role } });
      await loadGroup();
    } catch {
      setError("Unable to update role.");
    }
  };

  const handleRemoveMember = async (memberId: number | string) => {
    try {
      await api.delete(`/group-members/${memberId}`);
      await loadGroup();
    } catch {
      setError("Unable to remove member.");
    }
  };

  const handleLeaveGroup = async () => {
    if (!myMembershipId) return;
    try {
      await api.delete(`/group-members/${myMembershipId}`);
      navigate("/groups");
    } catch {
      setError("Unable to leave group.");
    }
  };

  const handleSaveSettings = async () => {
    if (!group) return;
    setSavingSettings(true);
    setSettingsStatus(null);
    try {
      let backgroundId: number | undefined;
      if (settingsUseImage && settingsImageFile) {
        const fd = new FormData();
        fd.append("files", settingsImageFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        backgroundId = uploadRes.data?.[0]?.id;
      }

      const payload: any = {
        name: settingsName.trim(),
        description: settingsDescription.trim(),
        visibility: settingsVisibility,
      };
      if (settingsUseGradient) {
        payload.gradientStart = settingsGradientStart;
        payload.gradientEnd = settingsGradientEnd;
        payload.gradientAngle = settingsGradientAngle;
      } else {
        payload.gradientStart = null;
        payload.gradientEnd = null;
        payload.gradientAngle = null;
      }

      if (backgroundId) payload.backgroundImage = backgroundId;
      if (settingsClearImage) payload.backgroundImage = null;

      await api.put(`/groups/${group.documentId ?? group.id}`, { data: payload });
      setSettingsStatus("Group updated.");
      setSettingsImageFile(null);
      setSettingsClearImage(false);
      await loadGroup();
    } catch {
      setSettingsStatus("Unable to update group.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!group) return;
    const confirmed = window.confirm(
      "Delete this group? This will remove posts and members."
    );
    if (!confirmed) return;
    try {
      await api.delete(`/groups/${group.documentId ?? group.id}`);
      navigate("/groups");
    } catch {
      setError("Unable to delete group.");
    }
  };

  const settingsPreview: GroupDetail | null = useMemo(() => {
    if (!group) return null;
    return {
      ...group,
      name: settingsName || group.name,
      description: settingsDescription || group.description,
      visibility: settingsVisibility,
      gradientStart: settingsUseGradient ? settingsGradientStart : "",
      gradientEnd: settingsUseGradient ? settingsGradientEnd : "",
      gradientAngle: settingsUseGradient ? settingsGradientAngle : group.gradientAngle,
      backgroundImage:
        settingsUseImage && settingsPreviewImageUrl
          ? settingsPreviewImageUrl
          : settingsUseImage
          ? group.backgroundImage
          : undefined,
    };
  }, [
    group,
    settingsName,
    settingsDescription,
    settingsVisibility,
    settingsUseGradient,
    settingsGradientStart,
    settingsGradientEnd,
    settingsGradientAngle,
    settingsUseImage,
    settingsPreviewImageUrl,
  ]);

  if (loading) {
    return (
      <div className="dashboard-shell">
        <Sidebar active="groups" />
        <div className="main-content">
          <p className="status">Loading group...</p>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="dashboard-shell">
        <Sidebar active="groups" />
        <div className="main-content">
          <p className="status status-error">{error || "Group not found."}</p>
          <button className="btn ghost" type="button" onClick={() => navigate("/groups")}>
            Back to groups
          </button>
        </div>
      </div>
    );
  }

  const canPost = myRole === "admin" || myRole === "member";
  const isAdmin = myRole === "admin";
  const isPrivateLocked = group.visibility === "private" && !myRole;
  const memberLabel = isPrivateLocked
    ? "Invite-only list"
    : `${members.length} member${members.length === 1 ? "" : "s"}`;

  return (
    <div className="dashboard-shell">
      <Sidebar active="groups" />
      <div className="main-content group-shell">
        <div className="group-detail-hero" style={buildGroupStyle(group)}>
          <div className="group-detail-hero__overlay" />
          <div className="group-detail-hero__content">
            <div className="group-detail-hero__meta">
              <span className="pill">{group.visibility}</span>
              {myRole && <span className="pill subtle">{myRole}</span>}
            </div>
            <h1>{group.name}</h1>
            <p>{group.description || "A focused space to build momentum."}</p>
            <div className="group-detail-hero__actions">
              <button className="btn ghost" type="button" onClick={() => navigate("/groups")}>
                Back
              </button>
              {!myRole && group.visibility === "public" && (
                <button className="btn primary" type="button" onClick={handleJoinGroup}>
                  Join group
                </button>
              )}
              {!myRole && group.visibility === "private" && pendingInviteId && (
                <div className="group-invite-actions">
                  <button className="btn ghost" type="button" onClick={handleDeclineInvite}>
                    Decline
                  </button>
                  <button className="btn primary" type="button" onClick={handleAcceptInvite}>
                    Accept invite
                  </button>
                </div>
              )}
              {!myRole && group.visibility === "private" && !pendingInviteId && (
                <span className="group-private-note">Invite-only group</span>
              )}
              {myRole && (
                <button className="btn ghost" type="button" onClick={handleLeaveGroup}>
                  Leave group
                </button>
              )}
            </div>
          </div>
        </div>

        <TopbarSearch />

        {error && <p className="status status-error">{error}</p>}

        <div className="panel-grid">
          {canPost && (
            <section className="panel group-post-panel">
              <div className="panel-header">
                <p className="eyebrow">New post</p>
                <h3>Share the momentum</h3>
                <p className="panel-sub">Drop a message, photo, or video update.</p>
              </div>
              <div className="form-grid">
                <input
                  className="auth-input"
                  type="text"
                  placeholder="Title (optional)"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                />
                <textarea
                  className="auth-input"
                  rows={4}
                  placeholder="What is the update?"
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                />
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => setPostFiles(Array.from(e.target.files ?? []))}
                />
                {postStatus && <div className="status">{postStatus}</div>}
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleCreatePost}
                  disabled={posting}
                >
                  {posting ? "Posting..." : "Post to group"}
                </button>
              </div>
            </section>
          )}

          <section className="panel group-member-panel">
            <div className="panel-header">
              <p className="eyebrow">Members</p>
              <h3>People in this group</h3>
              <p className="panel-sub">{memberLabel}</p>
            </div>
            {isPrivateLocked ? (
              <p className="status">Invite-only members list.</p>
            ) : (
              <div className="group-member-list">
                {members.map((member) => (
                  <div key={member.id} className="group-member-row">
                    <div>
                      <strong>{member.name}</strong>
                      <span className="group-member-role">{member.role}</span>
                    </div>
                    {isAdmin && (
                      <div className="group-member-actions">
                        <select
                          className="group-role-select"
                          value={member.role}
                          onChange={(e) =>
                            handleRoleChange(
                              member.id,
                              e.target.value === "admin" ? "admin" : "member"
                            )
                          }
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => handleRemoveMember(member.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin && (
            <section className="panel group-invite-admin">
              <div className="panel-header">
                <p className="eyebrow">Invite</p>
                <h3>Add members</h3>
                <p className="panel-sub">Invite by username or email.</p>
              </div>
              <div className="form-grid">
                <input
                  className="auth-input"
                  type="text"
                  value={inviteIdentifier}
                  onChange={(e) => setInviteIdentifier(e.target.value)}
                  placeholder="username or email"
                />
                {inviteStatus && <div className="status">{inviteStatus}</div>}
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleInviteMember}
                  disabled={inviting}
                >
                  {inviting ? "Sending..." : "Send invite"}
                </button>
              </div>
              {invites.length > 0 && (
                <div className="group-invite-pending">
                  <strong>Pending invites</strong>
                  {invites.map((invite) => (
                    <div key={invite.id} className="group-invite-pill">
                      {invite.inviteeName}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <section className="group-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">Posts</p>
              <h3>Latest updates</h3>
            </div>
          </div>
          {isPrivateLocked ? (
            <p className="status">Accept your invite to see private posts.</p>
          ) : (
            <div className="group-post-grid">
              {posts.map((post) => (
                <div key={post.id} className="group-post-card">
                  <div className="group-post-header">
                    <div>
                      <strong>{post.ownerName}</strong>
                      <span className="group-post-time">{formatTime(post.createdAt)}</span>
                    </div>
                    {(isAdmin || post.ownerId === user?.id) && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => handleRemovePost(post.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {post.title && <h4>{post.title}</h4>}
                  {post.body && <p>{post.body}</p>}
                  {post.mediaUrls.length > 0 && (
                    <div className="group-post-media">
                      {post.mediaUrls.map((url) =>
                        isVideoUrl(url) ? (
                          <video key={url} src={url} controls />
                        ) : (
                          <img key={url} src={url} alt="Group post media" loading="lazy" />
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
              {posts.length === 0 && <p className="status">No posts yet.</p>}
            </div>
          )}
        </section>

        {isAdmin && settingsPreview && (
          <section className="group-section">
            <div className="group-section-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h3>Group look and feel</h3>
              </div>
            </div>
            <div className="panel-grid">
              <section className="panel group-settings-panel">
                <div className="form-grid">
                  <input
                    className="auth-input"
                    type="text"
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    placeholder="Group name"
                  />
                  <textarea
                    className="auth-input"
                    rows={3}
                    value={settingsDescription}
                    onChange={(e) => setSettingsDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <div className="group-toggle-row">
                    <label className="group-toggle">
                      <input
                        type="radio"
                        name="group-visibility"
                        checked={settingsVisibility === "public"}
                        onChange={() => setSettingsVisibility("public")}
                      />
                      <span>Public</span>
                    </label>
                    <label className="group-toggle">
                      <input
                        type="radio"
                        name="group-visibility"
                        checked={settingsVisibility === "private"}
                        onChange={() => setSettingsVisibility("private")}
                      />
                      <span>Private</span>
                    </label>
                  </div>
                  <div className="group-toggle-row">
                    <label className="group-toggle">
                      <input
                        type="checkbox"
                        checked={settingsUseGradient}
                        onChange={() => setSettingsUseGradient((prev) => !prev)}
                      />
                      <span>Use gradient</span>
                    </label>
                    <label className="group-toggle">
                      <input
                        type="checkbox"
                        checked={settingsUseImage}
                        onChange={() => setSettingsUseImage((prev) => !prev)}
                      />
                      <span>Use image</span>
                    </label>
                  </div>
                  {settingsUseGradient && (
                    <div className="group-gradient-row">
                      <label>
                        <span>Start</span>
                        <input
                          type="color"
                          value={settingsGradientStart}
                          onChange={(e) => setSettingsGradientStart(e.target.value)}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          type="color"
                          value={settingsGradientEnd}
                          onChange={(e) => setSettingsGradientEnd(e.target.value)}
                        />
                      </label>
                      <label className="group-angle">
                        <span>Angle</span>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          value={settingsGradientAngle}
                          onChange={(e) => setSettingsGradientAngle(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  )}
                  {settingsUseImage && (
                    <div className="group-image-row">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setSettingsImageFile(e.target.files?.[0] ? e.target.files[0] : null)
                        }
                      />
                      {group.backgroundImage && (
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => setSettingsClearImage(true)}
                        >
                          Remove current image
                        </button>
                      )}
                    </div>
                  )}
                  {settingsStatus && <div className="status">{settingsStatus}</div>}
                  <button
                    className="btn primary"
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                  >
                    {savingSettings ? "Saving..." : "Save settings"}
                  </button>
                  <button
                    className="btn ghost group-danger"
                    type="button"
                    onClick={handleDeleteGroup}
                  >
                    Delete group
                  </button>
                </div>
              </section>
              <section className="panel group-settings-preview">
                <div className="group-settings-preview__card" style={buildGroupStyle(settingsPreview)}>
                  <div className="group-settings-preview__content">
                    <span className="pill">{settingsVisibility}</span>
                    <h3>{settingsPreview.name}</h3>
                    <p>{settingsPreview.description || "Describe the vibe."}</p>
                  </div>
                </div>
              </section>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";

type DirectoryProfile = {
  id: number | string;
  userId?: number;
  handle?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
};

type FriendRelation = {
  requesterId?: number;
  targetId?: number;
  status?: string;
};

type TopbarSearchProps = {
  value?: string;
  onChange?: (value: string) => void;
};

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityAttrs = (entry: any) => {
  const data = getEntity(entry);
  return data?.attributes ?? data ?? {};
};
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};
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

export default function TopbarSearch({ value, onChange }: TopbarSearchProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState(value ?? "");
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [relations, setRelations] = useState<FriendRelation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (value === undefined) return;
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profilesRes, friendsRes] = await Promise.all([
          api.get("/profiles?populate[0]=user&populate[1]=avatar"),
          api.get(
            `/friends?filters[$or][0][requester][id][$eq]=${user.id}` +
              `&filters[$or][1][target][id][$eq]=${user.id}` +
              `&populate=requester&populate=target&pagination[pageSize]=200`
          ),
        ]);

        if (!active) return;
        const mappedProfiles: DirectoryProfile[] = (profilesRes.data?.data ?? []).map(
          (p: any) => {
            const attrs = normalize(p);
            const userAttrs = getEntityAttrs(attrs.user);
            const userId = getEntityId(attrs.user);
            return {
              id: p.id ?? attrs.documentId,
              userId,
              username: userAttrs?.username,
              handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
              firstName: attrs.firstName || "",
              lastName: attrs.lastName || "",
              avatarUrl: pickMediaUrl(attrs.avatar),
            };
          }
        );
        setProfiles(mappedProfiles);

        const mappedRelations: FriendRelation[] = (friendsRes.data?.data ?? []).map((f: any) => {
          const attrs = normalize(f);
          return {
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
            status: attrs.status || "pending",
          };
        });
        setRelations(mappedRelations);
      } catch {
        if (active) setError("Unable to load directory.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const updateQuery = (next: string) => {
    if (onChange) onChange(next);
    if (value === undefined) setQuery(next);
    setOpen(Boolean(next.trim()));
  };

  const relationStatusFor = (profileUserId?: number) => {
    if (!profileUserId || !relations.length) return null;
    const match = relations.find(
      (f) =>
        (f.requesterId === user?.id && f.targetId === profileUserId) ||
        (f.targetId === user?.id && f.requesterId === profileUserId)
    );
    return match?.status ?? null;
  };

  const requestFriend = async (profile: DirectoryProfile) => {
    if (!user || !profile.userId || profile.userId === user.id) return;
    const status = relationStatusFor(profile.userId);
    if (status === "pending" || status === "accepted") return;
    try {
      setBusyId(profile.userId);
      await api.post("/friends", {
        data: {
          target: profile.userId,
          status: "pending",
          locale: "en",
        },
      });
      setRelations((prev) => [
        ...prev,
        { requesterId: user.id, targetId: profile.userId, status: "pending" },
      ]);
    } catch {
      setError("Unable to send request.");
    } finally {
      setBusyId(null);
    }
  };

  const activeQuery = (value ?? query).trim().toLowerCase();
  const results = useMemo(() => {
    if (!activeQuery) return [];
    return profiles
      .filter((p) => p.userId && p.userId !== user?.id)
      .filter((p) => {
        const handle = (p.handle || "").toLowerCase();
        const username = (p.username || "").toLowerCase();
        const first = (p.firstName || "").toLowerCase();
        const last = (p.lastName || "").toLowerCase();
        const full = `${first} ${last}`.trim();
        return (
          handle.includes(activeQuery) ||
          username.includes(activeQuery) ||
          first.includes(activeQuery) ||
          last.includes(activeQuery) ||
          full.includes(activeQuery)
        );
      })
      .slice(0, 6);
  }, [activeQuery, profiles, user?.id]);

  if (!user) return null;

  return (
    <div className="topbar" ref={wrapperRef}>
      <div className="topbar-inner">
        <div className="topbar-search">
          <input
            type="text"
            value={value ?? query}
            onChange={(e) => updateQuery(e.target.value)}
            onFocus={() => setOpen(Boolean((value ?? query).trim()))}
            placeholder="Find you friends by Name or Handle"
            aria-label="Search by handle or name"
          />
          {open && (
            <div className="topbar-results">
              {loading && <div className="topbar-status">Loading directory...</div>}
              {error && <div className="topbar-status">{error}</div>}
              {!loading && !error && results.length === 0 && (
                <div className="topbar-status">No matches found.</div>
              )}
              {!loading &&
                !error &&
                results.map((profile) => {
                  const status = relationStatusFor(profile.userId);
                  const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
                  return (
                    <div className="topbar-result" key={profile.id}>
                      {profile.avatarUrl ? (
                        <img
                          src={profile.avatarUrl}
                          alt={profile.handle || profile.username || "Profile"}
                          className="topbar-avatar"
                          loading="lazy"
                        />
                      ) : (
                        <div className="topbar-avatar fallback" aria-hidden="true">
                          {(profile.handle || profile.username || "U").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="topbar-result-meta">
                        <strong>{fullName || profile.handle || profile.username || "User"}</strong>
                        <span>@{profile.handle || profile.username || "user"}</span>
                      </div>
                      <div className="topbar-result-actions">
                        {status === "accepted" ? (
                          <span className="topbar-chip">Friends</span>
                        ) : status === "pending" ? (
                          <span className="topbar-chip">Requested</span>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost topbar-add"
                            onClick={() => requestFriend(profile)}
                            disabled={busyId === profile.userId}
                          >
                            {busyId === profile.userId ? "Sending..." : "Add"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

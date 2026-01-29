import { useEffect, useMemo, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useVideoCall, type VideoCallInvitee } from "../context/VideoCallContext";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  ensureProfileKeyShares,
  type ProfilePayload,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";

type UseVideoInviteesState = {
  friends: VideoCallInvitee[];
  loading: boolean;
  error: string | null;
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

const getDisplayName = (handle?: string, firstName?: string, lastName?: string) => {
  const name = `${firstName || ""} ${lastName || ""}`.trim();
  return name || (handle ? `@${handle}` : "Friend");
};

export const useVideoInvitees = (): UseVideoInviteesState => {
  const { user } = useAuth();
  const { setPresenceTargets } = useVideoCall();
  const [friends, setFriends] = useState<VideoCallInvitee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setFriends([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    const loadFriends = async () => {
      setLoading(true);
      setError(null);
      try {
        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target&pagination[pageSize]=200`
        );
        const acceptedIds = new Set<number>();
        (friendsRes.data?.data ?? []).forEach((relation: any) => {
          const attrs = normalize(relation);
          if (attrs.status !== "accepted") return;
          const requesterId = getEntityId(attrs.requester);
          const targetId = getEntityId(attrs.target);
          const friendId = requesterId === user.id ? targetId : requesterId;
          if (friendId) acceptedIds.add(friendId);
        });

        const friendIds = Array.from(acceptedIds);
        if (!friendIds.length) {
          if (active) setFriends([]);
          return;
        }

        const filter = friendIds
          .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");

        await ensureProfileKeyShares(user.id, friendIds);

        const profilesRes = await api.get(
          `/profiles?${filter}&populate=avatar&populate=user&pagination[pageSize]=200`
        );

        const mapped = await Promise.all(
          (profilesRes.data?.data ?? []).map(async (p: any) => {
            const attrs = normalize(p);
            const userAttrs = getEntityAttrs(attrs.user);
            const friendUserId = getEntityId(attrs.user);
            if (!friendUserId) return null;

            let payload: ProfilePayload | null = null;
            if (attrs.encryptedProfile) {
              try {
                payload = await decryptFriendProfilePayload(
                  friendUserId,
                  user.id,
                  attrs.encryptedProfile
                );
              } catch {
                payload = null;
              }
            }
            if (!payload) {
              payload = buildProfilePayloadFromAttrs(attrs);
            }

            const handle = attrs.handle || userAttrs?.email || "";
            return {
              userId: friendUserId,
              displayName: getDisplayName(handle, payload.firstName, payload.lastName),
              handle,
              avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
            } as VideoCallInvitee;
          })
        );

        const filtered = mapped.filter(Boolean) as VideoCallInvitee[];
        filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (active) setFriends(filtered);
      } catch {
        if (active) setError("Unable to load friends right now.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadFriends();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const presenceTargets = useMemo(
    () =>
      friends
        .map((friend) => friend.userId)
        .filter((id): id is number => Number.isFinite(id)),
    [friends]
  );

  useEffect(() => {
    if (!user?.id) {
      setPresenceTargets([]);
      return;
    }
    setPresenceTargets(presenceTargets);
  }, [presenceTargets, setPresenceTargets, user?.id]);

  return { friends, loading, error };
};

import { useMemo } from "react";
import { Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AvatarImage from "./AvatarImage";
import { useVideoCall } from "../context/VideoCallContext";
import { useVideoInvitees } from "../hooks/useVideoInvitees";
import RightSidebarShell from "./RightSidebarShell";

const firstInitial = (value: string) => String(value || "").trim().charAt(0).toUpperCase() || "F";

export default function RightFriendsSidebar(): JSX.Element | null {
  const navigate = useNavigate();
  const { friends, loading, error } = useVideoInvitees();
  const { onlineUserIds } = useVideoCall();

  const onlineIdSet = useMemo(
    () =>
      new Set(
        Array.from(onlineUserIds).filter((id): id is number => Number.isFinite(Number(id)))
      ),
    [onlineUserIds]
  );

  const sidebarFriends = useMemo(() => friends.slice(0, 40), [friends]);

  return (
    <RightSidebarShell
      ariaLabel="Current friends sidebar"
      headTitle="Current friends"
      headSubtitle={`${friends.length} connected`}
      headIcon={<Users size={18} />}
      headTooltip="Current friends"
      onHeadClick={() => navigate("/friends")}
    >
      {loading ? (
        <p className="status">Loading friends...</p>
      ) : error ? (
        <p className="status status-error">{error}</p>
      ) : !sidebarFriends.length ? (
        <p className="status">No friends yet.</p>
      ) : (
        <ul className="right-friends-list">
          {sidebarFriends.map((friend) => {
            const isOnline = onlineIdSet.has(friend.userId);
            return (
              <li key={friend.userId} className="right-friends-item">
                <button
                  type="button"
                  className="right-friend-button"
                  onClick={() => navigate(`/friends/${friend.userId}`)}
                  data-right-tooltip={friend.displayName}
                  aria-label={friend.displayName}
                >
                  <span className="right-friend-avatar-wrap">
                    {friend.avatarUrl ? (
                      <AvatarImage
                        src={friend.avatarUrl}
                        alt={friend.displayName}
                        className="right-friend-avatar"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="right-friend-avatar right-friend-avatar--fallback">
                        {firstInitial(friend.displayName)}
                      </span>
                    )}
                    <span
                      className={`right-friend-presence${isOnline ? " is-online" : ""}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="right-friend-copy">
                    <strong>{friend.displayName}</strong>
                    <span>{friend.handle ? `@${friend.handle}` : "Friend"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </RightSidebarShell>
  );
}

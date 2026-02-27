import { useState } from "react";
import UserMenuDrawer from "./UserMenuDrawer";

export default function UserMenuDrawerExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open Menu
      </button>

      <UserMenuDrawer
        open={open}
        onClose={() => setOpen(false)}
        onLogout={() => {
          // Replace with your auth logout routine.
          console.log("logout");
        }}
        user={{ name: "Jason Adams", avatarUrl: "/logo2.png" }}
        currentPath="/dashboard"
        notificationsCount={2}
        messagesCount={5}
        friendMessages={[
          {
            id: "ava",
            friendName: "Ava Thompson",
            preview: "Are you joining tonight's group call?",
            href: "/friends",
            unreadCount: 2,
          },
          {
            id: "liam",
            friendName: "Liam Carter",
            preview: "Sent you a new photo from the meetup.",
            href: "/friends",
            unreadCount: 1,
          },
        ]}
      />
    </>
  );
}

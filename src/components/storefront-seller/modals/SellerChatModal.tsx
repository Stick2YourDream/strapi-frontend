import type { ReactNode } from "react";
import PopupModal from "../../PopupModal";
import "../../../css/storefront-seller-modals/seller-chat-modal.css";

type SellerChatModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function SellerChatModal({
  open,
  onClose,
  children,
}: SellerChatModalProps) {
  return (
    <PopupModal
      open={open}
      title="Storefront chat"
      onClose={onClose}
      className="seller-chat-modal"
      bodyClassName="seller-chat-modal-body"
    >
      <div className="seller-chat-modal-content">{children}</div>
    </PopupModal>
  );
}

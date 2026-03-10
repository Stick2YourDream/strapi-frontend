import type { ReactNode } from "react";
import PopupModal from "../../PopupModal";
import "../../../css/storefront-seller-modals/seller-detail-modal.css";

type SellerDetailModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export default function SellerDetailModal({
  open,
  title,
  onClose,
  children,
}: SellerDetailModalProps) {
  return (
    <PopupModal
      open={open}
      title={title}
      onClose={onClose}
      className="seller-detail-modal"
      bodyClassName="seller-detail-modal-body"
    >
      {children}
    </PopupModal>
  );
}

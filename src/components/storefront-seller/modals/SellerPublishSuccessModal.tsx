import "../../../css/storefront-seller-modals/seller-publish-success-modal.css";

type SellerPublishSuccessModalProps = {
  message: string | null;
  onClose: () => void;
};

export default function SellerPublishSuccessModal({
  message,
  onClose,
}: SellerPublishSuccessModalProps) {
  if (!message) return null;

  return (
    <div
      className="storefront-success-overlay"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      onClick={onClose}
    >
      <div className="storefront-success-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{message}</h3>
        <p>
          {message.toLowerCase().includes("updated")
            ? "Your listing updates are now live on the StoreFront."
            : "Your listing is now live on the StoreFront."}
        </p>
        <button className="btn primary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

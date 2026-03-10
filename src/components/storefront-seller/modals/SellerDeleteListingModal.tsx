import "../../../css/storefront-seller-modals/seller-delete-listing-modal.css";

type SellerDeleteListingModalProps = {
  open: boolean;
  listingTitle?: string | null;
  error?: string | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function SellerDeleteListingModal({
  open,
  listingTitle,
  error,
  saving,
  onClose,
  onConfirm,
}: SellerDeleteListingModalProps) {
  if (!open) return null;

  return (
    <div
      className="storefront-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-listing-title"
      onClick={onClose}
    >
      <div
        className="storefront-modal storefront-modal--danger"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="storefront-modal-header">
          <p className="storefront-modal-eyebrow">Listing</p>
          <h3 id="delete-listing-title">Delete listing?</h3>
          <p className="storefront-modal-sub">
            Delete "{listingTitle || "this listing"}"? This action cannot be undone.
          </p>
        </div>
        {error && <p className="storefront-modal-error">{error}</p>}
        <div className="storefront-modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn danger" type="button" onClick={onConfirm} disabled={saving}>
            {saving ? "Deleting..." : "Delete listing"}
          </button>
        </div>
      </div>
    </div>
  );
}

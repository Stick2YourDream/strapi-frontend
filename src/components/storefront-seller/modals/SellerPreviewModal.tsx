import "../../../css/storefront-seller-modals/seller-preview-modal.css";

type PreviewImage = {
  id: string;
  url: string;
};

type PreviewItem = {
  id: string;
  title: string;
  price: string;
  condition: string;
  category: string;
  location: string;
  locationCity: string;
  locationState: string;
  visibility: "public" | "friends";
  images: PreviewImage[];
};

type SellerPreviewModalProps = {
  open: boolean;
  previewTitleId: string;
  previewTitle: string;
  previewSubtitle: string;
  previewError: string | null;
  previewMode: "single" | "bulk";
  previewItems: PreviewItem[];
  previewPublishLabel: string;
  isPublishing: boolean;
  formatPrice: (value: number) => string;
  formatLocationLabel: (city: string, state: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onDeleteSingle: () => void;
  onDeleteBulk: (itemId: string) => void;
  onChangeSinglePhotos: () => void;
  onChangeBulkPhotos: (itemId: string) => void;
  onRemoveSinglePhoto: (imageId: string) => void;
  onRemoveBulkPhoto: (itemId: string, imageId: string) => void;
  onPublish: () => void;
};

export default function SellerPreviewModal({
  open,
  previewTitleId,
  previewTitle,
  previewSubtitle,
  previewError,
  previewMode,
  previewItems,
  previewPublishLabel,
  isPublishing,
  formatPrice,
  formatLocationLabel,
  onClose,
  onEdit,
  onDeleteSingle,
  onDeleteBulk,
  onChangeSinglePhotos,
  onChangeBulkPhotos,
  onRemoveSinglePhoto,
  onRemoveBulkPhoto,
  onPublish,
}: SellerPreviewModalProps) {
  if (!open) return null;

  return (
    <div
      className="storefront-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={previewTitleId}
      onClick={onClose}
    >
      <div className="storefront-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="storefront-preview-header">
          <div>
            <p className="storefront-preview-eyebrow">Listing preview</p>
            <h3 id={previewTitleId}>{previewTitle}</h3>
            <p className="storefront-preview-sub">{previewSubtitle}</p>
          </div>
          <button className="btn ghost" type="button" onClick={onClose} disabled={isPublishing}>
            Close
          </button>
        </div>
        <div className="storefront-preview-body">
          {previewError && <p className="storefront-preview-alert">{previewError}</p>}
          <div className="storefront-preview-grid">
            {previewItems.map((item, index) => {
              const priceValue = Number(item.price);
              const priceNumber = Number.isFinite(priceValue) ? priceValue : 0;
              const locationLabel =
                item.location || formatLocationLabel(item.locationCity, item.locationState);
              const primaryImage = item.images[0]?.url;
              const isBulkPreview = previewMode === "bulk";
              return (
                <div key={item.id} className="storefront-preview-item">
                  <div className="storefront-preview-meta">
                    <span className="storefront-preview-label">Listing {index + 1}</span>
                  </div>
                  <div className="storefront-card storefront-preview-card">
                    <div className="storefront-card-image">
                      {primaryImage ? (
                        <img src={primaryImage} alt={item.title || "Listing"} />
                      ) : (
                        <div className="storefront-card-fallback" />
                      )}
                      <span className="storefront-card-condition">{item.condition || "Condition"}</span>
                      <span className="storefront-card-price-pill">{formatPrice(priceNumber)}</span>
                    </div>
                    <div className="storefront-card-body">
                      <h3>{item.title || "Untitled listing"}</h3>
                      <p className="storefront-card-location">{locationLabel || "Location"}</p>
                      <div className="storefront-card-row">
                        <span className="storefront-card-price">{formatPrice(priceNumber)}</span>
                        <span className="storefront-card-stock">1 in stock</span>
                      </div>
                      <div className="storefront-card-tags">
                        <span>{item.category || "Category"}</span>
                        {item.visibility === "friends" && (
                          <span className="is-friends">Friends only</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="storefront-preview-actions">
                    <button className="btn ghost" type="button" onClick={onEdit} disabled={isPublishing}>
                      Edit listing
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        isBulkPreview ? onDeleteBulk(item.id) : onDeleteSingle()
                      }
                      disabled={isPublishing}
                    >
                      Delete listing
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        isBulkPreview ? onChangeBulkPhotos(item.id) : onChangeSinglePhotos()
                      }
                      disabled={isPublishing}
                    >
                      Change photos
                    </button>
                  </div>
                  {item.images.length > 0 && (
                    <div className="storefront-upload-grid storefront-preview-upload">
                      {item.images.map((image) => (
                        <div key={image.id} className="storefront-upload-item">
                          <img src={image.url} alt={`${item.title || "Listing"} preview`} />
                          <button
                            type="button"
                            onClick={() =>
                              isBulkPreview
                                ? onRemoveBulkPhoto(item.id, image.id)
                                : onRemoveSinglePhoto(image.id)
                            }
                            disabled={isPublishing}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="storefront-preview-footer">
          <button className="btn ghost" type="button" onClick={onEdit} disabled={isPublishing}>
            {previewMode === "bulk" ? "Edit listings" : "Edit listing"}
          </button>
          <button className="btn primary" type="button" onClick={onPublish} disabled={isPublishing}>
            {isPublishing ? "Publishing..." : previewPublishLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

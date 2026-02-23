import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { pickMediaUrl } from "../utils/media";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

type Adjustments = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  brightness: number;
  contrast: number;
  enhance: boolean;
  upscale: boolean;
  cropEnabled: boolean;
};

type DayEdit = {
  file?: File;
  previewUrl?: string;
  adjustments: Adjustments;
};

type AvatarScheduleEntry = {
  id?: number;
  url?: string;
  updatedAt?: string;
};

type AvatarSchedule = Record<string, AvatarScheduleEntry | null | undefined>;

const DEFAULT_ADJUSTMENTS: Adjustments = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  brightness: 1,
  contrast: 1,
  enhance: false,
  upscale: false,
  cropEnabled: true,
};

const BASE_OUTPUT_SIZE = 640;
const PREVIEW_SIZE = 280;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });

const sanitizeSchedule = (input?: AvatarSchedule | null): AvatarSchedule => {
  if (!input || typeof input !== "object") return {};
  return input;
};

type ProfilePhotoModalProps = {
  open: boolean;
  onClose: () => void;
};

const ProfilePhotoModal: React.FC<ProfilePhotoModalProps> = ({ open, onClose }) => {
  const { profile, refreshProfile } = useAuth();
  const [activeDay, setActiveDay] = useState<DayKey>("mon");
  const [dayEdits, setDayEdits] = useState<Record<DayKey, DayEdit>>({} as Record<
    DayKey,
    DayEdit
  >);
  const [schedule, setSchedule] = useState<AvatarSchedule>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [useSameForAll, setUseSameForAll] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSchedule(sanitizeSchedule(profile?.avatarSchedule));
    setError(null);
    setSuccess(null);
    setUseSameForAll(false);
  }, [open, profile?.avatarSchedule]);

  useEffect(() => {
    if (!open) return;
    if (activeDay) return;
    setActiveDay("mon");
  }, [open, activeDay]);

  const currentEdit = dayEdits[activeDay] || {
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  };

  const currentImageUrl = useMemo(() => {
    if (currentEdit.previewUrl) return currentEdit.previewUrl;
    const entry = schedule?.[activeDay];
    if (!entry) return profile?.avatarUrl || "";
    const url =
      typeof entry === "string" ? entry : (entry as AvatarScheduleEntry)?.url;
    return url ? pickMediaUrl({ url }, { kind: "avatar" }) || url : profile?.avatarUrl || "";
  }, [activeDay, currentEdit.previewUrl, profile?.avatarUrl, schedule]);

  const currentAdjustments = currentEdit.adjustments || DEFAULT_ADJUSTMENTS;

  useEffect(() => {
    if (!currentEdit.previewUrl) {
      setImageObj(null);
      return;
    }
    let cancelled = false;
    loadImage(currentEdit.previewUrl)
      .then((img) => {
        if (!cancelled) setImageObj(img);
      })
      .catch(() => {
        if (!cancelled) setImageObj(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentEdit.previewUrl]);

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!imageObj) return;

    const size = canvas.width;
    const { zoom, offsetX, offsetY, brightness, contrast, enhance, cropEnabled } =
      currentAdjustments;
    const baseScale = cropEnabled
      ? Math.max(size / imageObj.width, size / imageObj.height)
      : Math.min(size / imageObj.width, size / imageObj.height);
    const scale = baseScale * zoom;
    const drawW = imageObj.width * scale;
    const drawH = imageObj.height * scale;
    const maxOffsetX = Math.max(0, (drawW - size) / 2);
    const maxOffsetY = Math.max(0, (drawH - size) / 2);
    const clampedX = clamp(offsetX, -maxOffsetX, maxOffsetX);
    const clampedY = clamp(offsetY, -maxOffsetY, maxOffsetY);
    const x = (size - drawW) / 2 + clampedX;
    const y = (size - drawH) / 2 + clampedY;

    ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${
      enhance ? 1.15 : 1
    })`;
    ctx.drawImage(imageObj, x, y, drawW, drawH);
    ctx.filter = "none";
  }, [currentAdjustments, imageObj]);

  useEffect(() => {
    if (!open) return;
    drawPreview();
  }, [open, drawPreview, activeDay]);

  const updateAdjustment = (updates: Partial<Adjustments>) => {
    setDayEdits((prev) => ({
      ...prev,
      [activeDay]: {
        ...currentEdit,
        adjustments: {
          ...DEFAULT_ADJUSTMENTS,
          ...currentEdit.adjustments,
          ...updates,
        },
      },
    }));
  };

  const setCurrentFile = (file: File | null) => {
    if (!file) {
      setDayEdits((prev) => ({
        ...prev,
        [activeDay]: {
          ...currentEdit,
          file: undefined,
          previewUrl: undefined,
        },
      }));
      return;
    }
    const url = URL.createObjectURL(file);
    setDayEdits((prev) => ({
      ...prev,
      [activeDay]: {
        file,
        previewUrl: url,
        adjustments: {
          ...DEFAULT_ADJUSTMENTS,
          ...prev?.[activeDay]?.adjustments,
          offsetX: 0,
          offsetY: 0,
          zoom: 1,
        },
      },
    }));
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      setCurrentFile(file);
    }
    if (event.target.value) {
      event.target.value = "";
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setCurrentFile(file);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentEdit.previewUrl || !currentAdjustments.cropEnabled) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: currentAdjustments.offsetX,
      originY: currentAdjustments.offsetY,
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || !currentAdjustments.cropEnabled) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    updateAdjustment({
      offsetX: dragRef.current.originX + dx,
      offsetY: dragRef.current.originY + dy,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    }
  };

  const clearDay = () => {
    setDayEdits((prev) => ({
      ...prev,
      [activeDay]: {
        adjustments: { ...DEFAULT_ADJUSTMENTS },
      },
    }));
    setSchedule((prev) => ({
      ...prev,
      [activeDay]: null,
    }));
  };

  const renderToBlob = async (edit: DayEdit) => {
    if (!edit.file || !edit.previewUrl) return null;
    const img = await loadImage(edit.previewUrl);
    const adjustments = edit.adjustments || DEFAULT_ADJUSTMENTS;
    const outputSize = adjustments.upscale ? BASE_OUTPUT_SIZE * 2 : BASE_OUTPUT_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const baseScale = adjustments.cropEnabled
      ? Math.max(outputSize / img.width, outputSize / img.height)
      : Math.min(outputSize / img.width, outputSize / img.height);
    const scale = baseScale * adjustments.zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const maxOffsetX = Math.max(0, (drawW - outputSize) / 2);
    const maxOffsetY = Math.max(0, (drawH - outputSize) / 2);
    const clampedX = clamp(adjustments.offsetX, -maxOffsetX, maxOffsetX);
    const clampedY = clamp(adjustments.offsetY, -maxOffsetY, maxOffsetY);
    const x = (outputSize - drawW) / 2 + clampedX;
    const y = (outputSize - drawH) / 2 + clampedY;

    ctx.filter = `brightness(${adjustments.brightness}) contrast(${adjustments.contrast}) saturate(${
      adjustments.enhance ? 1.15 : 1
    })`;
    ctx.drawImage(img, x, y, drawW, drawH);
    ctx.filter = "none";

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (result) => resolve(result),
        "image/webp",
        0.92
      );
    });
    return blob;
  };

  const saveSchedule = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const nextSchedule: AvatarSchedule = { ...schedule };
      if (useSameForAll) {
        const dayWithFile = DAY_KEYS.find((day) => dayEdits[day]?.file);
        const sourceDay = dayWithFile || activeDay;
        const sourceEdit = dayEdits[sourceDay];
        if (sourceEdit?.file) {
          const blob = await renderToBlob(sourceEdit);
          if (blob) {
            const filename = `avatar-all-${Date.now()}.webp`;
            const file = new File([blob], filename, { type: "image/webp" });
            const fd = new FormData();
            fd.append("files", file);
            const uploadRes = await api.post("/upload", fd);
            const uploaded = uploadRes.data?.[0];
            if (uploaded?.id) {
              const relativeUrl = String(uploaded?.url || "");
              const storedUrl =
                relativeUrl || pickMediaUrl(uploaded, { kind: "avatar" }) || "";
              const sharedEntry: AvatarScheduleEntry = {
                id: uploaded.id,
                url: storedUrl,
                updatedAt: new Date().toISOString(),
              };
              DAY_KEYS.forEach((day) => {
                nextSchedule[day] = { ...sharedEntry };
              });
            }
          }
        } else {
          const sourceEntry = schedule?.[sourceDay] ?? schedule?.[activeDay];
          const resolvedEntry =
            typeof sourceEntry === "string"
              ? { url: sourceEntry }
              : (sourceEntry as AvatarScheduleEntry | null | undefined);
          if (resolvedEntry?.url || resolvedEntry?.id) {
            DAY_KEYS.forEach((day) => {
              nextSchedule[day] = { ...resolvedEntry };
            });
          }
        }
      } else {
        for (const day of DAY_KEYS) {
          const edit = dayEdits[day];
          if (!edit?.file) continue;
          const blob = await renderToBlob(edit);
          if (!blob) continue;
          const filename = `avatar-${day}-${Date.now()}.webp`;
          const file = new File([blob], filename, { type: "image/webp" });
          const fd = new FormData();
          fd.append("files", file);
          const uploadRes = await api.post("/upload", fd);
          const uploaded = uploadRes.data?.[0];
          if (uploaded?.id) {
            const relativeUrl = String(uploaded?.url || "");
            const storedUrl =
              relativeUrl || pickMediaUrl(uploaded, { kind: "avatar" }) || "";
            nextSchedule[day] = {
              id: uploaded.id,
              url: storedUrl,
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }

      const dayIndex = new Date().getDay();
      const dayKey = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
        dayIndex
      ] || "mon") as DayKey;
      const todayEntry = nextSchedule?.[dayKey] as AvatarScheduleEntry | null | undefined;

      const payload: Record<string, any> = {
        avatarSchedule: nextSchedule,
      };
      if (todayEntry?.id) {
        payload.avatar = todayEntry.id;
      }

      await api.put("/profiles/me", { data: payload });
      setSchedule(nextSchedule);
      setSuccess("Profile photos updated.");
      await refreshProfile();
      onClose();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response
          ?.data?.error?.message || "Unable to update profile photos.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const hasCurrentImage = Boolean(currentImageUrl);
  const dayHasImage = (day: DayKey) => Boolean(schedule?.[day]?.url);

  return (
    <div className="profile-photo-modal">
      <div className="profile-photo-modal__backdrop" onClick={onClose} />
      <div className="profile-photo-modal__card" role="dialog" aria-modal="true">
        <div className="profile-photo-modal__header">
          <div>
            <h3>Profile Photo Studio</h3>
            <p>
              Add a photo for each day, crop it, and tune brightness & contrast.
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="profile-photo-modal__mode">
          <label className="profile-photo-toggle">
            <span>Use the same picture for every day</span>
            <input
              type="checkbox"
              checked={useSameForAll}
              onChange={(event) => setUseSameForAll(event.target.checked)}
            />
          </label>
          {useSameForAll && (
            <p className="profile-photo-mode-hint">
              Pick a day below to reuse its photo across every day.
            </p>
          )}
        </div>

        <div className="profile-photo-modal__days">
          {DAY_KEYS.map((day) => (
            <button
              key={day}
              type="button"
              className={`day-pill${activeDay === day ? " is-active" : ""}${
                dayHasImage(day) ? " has-image" : ""
              }`}
              onClick={() => setActiveDay(day)}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
        </div>

        <div className="profile-photo-modal__body">
          <div className="profile-photo-modal__preview">
            {!currentEdit.previewUrl ? (
              <div
                className="profile-photo-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    inputRef.current?.click();
                  }
                }}
              >
                <div>
                  <strong>
                    {hasCurrentImage ? "Replace photo" : "Add a photo"}
                  </strong>
                  <p>Drag & drop or click to choose an image.</p>
                </div>
              </div>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  className={`profile-photo-canvas${
                    currentAdjustments.cropEnabled ? " is-cropping" : ""
                  }`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
                <div className="profile-photo-preview-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => inputRef.current?.click()}
                  >
                    Choose another
                  </button>
                  <button type="button" className="btn ghost" onClick={clearDay}>
                    Clear day
                  </button>
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              hidden
            />
            {hasCurrentImage && !currentEdit.previewUrl && (
              <div className="profile-photo-current">
                <span>Current photo:</span>
                <img src={currentImageUrl} alt="" />
              </div>
            )}
          </div>

          <div className="profile-photo-modal__controls">
            <div className="profile-photo-control">
              <label>Crop square</label>
              <input
                type="checkbox"
                checked={currentAdjustments.cropEnabled}
                onChange={(event) =>
                  updateAdjustment({ cropEnabled: event.target.checked })
                }
              />
            </div>
            <div className="profile-photo-control">
              <label>Zoom</label>
              <input
                type="range"
                min={1}
                max={2.5}
                step={0.05}
                value={currentAdjustments.zoom}
                onChange={(event) =>
                  updateAdjustment({ zoom: Number(event.target.value) })
                }
                disabled={!currentEdit.previewUrl}
              />
            </div>
            <div className="profile-photo-control">
              <label>Brightness</label>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.02}
                value={currentAdjustments.brightness}
                onChange={(event) =>
                  updateAdjustment({ brightness: Number(event.target.value) })
                }
                disabled={!currentEdit.previewUrl}
              />
            </div>
            <div className="profile-photo-control">
              <label>Contrast</label>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.02}
                value={currentAdjustments.contrast}
                onChange={(event) =>
                  updateAdjustment({ contrast: Number(event.target.value) })
                }
                disabled={!currentEdit.previewUrl}
              />
            </div>
            <div className="profile-photo-control">
              <label>Enhance</label>
              <button
                type="button"
                className={`btn ghost${currentAdjustments.enhance ? " is-active" : ""}`}
                onClick={() =>
                  updateAdjustment({ enhance: !currentAdjustments.enhance })
                }
                disabled={!currentEdit.previewUrl}
              >
                {currentAdjustments.enhance ? "Enhanced" : "Enhance"}
              </button>
            </div>
            <div className="profile-photo-control">
              <label>Upscale</label>
              <button
                type="button"
                className={`btn ghost${currentAdjustments.upscale ? " is-active" : ""}`}
                onClick={() =>
                  updateAdjustment({ upscale: !currentAdjustments.upscale })
                }
                disabled={!currentEdit.previewUrl}
              >
                {currentAdjustments.upscale ? "Upscale 2x" : "Upscale"}
              </button>
            </div>
            {error && <p className="profile-photo-status error">{error}</p>}
            {success && <p className="profile-photo-status success">{success}</p>}
            <button
              type="button"
              className="btn primary profile-photo-save"
              onClick={saveSchedule}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save photos"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePhotoModal;

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { loadOrientedImage, releaseOrientedImage } from "../utils/image-orientation";

type AvatarImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
};

export default function AvatarImage({ src, ...props }: AvatarImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src ?? undefined);

  useEffect(() => {
    if (!src) {
      setResolvedSrc(undefined);
      return;
    }
    let active = true;
    loadOrientedImage(src).then((result) => {
      if (!active) {
        releaseOrientedImage(src);
        return;
      }
      setResolvedSrc(result.url);
    });
    return () => {
      active = false;
      releaseOrientedImage(src);
    };
  }, [src]);

  if (!resolvedSrc) return null;

  return <img src={resolvedSrc} {...props} />;
}

import { useCallback, useEffect, useState } from "react";
import { readNewsPreference, writeNewsPreference } from "../utils/news-preferences";

export const useNewsPreference = (userId?: number | null) => {
  const [override, setOverride] = useState<boolean | null>(() =>
    readNewsPreference(userId)
  );

  useEffect(() => {
    setOverride(readNewsPreference(userId));
  }, [userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdate = () => {
      setOverride(readNewsPreference(userId));
    };
    window.addEventListener("ysp-news-updated", handleUpdate);
    return () => window.removeEventListener("ysp-news-updated", handleUpdate);
  }, [userId]);

  const setPreference = useCallback(
    (value: boolean) => {
      writeNewsPreference(userId, value);
      setOverride(value);
    },
    [userId]
  );

  return { override, setPreference };
};

// src/pages/Me.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import "../css/dashboard.css";
import "../css/profile.css";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import api from "../api/strapi";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { HOBBY_OPTIONS } from "./me_hobbies";
import { RELIGION_OPTIONS } from "./me_religions";
import { usePageMeta } from "../hooks/usePageMeta";

type Profile = {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
  religion: string;
  country: string;
  countryCode: string;
  state: string;
  stateCode: string;
  city: string;
  hobbies: string;
  occupation: string;
  bio: string;
  phone?: string;
  handle?: string;
  avatarUrl?: string;
  onboardingComplete?: boolean;
};

type LocationOption = {
  name: string;
  code: string;
  countryCode?: string;
};

type MediaPost = {
  id: number | string;
  text: string;
  media?: string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const slug = (s: string) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const AGE_OPTIONS = Array.from({ length: 103 }, (_, index) => String(18 + index));

const normalizeHobby = (value: string) => value.trim().replace(/\s+/g, " ");
const hobbyKey = (value: string) => normalizeHobby(value).toLowerCase();
const parseHobbies = (value: string) => {
  const seen = new Set<string>();
  return (value || "")
    .split(/[,;\n]+/)
    .map((entry) => normalizeHobby(entry))
    .filter((entry) => {
      if (!entry) return false;
      const key = hobbyKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeLocation = (value: string) => value.trim().toLowerCase();
const matchByName = <T extends { name: string }>(list: T[], value: string) =>
  list.find((item) => normalizeLocation(item.name) === normalizeLocation(value));

const phoneDigits = (value?: string) => (value || "").replace(/\D/g, "").slice(0, 10);
const formatPhone = (value?: string) => {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const PREVIEW_DEBOUNCE_MS = 450;
const extractFirstUrl = (text: string) => {
  const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};
const hostnameFor = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};
const isYoutubeUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};
const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov)$/i.test(value);
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview: LinkPreview;
  url: string;
  compact?: boolean;
}) => {
  const title = preview.title || preview.siteName || hostnameFor(url);
  const meta = preview.siteName || hostnameFor(url);
  const showBadge = preview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {preview.image ? (
          <img src={preview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {preview.description && (
          <p className="link-preview-desc">{preview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

export default function Me() {
  const { user, refreshProfile } = useAuth();
  const { preferences, setBackgroundAll, resetBackgroundAll, setChatPrefs, getBackgroundStyle } =
    useUserPreferences();
  usePageMeta({
    title: "My Profile | Stick2YourDreams Connect",
    description:
      "Complete your Stick2YourDreams profile to connect with friends who share your goals, location, and interests.",
    type: "profile",
  });

  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    age: "",
    gender: "",
    religion: "",
    country: "",
    countryCode: "",
    state: "",
    stateCode: "",
    city: "",
    hobbies: "",
    occupation: "",
    bio: "",
    phone: "",
    handle: "",
  });

  const profileSnapshotRef = useRef<Profile | null>(null);
  const hobbySnapshotRef = useRef<string[]>([]);
  const profileIdRef = useRef<string | number | null>(null);
  const handleFixAttemptedRef = useRef(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const [hobbyInput, setHobbyInput] = useState("");
  const [hobbyList, setHobbyList] = useState<string[]>([]);
  const [postContent, setPostContent] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceUploading, setAppearanceUploading] = useState(false);
  const [appearanceCollapsed, setAppearanceCollapsed] = useState(true);

  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const filterLocationOptions = (
    options: LocationOption[],
    term: string,
    limit = 200
  ) => {
    if (!options.length) return [];
    const query = term.trim().toLowerCase();
    const filtered = query
      ? options.filter((option) => option.name.toLowerCase().includes(query))
      : options;
    return filtered.slice(0, limit);
  };

  const currentBackground = preferences.backgrounds.dashboard;
  const appearanceColor = currentBackground.color || "#0b0d14";

  const handleBackgroundColor = (value: string) => {
    setAppearanceError(null);
    setBackgroundAll({ color: value });
  };

  const handleBackgroundImage = async (file?: File | null) => {
    setAppearanceError(null);
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setAppearanceError("Background image is too large. Keep it under 4MB.");
      return;
    }
    setAppearanceUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const uploadRes = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const uploaded = uploadRes.data?.[0];
      const url = uploaded?.url;
      if (!url) {
        setAppearanceError("Upload failed. Please try again.");
        return;
      }
      const resolvedUrl = url.startsWith("/") ? `${apiBase}${url}` : url;
      setBackgroundAll({ image: resolvedUrl });
    } catch {
      setAppearanceError("Unable to upload the background image.");
    } finally {
      setAppearanceUploading(false);
    }
  };

  const clearBackgroundImage = () => {
    setBackgroundAll({ image: "" });
  };

  const resetBackgroundSettings = () => {
    resetBackgroundAll();
  };

  const resetChatSettings = () => {
    setChatPrefs({ width: 360, height: 520, fontSize: 14 });
  };

  // ✅ stable unique handle: username/email + numeric user id
  const lockedUniqueHandle = useMemo(() => {
    if (!user) return "";
    const base = slug(user.username || user.email || "user");
    return `${base || "user"}-${user.id}`;
  }, [user]);

  const pickMediaUrl = (mediaField: any): string | undefined => {
    if (!mediaField) return undefined;

    const candidate =
      (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
      (Array.isArray(mediaField) ? mediaField[0] : mediaField);

    if (!candidate) return undefined;

    const attrs = normalize(candidate);
    const url =
      attrs.url ||
      attrs.formats?.large?.url ||
      attrs.formats?.medium?.url ||
      attrs.formats?.small?.url ||
      attrs.formats?.thumbnail?.url;

    if (!url) return undefined;
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };

  const handleCountryChange = (value: string) => {
    const match = matchByName(countryOptions, value);
    setProfile((prev) => ({
      ...prev,
      country: value,
      countryCode: match?.code || "",
      state: "",
      stateCode: "",
      city: "",
    }));
    setStateOptions([]);
    setCityOptions([]);
  };

  const handleStateChange = (value: string) => {
    const match = matchByName(stateOptions, value);
    setProfile((prev) => ({
      ...prev,
      state: value,
      stateCode: match?.code || "",
      city: "",
    }));
    setCityOptions([]);
  };

  const handleCityChange = (value: string) => {
    setProfile((prev) => ({ ...prev, city: value }));
  };

  useEffect(() => {
    let active = true;
    const loadCountries = async () => {
      try {
        const res = await api.get("/locations/countries");
        const list = (res.data?.data ?? []).map((country: any) => ({
          name: country.name,
          code: country.code || country.isoCode || "",
        }));
        if (active) {
          setCountryOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load country list.");
      }
    };
    loadCountries();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!countryOptions.length) return;
    setProfile((prev) => {
      if (prev.countryCode || !prev.country) return prev;
      const match = matchByName(countryOptions, prev.country);
      return match ? { ...prev, countryCode: match.code } : prev;
    });
  }, [countryOptions]);

  useEffect(() => {
    const countryCode = profile.countryCode;
    if (!countryCode) {
      setStateOptions([]);
      setCityOptions([]);
      return;
    }

    let active = true;
    const loadStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: countryCode },
        });
        const list = (res.data?.data ?? []).map((state: any) => ({
          name: state.name,
          code: state.code || state.isoCode || "",
          countryCode: state.countryCode,
        }));
        if (active) {
          setStateOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load states or regions.");
      }
    };
    loadStates();
    return () => {
      active = false;
    };
  }, [profile.countryCode]);

  useEffect(() => {
    if (!stateOptions.length) return;
    setProfile((prev) => {
      if (prev.stateCode || !prev.state) return prev;
      const match = matchByName(stateOptions, prev.state);
      return match ? { ...prev, stateCode: match.code } : prev;
    });
  }, [stateOptions]);

  useEffect(() => {
    const countryCode = profile.countryCode;
    if (!countryCode) {
      setCityOptions([]);
      return;
    }
    const needsState = stateOptions.length > 0;
    if (needsState && !profile.stateCode) {
      setCityOptions([]);
      return;
    }

    let active = true;
    const loadCities = async () => {
      try {
        const res = await api.get("/locations/cities", {
          params: {
            country: countryCode,
            state: profile.stateCode || undefined,
          },
        });
        const list = (res.data?.data ?? []).map((city: any) => ({
          name: city.name,
          code: city.name,
        }));
        if (active) {
          setCityOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load cities.");
      }
    };
    loadCities();
    return () => {
      active = false;
    };
  }, [profile.countryCode, profile.stateCode, stateOptions.length]);

  useEffect(() => {
    if (onboardingActive) setOnboardingStep(0);
  }, [onboardingActive]);

  useEffect(() => {
    if (!user || loading) return;
    if (handleFixAttemptedRef.current) return;
    if (!profileIdRef.current || !lockedUniqueHandle) return;
    const currentHandle = (profile.handle || "").trim().toLowerCase();
    if (currentHandle && currentHandle !== "user") return;
    handleFixAttemptedRef.current = true;
    api
      .put("/profiles/me", { data: { handle: lockedUniqueHandle, locale: "en" } })
      .then((res) => {
        const updated = res.data?.data;
        if (updated) {
          setProfileFromEntry(updated);
        } else {
          setProfile((prev) => ({ ...prev, handle: lockedUniqueHandle }));
        }
      })
      .catch(() => {
        handleFixAttemptedRef.current = false;
      });
  }, [loading, lockedUniqueHandle, profile.handle, user]);

  const setProfileFromEntry = (entry: any) => {
    if (!entry) return;
    const attrs = normalize(entry);
    profileIdRef.current = entry?.documentId ?? entry?.id ?? null;
    const parsedHobbies = parseHobbies(attrs.hobbies || "");
    setHobbyList(parsedHobbies);

    const onboardingComplete =
      typeof attrs.onboardingComplete === "boolean" ? attrs.onboardingComplete : true;
    const nextProfile: Profile = {
      firstName: attrs.firstName || "",
      lastName: attrs.lastName || "",
      age: attrs.age || "",
      gender: attrs.gender || "",
      religion: attrs.religion || "",
      country: attrs.country || "",
      countryCode: attrs.countryCode || "",
      state: attrs.state || "",
      stateCode: attrs.stateCode || "",
      city: attrs.city || "",
      hobbies: parsedHobbies.join(", "),
      occupation: attrs.occupation || "",
      bio: attrs.bio || "",
      phone: formatPhone(attrs.phone || ""),
      handle: attrs.handle || "",
      avatarUrl: pickMediaUrl(attrs.avatar),
      onboardingComplete,
    };
    setProfile(nextProfile);
    profileSnapshotRef.current = nextProfile;
    hobbySnapshotRef.current = parsedHobbies;
    setOnboardingActive(!onboardingComplete);
  };

  const fetchMyProfileByUser = async () => {
    if (!user) return null;
    const res = await api.get(`/profiles/me?populate=avatar`);
    return res.data?.data ?? null;
  };

  // ✅ fallback: if the old profile wasn’t linked to user, we still find it by unique handle
  const fetchMyProfileByHandle = async (handle?: string) => {
    const target = (handle || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$eq]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfileByHandlePrefix = async (prefix?: string) => {
    const target = (prefix || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$startsWith]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfile = async () => {
    const byUser = await fetchMyProfileByUser();
    if (byUser) return byUser;
    const candidates = [profile.handle, lockedUniqueHandle].filter(
      (value) => value && value.toLowerCase() !== "user"
    ) as string[];
    for (const handle of candidates) {
      const byHandle = await fetchMyProfileByHandle(handle);
      if (byHandle) return byHandle;
    }
    for (const prefix of candidates) {
      const byPrefix = await fetchMyProfileByHandlePrefix(prefix);
      if (byPrefix) return byPrefix;
    }
    return null;
  };

  const fetchMyPosts = async () => {
    if (!user) return;

    const postsRes = await api.get(
      `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&sort=createdAt:desc`
    );

    const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
      const attrs = normalize(p);
      const pic = pickMediaUrl(attrs.Users_Pictures);
      return {
        id: p.documentId ?? p.id ?? attrs.documentId,
        text: attrs.Users_Content || "",
        media: pic,
      };
    });

    setPosts(mappedPosts);
  };

  const fetchLinkPreview = async (
    url: string,
    options?: { silent?: boolean }
  ): Promise<LinkPreview | null> => {
    if (!url) return null;
    if (previewCache[url] !== undefined) return previewCache[url];

    if (!options?.silent) {
      setLinkPreviewLoading(true);
      setLinkPreviewError(null);
    }

    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview = data?.url
        ? {
            url: data.url,
            title: data.title,
            description: data.description,
            image: data.image,
            siteName: data.siteName,
            type: data.type,
          }
        : null;
      setPreviewCache((prev) => ({ ...prev, [url]: preview }));
      return preview;
    } catch {
      setPreviewCache((prev) => ({ ...prev, [url]: null }));
      if (!options?.silent) {
        setLinkPreviewError("Unable to load link preview.");
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLinkPreviewLoading(false);
      }
    }
  };

  const createPost = async () => {
    if (!user) return;
    const content = postContent.trim();
    if (!content && !postFile) {
      setPostError("Add a message or a photo to post.");
      return;
    }
    setPostError(null);
    setPostSubmitting(true);
    try {
      let uploadedId: number | undefined;

      if (postFile) {
        const fd = new FormData();
        fd.append("files", postFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        uploadedId = uploadRes.data?.[0]?.id;
      }

      await api.post("/users-posts", {
        data: {
          Title: content.slice(0, 80) || "Post",
          Users_Content: content,
          owner: user.id,
          Users_Pictures: uploadedId ? [uploadedId] : undefined,
        },
      });

      setPostContent("");
      setPostFile(null);
      setLinkPreview(null);
      setLinkPreviewError(null);
      await fetchMyPosts();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to create post.";
        setPostError(String(msg));
      } else {
        setPostError("Failed to create post.");
      }
    } finally {
      setPostSubmitting(false);
    }
  };

  const deletePost = async (postId: number) => {
    if (!window.confirm("Delete this post?")) return;
    setPostError(null);
    try {
      await api.delete(`/users-posts/${postId}`);
      setPosts((prev) => prev.filter((p) => Number(p.id) !== postId));
    } catch (err) {
      console.error("Delete post failed", err);
      setPostError("Failed to delete post.");
    }
  };

  const updateHobbies = (next: string[]) => {
    setHobbyList(next);
    setProfile((prev) => ({ ...prev, hobbies: next.join(", ") }));
  };

  const addHobby = () => {
    const candidate = normalizeHobby(hobbyInput);
    if (!candidate) return;
    const match = HOBBY_OPTIONS.find((hobby) => hobbyKey(hobby) === hobbyKey(candidate));
    if (!match) return;
    if (hobbyList.some((hobby) => hobbyKey(hobby) === hobbyKey(match))) {
      setHobbyInput("");
      return;
    }
    const next = [...hobbyList, match];
    updateHobbies(next);
    setHobbyInput("");
  };

  const removeHobby = (target: string) => {
    const key = hobbyKey(target);
    const next = hobbyList.filter((hobby) => hobbyKey(hobby) !== key);
    updateHobbies(next);
  };

  const hobbySuggestions = useMemo(() => {
    const term = hobbyInput.trim().toLowerCase();
    const selected = new Set(hobbyList.map((hobby) => hobbyKey(hobby)));
    const matches = HOBBY_OPTIONS.filter((hobby) => {
      if (selected.has(hobbyKey(hobby))) return false;
      return term ? hobby.toLowerCase().includes(term) : true;
    });
    return matches.slice(0, 50);
  }, [hobbyInput, hobbyList]);

  const countrySuggestions = useMemo(
    () => filterLocationOptions(countryOptions, profile.country),
    [countryOptions, profile.country]
  );
  const stateSuggestions = useMemo(
    () => filterLocationOptions(stateOptions, profile.state),
    [stateOptions, profile.state]
  );
  const citySuggestions = useMemo(
    () => filterLocationOptions(cityOptions, profile.city),
    [cityOptions, profile.city]
  );

  const onboardingSteps = ["Basics", "Beliefs & Interests", "Location", "About you"];
  const hasBasics =
    profile.firstName.trim() &&
    profile.lastName.trim() &&
    profile.age &&
    profile.gender;
  const hasBeliefs = profile.religion.trim() && hobbyList.length > 0;
  const needsState = stateOptions.length > 0;
  const hasState = needsState ? Boolean(profile.state || profile.stateCode) : true;
  const hasLocation =
    profile.country.trim() && profile.countryCode && hasState && profile.city.trim();
  const canFinishOnboarding = Boolean(hasBasics && hasBeliefs && hasLocation);

  const handleOnboardingNext = async () => {
    setOnboardingError(null);
    if (onboardingStep === 0 && !hasBasics) {
      setOnboardingError("Please add your name, age, and gender to continue.");
      return;
    }
    if (onboardingStep === 1 && !hasBeliefs) {
      setOnboardingError("Select a religion and add at least one hobby to continue.");
      return;
    }
    if (onboardingStep === 2 && !hasLocation) {
      setOnboardingError("Choose your country, region, and city to continue.");
      return;
    }

    if (onboardingStep < onboardingSteps.length - 1) {
      setOnboardingStep((prev) => prev + 1);
      return;
    }

    if (!canFinishOnboarding) {
      setOnboardingError("Finish the required steps before completing setup.");
      return;
    }

    await saveProfile({ onboardingComplete: true });
  };

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const mine = await fetchMyProfile();

        if (!mine) {
          setHobbyList([]);
          setProfile({
            firstName: "",
            lastName: "",
            age: "",
            gender: "",
            religion: "",
            country: "",
            countryCode: "",
            state: "",
            stateCode: "",
            city: "",
            hobbies: "",
            occupation: "",
            bio: "",
            phone: "",
            handle: lockedUniqueHandle, // show the locked handle even if empty profile
            onboardingComplete: false,
          });
          setOnboardingActive(true);
          setOnboardingStep(0);
          setEditing(true);
          await fetchMyPosts();
          return;
        }

        setProfileFromEntry(mine);
        setEditing(false);
        await fetchMyPosts();
      } catch {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id, lockedUniqueHandle]);

  useEffect(() => {
    const url = extractFirstUrl(postContent);
    if (!url) {
      setLinkPreview(null);
      setLinkPreviewError(null);
      setLinkPreviewLoading(false);
      return;
    }

    setLinkPreviewError(null);
    if (linkPreview?.url === url) return;
    const cached = previewCache[url];
    if (cached !== undefined) {
      setLinkPreview(cached);
      return;
    }

    let active = true;
    const handle = setTimeout(() => {
      fetchLinkPreview(url).then((preview) => {
        if (!active) return;
        setLinkPreview(preview);
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [postContent, linkPreview?.url, previewCache]);

  useEffect(() => {
    const urls = Array.from(
      new Set(
        posts
          .map((post) => extractFirstUrl(post.text))
          .filter((url) => url)
      )
    );

    if (!urls.length) return;
    urls.forEach((url) => {
      if (previewCache[url] !== undefined) return;
      void fetchLinkPreview(url, { silent: true });
    });
  }, [posts, previewCache]);

  const saveProfile = async (override?: Partial<Profile>) => {
    if (!user) return;

    const mergedProfile = override ? { ...profile, ...override } : profile;
    if (override) setProfile(mergedProfile);

    setError(null);
    setErrorModal(null);
    setSuccess(null);
    setSuccessModal(null);

    try {
      const safeFirst = mergedProfile.firstName || user.username || user.email || "user";
      const normalizedHandle = (mergedProfile.handle || "").trim();
      const baseHandle =
          normalizedHandle && normalizedHandle.toLowerCase() !== "user"
            ? normalizedHandle
            : lockedUniqueHandle;
      const buildUniqueHandle = () =>
        `${baseHandle}-${user.id}-${Math.floor(1000 + Math.random() * 9000)}`;

      const phoneClean = phoneDigits(mergedProfile.phone);

      let avatarId: number | undefined;
      let uploadedAvatarUrl: string | undefined;

      if (avatarFile) {
        const fd = new FormData();
        fd.append("files", avatarFile);

        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        avatarId = uploadRes.data?.[0]?.id;
        uploadedAvatarUrl = pickMediaUrl(uploadRes.data?.[0]);
      }

      const buildPayload = (handleValue: string) => {
        const onboardingComplete =
          typeof mergedProfile.onboardingComplete === "boolean"
            ? mergedProfile.onboardingComplete
            : true;
        const data: any = {
          firstName: safeFirst,
          lastName: mergedProfile.lastName,
          age: mergedProfile.age,
          gender: mergedProfile.gender,
          religion: mergedProfile.religion,
          country: mergedProfile.country,
          countryCode: mergedProfile.countryCode,
          state: mergedProfile.state,
          stateCode: mergedProfile.stateCode,
          city: mergedProfile.city,
          hobbies: mergedProfile.hobbies,
          occupation: mergedProfile.occupation,
          bio: mergedProfile.bio,
          onboardingComplete,
          handle: handleValue,
          locale: "en",
          user: user.id,
        };
        data.phone = phoneClean ? phoneClean : null;
        if (avatarId) data.avatar = avatarId;
        return data;
      };

      let payload = buildPayload(baseHandle);

      const isHandleUniqueError = (err: any) => {
        if (!axios.isAxiosError(err)) return false;
        const msg = String(
          err.response?.data?.error?.message || err.response?.data?.message || ""
        ).toLowerCase();
        const errors = (err.response?.data?.error?.details?.errors ?? []) as any[];
        const handleErr = errors?.find((e: any) => (e?.path ?? []).includes("handle"));
        return msg.includes("unique") && (msg.includes("handle") || handleErr);
      };

      const doSave = async () => {
        const res = await api.put("/profiles/me", { data: payload });
        return res.data?.data ?? null;
      };

      let saved: any = null;
      try {
        saved = await doSave();
      } catch (e) {
        if (isHandleUniqueError(e)) {
          payload = buildPayload(buildUniqueHandle());
          saved = await doSave();
          setProfile((prev) => ({ ...prev, handle: payload.handle }));
        } else {
          throw e;
        }
      }

      if (uploadedAvatarUrl) {
        setProfile((prev) => ({ ...prev, avatarUrl: uploadedAvatarUrl }));
      }

      if (saved) {
        setProfileFromEntry(saved);
      } else {
        const mine = await fetchMyProfileByUser();
        if (!mine) throw new Error("Save succeeded but no profile found");
        setProfileFromEntry(mine);
      }

      void refreshProfile();

      setSuccess("Profile saved successfully.");
      setSuccessModal("Profile saved successfully.");
      setEditing(false);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          e.response?.data?.error?.message ||
          e.response?.data?.message ||
          "Failed to save profile";
        setError(String(msg));
        setErrorModal(String(msg));
      } else {
        setError("Failed to save profile");
        setErrorModal("Failed to save profile. Please try again.");
      }
    }
  };

  const cancelEdit = () => {
    if (profileSnapshotRef.current) {
      setProfile(profileSnapshotRef.current);
      setHobbyList([...hobbySnapshotRef.current]);
    }
    setAvatarFile(null);
    setHobbyInput("");
    setError(null);
    setErrorModal(null);
    setEditing(false);
  };

  if (!user) return null;

  const displayName =
    (profile.firstName || profile.lastName
      ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
      : user.username) || user.email;
  const displayHandle =
    profile.handle && profile.handle.toLowerCase() !== "user"
      ? profile.handle
      : lockedUniqueHandle;
  const avatarImg = profile.avatarUrl;
  const initials =
    displayName
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ME";
  const phoneLink = phoneDigits(profile.phone);
  const phoneDisplay = formatPhone(profile.phone);
  const canDial = phoneLink.length === 10;
  const hobbiesDisplay = parseHobbies(profile.hobbies || "");
  const stateLabel = profile.countryCode === "US" ? "State" : "Province/Region";
  const locationDisplay = [profile.city, profile.state, profile.country]
    .filter(Boolean)
    .join(", ");
  const leftInfo = [
    ["First Name", profile.firstName],
    ["Last Name", profile.lastName],
    ["Age", profile.age],
    ["Religion", profile.religion],
    ["Gender", profile.gender],
  ] as const;
  const rightInfo: Array<[string, string | undefined]> = [
    ["Handle", displayHandle],
    ["Phone", profile.phone],
    ["Location", locationDisplay],
    ["Country", profile.country],
    [stateLabel, profile.state],
    ["City", profile.city],
    ["Hobbies", profile.hobbies],
    ["Occupation", profile.occupation],
    ["Bio", profile.bio],
  ];
  const renderInfoCard = (label: string, value?: string) => (
    <div className="profile-card" key={label}>
      <p className="profile-card-label">{label}</p>
      {label === "Phone" ? (
        <p className="profile-card-value">
          {phoneLink ? (
            canDial ? (
              <a
                href={`tel:${phoneLink}`}
                style={{ color: "inherit", textDecoration: "underline" }}
              >
                {phoneDisplay || value}
              </a>
            ) : (
              phoneDisplay || value
            )
          ) : (
            "-"
          )}
        </p>
      ) : label === "Hobbies" ? (
        hobbiesDisplay.length ? (
          <ul className="profile-list">
            {hobbiesDisplay.map((hobby) => (
              <li key={hobby}>{hobby}</li>
            ))}
          </ul>
        ) : (
          <p className="profile-card-value">-</p>
        )
      ) : (
        <p className="profile-card-value">{value || "-"}</p>
      )}
    </div>
  );

  const onboardingTitle = onboardingSteps[onboardingStep] || "Profile setup";
  const renderOnboardingStep = () => {
    switch (onboardingStep) {
      case 0:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">First Name</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.firstName}
                onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
              />
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Last Name</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.lastName}
                onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
              />
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Age</span>
              <select
                className="auth-input"
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: e.target.value })}
              >
                <option value="">Select age</option>
                {AGE_OPTIONS.map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Gender</span>
              <select
                className="auth-input"
                value={profile.gender}
                onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          </div>
        );
      case 1:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Religion</span>
              <select
                className="auth-input"
                value={profile.religion}
                onChange={(e) => setProfile({ ...profile, religion: e.target.value })}
              >
                <option value="">Select religion</option>
                {RELIGION_OPTIONS.map((religion) => (
                  <option key={religion} value={religion}>
                    {religion}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Hobbies</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="auth-input"
                  list="hobby-suggestions-onboarding"
                  placeholder="Search hobbies"
                  value={hobbyInput}
                  onChange={(e) => setHobbyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addHobby();
                    }
                  }}
                />
                <button className="btn ghost" type="button" onClick={addHobby}>
                  Add
                </button>
              </div>
              <datalist id="hobby-suggestions-onboarding">
                {hobbySuggestions.map((hobby) => (
                  <option key={hobby} value={hobby} />
                ))}
              </datalist>
              {hobbyList.length ? (
                <ul className="profile-list">
                  {hobbyList.map((hobby) => (
                    <li key={hobby} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span>{hobby}</span>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => removeHobby(hobby)}
                          style={{ padding: "2px 10px", fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "8px 0 0", color: "#9ca3af" }}>
                  No hobbies added yet.
                </p>
              )}
              <small style={{ color: "#9ca3af" }}>
                Choose from the suggestions and add one hobby at a time.
              </small>
            </label>
          </div>
        );
      case 2:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Country</span>
              <input
                className="auth-input"
                list="country-options-onboarding"
                placeholder="Search country"
                value={profile.country}
                onChange={(e) => handleCountryChange(e.target.value)}
              />
              <datalist id="country-options-onboarding">
                {countrySuggestions.map((country) => (
                  <option key={country.code || country.name} value={country.name} />
                ))}
              </datalist>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">{stateLabel}</span>
              <input
                className="auth-input"
                list="state-options-onboarding"
                placeholder={
                  stateOptions.length ? `Search ${stateLabel.toLowerCase()}` : "Select country first"
                }
                value={profile.state}
                onChange={(e) => handleStateChange(e.target.value)}
                disabled={!profile.countryCode || !stateOptions.length}
              />
              <datalist id="state-options-onboarding">
                {stateSuggestions.map((state) => (
                  <option key={state.code || state.name} value={state.name} />
                ))}
              </datalist>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">City</span>
              <input
                className="auth-input"
                list="city-options-onboarding"
                placeholder={
                  !profile.countryCode
                    ? "Select country first"
                    : stateOptions.length && !profile.stateCode
                    ? `Select ${stateLabel.toLowerCase()} first`
                    : "Search city"
                }
                value={profile.city}
                onChange={(e) => handleCityChange(e.target.value)}
                disabled={!profile.countryCode || (stateOptions.length > 0 && !profile.stateCode)}
              />
              <datalist id="city-options-onboarding">
                {citySuggestions.map((city) => (
                  <option key={city.name} value={city.name} />
                ))}
              </datalist>
            </label>
            {locationError && <p className="profile-location-error">{locationError}</p>}
          </div>
        );
      default:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Occupation</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.occupation}
                onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
              />
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Bio</span>
              <textarea
                className="auth-input"
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                maxLength={500}
                rows={3}
              />
              <small style={{ color: "#9ca3af" }}>
                {profile.bio.length}/500 characters
              </small>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Phone</span>
              <input
                className="auth-input"
                type="tel"
                maxLength={14}
                placeholder="(555) 123-4567"
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: formatPhone(e.target.value) })}
              />
            </label>
          </div>
        );
    }
  };

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("profile")}>
      {errorModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#101018",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
              maxWidth: "420px",
              width: "90%",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#fff" }}>Something went wrong</h3>
            <p style={{ margin: "0 0 16px", color: "#d1d1d6" }}>{errorModal}</p>
            <div style={{ textAlign: "right" }}>
              <button className="btn primary" type="button" onClick={() => setErrorModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {successModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              maxWidth: "420px",
              width: "90%",
              border: "1px solid rgba(16, 185, 129, 0.4)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#34d399" }}>Success</h3>
            <p style={{ margin: "0 0 16px", color: "#d1fae5" }}>{successModal}</p>
            <div style={{ textAlign: "right" }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setSuccessModal(null);
                  setSuccess(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {onboardingActive && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">Getting started</p>
                <h3>Complete your profile</h3>
                <p className="onboarding-sub">This step-by-step guide appears once.</p>
              </div>
              <div className="onboarding-progress">
                Step {onboardingStep + 1} of {onboardingSteps.length}
              </div>
            </div>
            <h4 className="onboarding-title">{onboardingTitle}</h4>
            {renderOnboardingStep()}
            {onboardingError && <p className="status status-error">{onboardingError}</p>}
            <div className="onboarding-actions">
              {onboardingStep > 0 && (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setOnboardingStep((prev) => Math.max(prev - 1, 0))}
                >
                  Back
                </button>
              )}
              <button
                className="btn primary"
                type="button"
                onClick={handleOnboardingNext}
                disabled={
                  onboardingStep === onboardingSteps.length - 1 && !canFinishOnboarding
                }
              >
                {onboardingStep === onboardingSteps.length - 1 ? "Finish setup" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar active="me" />

        <div className="main-content">
          <TopbarSearch />
          <div className="panel-grid profile-appearance-row">
          <section className="panel profile-appearance-panel">
            <div className="profile-appearance-header">
              <div>
                <p className="eyebrow">Style</p>
                <h4>Background &amp; Chat</h4>
                <p className="profile-appearance-sub">
                  Update the background for dashboard, friends, and profile in one place.
                </p>
              </div>
              <button
                className="btn ghost profile-appearance-toggle"
                type="button"
                onClick={() => setAppearanceCollapsed((prev) => !prev)}
              >
                {appearanceCollapsed ? "Expand" : "Minimize"}
              </button>
            </div>

            {!appearanceCollapsed && (
              <div className="profile-appearance-body">
                <div className="profile-appearance-grid">
                  <label className="profile-field">
                    <span className="profile-field-label">Background color</span>
                    <div className="appearance-color-row">
                      <input
                        type="color"
                        value={appearanceColor}
                        onChange={(e) => handleBackgroundColor(e.target.value)}
                        aria-label="Background color"
                      />
                      <input
                        className="auth-input"
                        value={currentBackground.color || ""}
                        placeholder="#0b0d14"
                        onChange={(e) => {
                          const next = e.target.value.trim();
                          setBackgroundAll({ color: next });
                        }}
                      />
                    </div>
                    <small className="profile-appearance-sub">
                      Leave blank to use the default gradient.
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Background image</span>
                    <input
                      type="file"
                      className="auth-input"
                      accept="image/*"
                      onChange={(e) => handleBackgroundImage(e.target.files?.[0] || null)}
                    />
                    {currentBackground.image && (
                      <div className="appearance-preview">
                        <img src={currentBackground.image} alt="Background preview" />
                      </div>
                    )}
                    <div className="appearance-actions">
                      <button className="btn ghost" type="button" onClick={clearBackgroundImage}>
                        Remove image
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={resetBackgroundSettings}
                      >
                        Reset background
                      </button>
                    </div>
                    {appearanceUploading && (
                      <small className="profile-appearance-sub">Uploading image...</small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Chat text size</span>
                    <input
                      className="appearance-range"
                      type="range"
                      min={12}
                      max={20}
                      step={1}
                      value={preferences.chat.fontSize}
                      onChange={(e) =>
                        setChatPrefs({ fontSize: Number(e.target.value) })
                      }
                    />
                    <small className="profile-appearance-sub">
                      Current size: {preferences.chat.fontSize}px
                    </small>
                  </label>

                  <div className="profile-field">
                    <span className="profile-field-label">Chat size</span>
                    <p className="profile-appearance-sub">
                      Drag the chat corner to resize. It stays minimized when you leave friends.
                    </p>
                    <button className="btn ghost" type="button" onClick={resetChatSettings}>
                      Reset chat size
                    </button>
                  </div>
                </div>

                {appearanceError && (
                  <p className="profile-location-error">{appearanceError}</p>
                )}
              </div>
            )}
          </section>
        </div>
        {/* <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Profile</p>
            <p className="subhead">A clean snapshot of you, with quick actions and easy editing.</p>
          </div>
        </div> */}

        {loading && <p className="status">Loading profile…</p>}
        {error && <p className="status status-error">{error}</p>}
        {success && <p className="status status-success">{success}</p>}

        <div className="panel-grid" style={{ marginBottom: "16px" }}>
          <section
            className="panel"
            style={{
              background: "linear-gradient(135deg, rgba(92,128,255,0.12), rgba(16,185,129,0.08))",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "18px",
              alignItems: "center",
              padding: "20px 22px",
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "22px",
                background: "rgba(255,255,255,0.06)",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              }}
            >
              {avatarImg ? (
                <img
                  src={avatarImg}
                  alt={displayName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontWeight: 700, color: "#cdd5e8", fontSize: 22 }}>{initials}</span>
              )}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>{displayName}</h2>
                <span
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    letterSpacing: 0.2,
                  }}
                >
                  @{displayHandle}
                </span>
              </div>
              <p style={{ margin: 0, color: "#cdd5e8", maxWidth: 720 }}>
                {profile.bio || "Share a quick bio to help friends recognize you."}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn primary" type="button" onClick={() => setEditing(true)}>
                  Edit Profile
                </button>
                <button className="btn ghost" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                  Jump to top
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">About</p>
                <h3>Your Info</h3>
              </div>
            </div>

            {editing ? (
              <>
                <div className="profile-columns">
                  <div className="profile-column">
                  <label className="profile-field">
                    <span className="profile-field-label">First Name</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.firstName}
                      onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                    />
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Last Name</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.lastName}
                      onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                    />
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Age</span>
                    <select
                      className="auth-input"
                      value={profile.age}
                      onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                    >
                      <option value="">Select age</option>
                      {AGE_OPTIONS.map((age) => (
                        <option key={age} value={age}>
                          {age}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Religion</span>
                    <select
                      className="auth-input"
                      value={profile.religion}
                      onChange={(e) => setProfile({ ...profile, religion: e.target.value })}
                    >
                      <option value="">Select religion</option>
                      {RELIGION_OPTIONS.map((religion) => (
                        <option key={religion} value={religion}>
                          {religion}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Gender</span>
                    <select
                      className="auth-input"
                      value={profile.gender}
                      onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
                    >
                      <option value="">Select gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>
                </div>

                <div className="profile-column">
                  <label className="profile-field">
                    <span className="profile-field-label">Handle</span>
                    <input
                      className="auth-input"
                      value={lockedUniqueHandle}
                      readOnly
                      disabled
                      tabIndex={-1}
                      onFocus={(e) => e.target.blur()}
                      style={{ pointerEvents: "none", userSelect: "none", opacity: 0.7 }}
                    />
                    <small style={{ color: "#9ca3af" }}>
                      Locked + unique (username/email + user id).
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input
                      className="auth-input"
                      type="tel"
                      maxLength={14}
                      placeholder="(555) 123-4567"
                      value={profile.phone || ""}
                      onChange={(e) => setProfile({ ...profile, phone: formatPhone(e.target.value) })}
                    />
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Country</span>
                    <input
                      className="auth-input"
                      list="country-options"
                      placeholder="Search country"
                      value={profile.country}
                      onChange={(e) => handleCountryChange(e.target.value)}
                    />
                    <datalist id="country-options">
                      {countrySuggestions.map((country) => (
                        <option key={country.code || country.name} value={country.name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">{stateLabel}</span>
                    <input
                      className="auth-input"
                      list="state-options"
                      placeholder={stateOptions.length ? `Search ${stateLabel.toLowerCase()}` : "Select country first"}
                      value={profile.state}
                      onChange={(e) => handleStateChange(e.target.value)}
                      disabled={!profile.countryCode || !stateOptions.length}
                    />
                    <datalist id="state-options">
                      {stateSuggestions.map((state) => (
                        <option key={state.code || state.name} value={state.name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">City</span>
                    <input
                      className="auth-input"
                      list="city-options"
                      placeholder={
                        !profile.countryCode
                          ? "Select country first"
                          : stateOptions.length && !profile.stateCode
                          ? `Select ${stateLabel.toLowerCase()} first`
                          : "Search city"
                      }
                      value={profile.city}
                      onChange={(e) => handleCityChange(e.target.value)}
                      disabled={!profile.countryCode || (stateOptions.length > 0 && !profile.stateCode)}
                    />
                    <datalist id="city-options">
                      {citySuggestions.map((city) => (
                        <option key={city.name} value={city.name} />
                      ))}
                    </datalist>
                  </label>

                  {locationError && (
                    <p className="profile-location-error">{locationError}</p>
                  )}

                  <label className="profile-field">
                    <span className="profile-field-label">Hobbies</span>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        className="auth-input"
                        list="hobby-suggestions"
                        placeholder="Search hobbies"
                        value={hobbyInput}
                        onChange={(e) => setHobbyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addHobby();
                          }
                        }}
                      />
                      <button className="btn ghost" type="button" onClick={addHobby}>
                        Add
                      </button>
                    </div>
                    <datalist id="hobby-suggestions">
                      {hobbySuggestions.map((hobby) => (
                        <option key={hobby} value={hobby} />
                      ))}
                    </datalist>
                    {hobbyList.length ? (
                      <ul className="profile-list">
                        {hobbyList.map((hobby) => (
                          <li key={hobby} style={{ marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span>{hobby}</span>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => removeHobby(hobby)}
                                style={{ padding: "2px 10px", fontSize: 12 }}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: "8px 0 0", color: "#9ca3af" }}>No hobbies added yet.</p>
                    )}
                    <small style={{ color: "#9ca3af" }}>
                      Choose from the suggestions and add one hobby at a time.
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Occupation</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.occupation}
                      onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
                    />
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Bio</span>
                    <textarea
                      className="auth-input"
                      value={profile.bio}
                      onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                      maxLength={500}
                      rows={3}
                    />
                    <small style={{ color: "#9ca3af" }}>
                      {profile.bio.length}/500 characters
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Avatar</span>
                    <input
                      type="file"
                      className="auth-input"
                      accept="image/*"
                      onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <div className="profile-actions">
                    <button className="btn ghost" type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button className="btn primary" type="button" onClick={() => saveProfile()}>
                      Save Profile
                    </button>
                  </div>
                </div>
              </div>

              </>
            ) : (
              <div className="profile-columns">
                <div className="profile-column">
                  {leftInfo.map(([label, value]) => renderInfoCard(label, value))}
                </div>
                <div className="profile-column">
                  {rightInfo.map(([label, value]) => renderInfoCard(label, value))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="panel-grid">
          <section className="panel post-composer">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Share</p>
                <h3>New Post</h3>
                <p className="panel-sub">
                  What's On Your Mind?
                </p>
              </div>
            </div>

            <div className="post-composer__top">
              <div className="post-composer__avatar">
                {avatarImg ? (
                  <img src={avatarImg} alt={displayName} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="post-composer__input">
                <textarea
                  className="auth-input"
                  placeholder="What's on your mind? Drop a YouTube link or article."
                  value={postContent}
                  onChange={(e) => {
                    setPostContent(e.target.value);
                    setPostError(null);
                  }}
                  rows={4}
                />
                {linkPreviewLoading && (
                  <span className="post-composer__hint">Loading preview...</span>
                )}
              </div>
            </div>

            {linkPreview && (
              <LinkPreviewCard
                preview={linkPreview}
                url={linkPreview.url || extractFirstUrl(postContent)}
              />
            )}
            {linkPreviewError && <p className="status status-error">{linkPreviewError}</p>}

            <div className="post-composer__actions">
              <div className="post-composer__tools">
                <label className="post-composer__tool">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      setPostFile(e.target.files?.[0] || null);
                      setPostError(null);
                    }}
                  />
                  <span>{postFile ? "Change media" : "Add photo/video"}</span>
                </label>
                <span className="post-composer__file">
                  {postFile ? postFile.name : "No media selected"}
                </span>
                {postFile && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setPostFile(null)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={createPost}
                disabled={postSubmitting}
              >
                {postSubmitting ? "Posting..." : "Post"}
              </button>
            </div>

            {postError && <p className="status status-error">{postError}</p>}
          </section>
        </div>

        <div className="posts-grid">
          {posts.map((p) => {
            const postUrl = extractFirstUrl(p.text);
            const preview = postUrl ? previewCache[postUrl] : undefined;
            const hasLink = Boolean(postUrl);
            const descriptor = mediaDescriptor(p.media, hasLink);
            const postId = Number(p.id);
            const canDelete = Number.isFinite(postId);

            return (
              <article key={String(p.id)} className="post-card">
                <div className="post-meta-bar">
                  <span className="post-meta-name">{displayName}</span>
                  <span className="post-meta-text">just posted an update</span>
                  {descriptor && <span className="post-meta-tag">{descriptor}</span>}
                  {canDelete && (
                    <button
                      className="btn ghost post-delete"
                      type="button"
                      onClick={() => deletePost(postId)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {p.media ? (
                  <div className="post-media">
                    {isVideoUrl(p.media) ? (
                      <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                        <source src={p.media} />
                      </video>
                    ) : (
                      <img src={p.media} alt={p.text} loading="lazy" />
                    )}
                  </div>
                ) : preview?.image ? (
                  <div className="post-media">
                    <img
                      src={preview.image}
                      alt={preview.title || displayName}
                      loading="lazy"
                    />
                  </div>
                ) : null}

                <div className="post-body">
                  <h3>{user.username}</h3>
                  <p>{p.text}</p>
                  {preview && !p.media && (
                    <LinkPreviewCard preview={preview} url={preview.url || postUrl} compact />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

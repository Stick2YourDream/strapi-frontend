import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import "../css/topbar.css";
import { HOBBY_OPTIONS } from "../pages/me_hobbies";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  type PrivacySettings,
  type ProfileVisibility,
  type ProfilePayload,
  type VisibilityLevel,
} from "../utils/profile-e2ee";

type DirectoryProfile = {
  id: number | string;
  userId?: number;
  handle?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarUrl?: string;
  country?: string;
  state?: string;
  city?: string;
  hobbies?: string;
  hobbyTags?: string[];
  hobbyKeys?: string[];
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  searchIndexingEnabled?: boolean;
  activityVisibility?: VisibilityLevel;
};

type LocationOption = {
  name: string;
  code: string;
  countryCode?: string;
};

type FriendRelation = {
  requesterId?: number;
  targetId?: number;
  status?: string;
};

type TopbarSearchProps = {
  value?: string;
  onChange?: (value: string) => void;
};

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityAttrs = (entry: any) => {
  const data = getEntity(entry);
  return data?.attributes ?? data ?? {};
};
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};
const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
const pickMediaUrl = (mediaField: any): string | undefined => {
  if (!mediaField) return undefined;
  const candidate =
    (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
    (Array.isArray(mediaField) ? mediaField[0] : mediaField);
  if (!candidate) return undefined;
  const attrs = normalize(candidate);
  let url =
    attrs.url ||
    attrs.formats?.large?.url ||
    attrs.formats?.medium?.url ||
    attrs.formats?.small?.url ||
    attrs.formats?.thumbnail?.url;
  if (!url) return undefined;
  return url.startsWith("/") ? `${apiBase}${url}` : url;
};

const normalizeText = (value: string) => value.trim().toLowerCase();
const normalizeSearch = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/@+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeVisibility = (
  value: unknown,
  fallback: VisibilityLevel = "public"
): VisibilityLevel => {
  if (value === "public" || value === "followers" || value === "private") {
    return value;
  }
  return fallback;
};
const normalizeProfileVisibility = (value: unknown): ProfileVisibility => {
  if (value === "custom") return "custom";
  return normalizeVisibility(value, "public");
};
const normalizePrivacySettings = (value: unknown): PrivacySettings => {
  const base: PrivacySettings = {
    bio: "public",
    links: "public",
    location: "public",
    birthday: "public",
    followers: "public",
    following: "public",
    activity: "public",
  };
  if (!value || typeof value !== "object") return base;
  const settings = value as PrivacySettings;
  return {
    bio: normalizeVisibility(settings.bio, base.bio),
    links: normalizeVisibility(settings.links, base.links),
    location: normalizeVisibility(settings.location, base.location),
    birthday: normalizeVisibility(settings.birthday, base.birthday),
    followers: normalizeVisibility(settings.followers, base.followers),
    following: normalizeVisibility(settings.following, base.following),
    activity: normalizeVisibility(settings.activity, base.activity),
  };
};
const resolveFieldVisibility = (
  profileVisibility: ProfileVisibility,
  privacySettings: PrivacySettings,
  field: keyof PrivacySettings,
  fallback: VisibilityLevel = "public"
) => {
  if (profileVisibility === "custom") {
    return normalizeVisibility(privacySettings[field], fallback);
  }
  return normalizeVisibility(profileVisibility, fallback);
};
const canView = (audience: "public" | "followers", visibility: VisibilityLevel) => {
  if (visibility === "public") return true;
  if (visibility === "followers") return audience === "followers";
  return false;
};
const normalizeLocation = (value?: string) => normalizeText(value || "");
const matchByName = (list: LocationOption[], value: string) =>
  list.find((item) => normalizeLocation(item.name) === normalizeLocation(value));
const normalizeHobby = (value: string) => value.trim().replace(/\s+/g, " ");
const hobbyKey = (value: string) => normalizeHobby(value).toLowerCase();
const parseHobbyList = (value?: string) => {
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

export default function TopbarSearch({ value, onChange }: TopbarSearchProps) {
  const { user, profile } = useAuth();
  const [query, setQuery] = useState(value ?? "");
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [relations, setRelations] = useState<FriendRelation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [countryFilter, setCountryFilter] = useState("");
  const [countryCodeFilter, setCountryCodeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [stateCodeFilter, setStateCodeFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [hobbyFilterInput, setHobbyFilterInput] = useState("");
  const [hobbyFilterList, setHobbyFilterList] = useState<string[]>([]);
  const [hobbyFilterOpen, setHobbyFilterOpen] = useState(false);
  const [similarOnly, setSimilarOnly] = useState(false);
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hobbyFilterBlurRef = useRef<number | null>(null);
  const rawQuery = value ?? query;
  const trimmedQuery = rawQuery.trim();

  useEffect(() => {
    if (value === undefined) return;
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profilesRes, friendsRes] = await Promise.all([
          api.get("/profiles?populate[0]=user&populate[1]=avatar"),
          api.get(
            `/friends?filters[$or][0][requester][id][$eq]=${user.id}` +
              `&filters[$or][1][target][id][$eq]=${user.id}` +
              `&populate=requester&populate=target&pagination[pageSize]=200`
          ),
        ]);

        if (!active) return;
        const mappedRelations: FriendRelation[] = (friendsRes.data?.data ?? []).map((f: any) => {
          const attrs = normalize(f);
          return {
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
            status: attrs.status || "pending",
          };
        });
        setRelations(mappedRelations);

        const acceptedIds = new Set<number>();
        mappedRelations.forEach((relation) => {
          if (relation.status !== "accepted") return;
          const requesterId = relation.requesterId;
          const targetId = relation.targetId;
          const otherId = requesterId === user.id ? targetId : requesterId;
          if (otherId) acceptedIds.add(otherId);
        });

        const mappedProfiles = await Promise.all(
          (profilesRes.data?.data ?? []).map(async (p: any) => {
            const attrs = normalize(p);
            const userAttrs = getEntityAttrs(attrs.user);
            const profileUserId = getEntityId(attrs.user);
            if (!profileUserId) return null;
            let payload: ProfilePayload | null = null;
            if (acceptedIds.has(profileUserId) && attrs.encryptedProfile) {
              try {
                payload = await decryptFriendProfilePayload(
                  profileUserId,
                  user.id,
                  attrs.encryptedProfile
                );
              } catch {
                payload = null;
              }
            }
            const fallbackPayload = buildProfilePayloadFromAttrs(attrs);
            const resolvedPayload = payload
              ? { ...fallbackPayload, ...payload }
              : fallbackPayload;
            const searchIndexingEnabled =
              typeof resolvedPayload.searchIndexingEnabled === "boolean"
                ? resolvedPayload.searchIndexingEnabled
                : true;
            const profileVisibility = normalizeProfileVisibility(
              resolvedPayload.profileVisibility
            );
            const privacySettings = normalizePrivacySettings(
              resolvedPayload.privacySettings
            );
            const isFriend = acceptedIds.has(profileUserId);
            const canSeeProfile =
              profileVisibility === "public" ||
              profileVisibility === "custom" ||
              (profileVisibility === "followers" && isFriend);
            if (!canSeeProfile) return null;
            if (!isFriend && !searchIndexingEnabled) return null;
            const audience: "public" | "followers" = isFriend ? "followers" : "public";
            const locationVisibility = resolveFieldVisibility(
              profileVisibility,
              privacySettings,
              "location",
              "public"
            );
            const baseVisibility =
              profileVisibility === "custom"
                ? "public"
                : normalizeVisibility(profileVisibility, "public");
            const canShowLocation = canView(audience, locationVisibility);
            const canShowHobbies = canView(audience, baseVisibility);
            const userFirstName = userAttrs?.firstName || userAttrs?.firstname || "";
            const userLastName = userAttrs?.lastName || userAttrs?.lastname || "";
            const profileFirstName = resolvedPayload.firstName || userFirstName || "";
            const profileLastName = resolvedPayload.lastName || userLastName || "";
            const displayName =
              `${profileFirstName} ${profileLastName}`.trim() ||
              userAttrs?.displayName ||
              userAttrs?.name ||
              attrs.displayName ||
              attrs.name ||
              "";
            const visibleHobbies = canShowHobbies ? resolvedPayload.hobbies || "" : "";
            const hobbyTags = parseHobbyList(visibleHobbies);
            return {
              id: p.id ?? attrs.documentId,
              userId: profileUserId,
              handle: attrs.handle || `user-${p.id ?? attrs.documentId}`,
              firstName: profileFirstName,
              lastName: profileLastName,
              displayName,
              avatarUrl: pickMediaUrl(attrs.avatar),
              country: canShowLocation ? resolvedPayload.country || "" : "",
              state: canShowLocation ? resolvedPayload.state || "" : "",
              city: canShowLocation ? resolvedPayload.city || "" : "",
              hobbies: visibleHobbies,
              hobbyTags,
              hobbyKeys: hobbyTags.map(hobbyKey),
              profileVisibility,
              privacySettings,
              searchIndexingEnabled,
              activityVisibility: normalizeVisibility(
                resolvedPayload.activityVisibility,
                "public"
              ),
            };
          })
        );
        setProfiles(mappedProfiles.filter(Boolean) as DirectoryProfile[]);
      } catch {
        if (active) setError("Unable to load directory.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
    if (!countryCodeFilter) {
      setStateOptions([]);
      setCityOptions([]);
      return;
    }
    let active = true;
    const loadStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: countryCodeFilter },
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
  }, [countryCodeFilter]);

  useEffect(() => {
    if (!countryCodeFilter) {
      setCityOptions([]);
      return;
    }
    const needsState = stateOptions.length > 0;
    if (needsState && !stateCodeFilter) {
      setCityOptions([]);
      return;
    }
    let active = true;
    const loadCities = async () => {
      try {
        const res = await api.get("/locations/cities", {
          params: {
            country: countryCodeFilter,
            state: stateCodeFilter || undefined,
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
  }, [countryCodeFilter, stateCodeFilter, stateOptions.length]);

  useEffect(() => {
    if (
      !trimmedQuery &&
      !similarOnly &&
      !countryFilter &&
      !stateFilter &&
      !cityFilter &&
      !hobbyFilterList.length &&
      !hobbyFilterInput
    ) {
      return;
    }
    setOpen(true);
  }, [
    trimmedQuery,
    similarOnly,
    countryFilter,
    stateFilter,
    cityFilter,
    hobbyFilterList.length,
    hobbyFilterInput,
  ]);

  const updateQuery = (next: string) => {
    if (onChange) onChange(next);
    if (value === undefined) setQuery(next);
    setOpen(true);
  };

  const handleCountryFilterChange = (value: string) => {
    const match = matchByName(countryOptions, value);
    setCountryFilter(value);
    setCountryCodeFilter(match?.code || "");
    setStateFilter("");
    setStateCodeFilter("");
    setCityFilter("");
    setStateOptions([]);
    setCityOptions([]);
  };

  const handleStateFilterChange = (value: string) => {
    const match = matchByName(stateOptions, value);
    setStateFilter(value);
    setStateCodeFilter(match?.code || "");
    setCityFilter("");
    setCityOptions([]);
  };

  const handleCityFilterChange = (value: string) => {
    setCityFilter(value);
  };

  const openHobbyFilter = () => {
    if (hobbyFilterBlurRef.current) {
      window.clearTimeout(hobbyFilterBlurRef.current);
    }
    setHobbyFilterOpen(true);
  };

  const closeHobbyFilter = () => {
    if (hobbyFilterBlurRef.current) {
      window.clearTimeout(hobbyFilterBlurRef.current);
    }
    hobbyFilterBlurRef.current = window.setTimeout(() => {
      setHobbyFilterOpen(false);
    }, 120);
  };

  const addHobbyFilterValue = (value: string) => {
    const candidate = normalizeHobby(value);
    if (!candidate) return;
    const match = HOBBY_OPTIONS.find((hobby) => hobbyKey(hobby) === hobbyKey(candidate));
    if (!match) return;
    if (hobbyFilterList.some((entry) => hobbyKey(entry) === hobbyKey(match))) {
      setHobbyFilterInput("");
      return;
    }
    setHobbyFilterList((prev) => [...prev, match]);
    setHobbyFilterInput("");
  };

  const removeHobbyFilterValue = (value: string) => {
    const key = hobbyKey(value);
    setHobbyFilterList((prev) => prev.filter((entry) => hobbyKey(entry) !== key));
  };

  const hobbyFilterSuggestions = useMemo(() => {
    const term = hobbyFilterInput.trim().toLowerCase();
    const selected = new Set(hobbyFilterList.map((entry) => hobbyKey(entry)));
    const matches = HOBBY_OPTIONS.filter((hobby) => {
      if (selected.has(hobbyKey(hobby))) return false;
      return term ? hobby.toLowerCase().includes(term) : true;
    });
    return matches.slice(0, 12);
  }, [hobbyFilterInput, hobbyFilterList]);

  const relationStatusFor = (profileUserId?: number) => {
    if (!profileUserId || !relations.length) return null;
    const match = relations.find(
      (f) =>
        (f.requesterId === user?.id && f.targetId === profileUserId) ||
        (f.targetId === user?.id && f.requesterId === profileUserId)
    );
    return match?.status ?? null;
  };

  const requestFriend = async (profile: DirectoryProfile) => {
    if (!user || !profile.userId || profile.userId === user.id) return;
    const status = relationStatusFor(profile.userId);
    if (status === "pending" || status === "accepted") return;
    try {
      setBusyId(profile.userId);
      await api.post("/friends", {
        data: {
          target: profile.userId,
          status: "pending",
          locale: "en",
        },
      });
      setRelations((prev) => [
        ...prev,
        { requesterId: user.id, targetId: profile.userId, status: "pending" },
      ]);
    } catch {
      setError("Unable to send request.");
    } finally {
      setBusyId(null);
    }
  };

  const activeQuery = normalizeSearch(rawQuery);
  const manualFiltersEnabled = !similarOnly;
  const normalizedCountry = manualFiltersEnabled ? normalizeLocation(countryFilter) : "";
  const normalizedState = manualFiltersEnabled ? normalizeLocation(stateFilter) : "";
  const normalizedCity = manualFiltersEnabled ? normalizeLocation(cityFilter) : "";
  const hobbyFilterKeys = useMemo(
    () => {
      if (!manualFiltersEnabled) return [];
      const combined = [...hobbyFilterList];
      const inputValue = normalizeHobby(hobbyFilterInput);
      if (inputValue) combined.push(inputValue);
      const seen = new Set<string>();
      return combined
        .map(hobbyKey)
        .filter((key) => {
          if (!key) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },
    [hobbyFilterList, hobbyFilterInput, manualFiltersEnabled]
  );
  const filtersActive =
    Boolean(normalizedCountry) ||
    Boolean(normalizedState) ||
    Boolean(normalizedCity) ||
    hobbyFilterKeys.length > 0 ||
    similarOnly;
  const userHobbyKeys = useMemo(
    () => parseHobbyList(profile?.hobbies).map(hobbyKey),
    [profile?.hobbies]
  );
  const userCountry = normalizeLocation(profile?.country);
  const userState = normalizeLocation(profile?.state);
  const userCity = normalizeLocation(profile?.city);
  const hasUserHobbies = userHobbyKeys.length > 0;
  const hasUserLocation = Boolean(userCountry);
  const needsSimilarProfile = similarOnly && (!hasUserHobbies || !hasUserLocation);
  const isIdleSearch = !activeQuery && !filtersActive;
  const isAtQueryOnly = /^@+$/.test(trimmedQuery);
  const stateLabel = countryCodeFilter === "US" ? "State" : "State/Province";
  const needsState = stateOptions.length > 0;
  const results = useMemo(() => {
    if (!activeQuery && !filtersActive) return [];
    const queryTokens = activeQuery ? activeQuery.split(" ").filter(Boolean) : [];
    const userHobbySet = new Set(userHobbyKeys);
    return profiles
      .filter((p) => p.userId && p.userId !== user?.id)
      .filter((p) => {
        if (!activeQuery) return true;
        const handle = normalizeSearch(p.handle || "");
        const first = normalizeSearch(p.firstName || "");
        const last = normalizeSearch(p.lastName || "");
        const full = normalizeSearch(`${p.firstName || ""} ${p.lastName || ""}`);
        const displayName = normalizeSearch(p.displayName || "");
        const haystack = [handle, first, last, full, displayName];
        if (!queryTokens.length) return false;
        return queryTokens.every((token) => haystack.some((field) => field.includes(token)));
      })
      .filter((p) => {
        if (normalizedCountry && !normalizeLocation(p.country).includes(normalizedCountry)) {
          return false;
        }
        if (normalizedState && !normalizeLocation(p.state).includes(normalizedState)) {
          return false;
        }
        if (normalizedCity && !normalizeLocation(p.city).includes(normalizedCity)) {
          return false;
        }
        return true;
      })
      .filter((p) => {
        if (!hobbyFilterKeys.length) return true;
        const profileHobbies = p.hobbyKeys || [];
        if (!profileHobbies.length) return false;
        return hobbyFilterKeys.some((filterKey) =>
          profileHobbies.some((hobby) => hobby.includes(filterKey))
        );
      })
      .filter((p) => {
        if (!similarOnly) return true;
        if (!hasUserHobbies || !hasUserLocation) return false;
        const profileHobbies = p.hobbyKeys || [];
        if (!profileHobbies.length) return false;
        const sharesHobby = profileHobbies.some((hobby) => {
          if (userHobbySet.has(hobby)) return true;
          return userHobbyKeys.some(
            (userHobby) => hobby.includes(userHobby) || userHobby.includes(hobby)
          );
        });
        if (!sharesHobby) return false;
        const profileCountry = normalizeLocation(p.country);
        if (!profileCountry || profileCountry !== userCountry) return false;
        const profileState = normalizeLocation(p.state);
        const profileCity = normalizeLocation(p.city);
        if (userState && profileState && profileState !== userState) return false;
        if (userCity && profileCity && profileCity !== userCity) return false;
        return true;
      })
      .slice(0, 6);
  }, [
    activeQuery,
    filtersActive,
    profiles,
    user?.id,
    normalizedCountry,
    normalizedState,
    normalizedCity,
    hobbyFilterKeys,
    similarOnly,
    hasUserHobbies,
    hasUserLocation,
    userHobbyKeys,
    userCountry,
    userState,
    userCity,
  ]);

  if (!user) return null;

  return (
    <div className="topbar" ref={wrapperRef}>
      <div className="topbar-inner">
        <div className="topbar-search">
          <input
            type="text"
            value={rawQuery}
            onChange={(e) => updateQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Find friends by @handle or name"
            aria-label="Search by handle or name"
          />
          {open && (
            <div className="topbar-results">
              <div className="topbar-filters">
                <div className="topbar-filter-header">Filters</div>
                <div className="topbar-filter-grid">
                  <label className="topbar-filter-field">
                    <span>Country</span>
                    <select
                      value={countryFilter}
                      onChange={(e) => handleCountryFilterChange(e.target.value)}
                      disabled={similarOnly}
                    >
                      <option value="">Any country</option>
                      {countryOptions.map((country) => (
                        <option key={country.code || country.name} value={country.name}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="topbar-filter-field">
                    <span>{stateLabel}</span>
                    <select
                      value={stateFilter}
                      onChange={(e) => handleStateFilterChange(e.target.value)}
                      disabled={similarOnly || !countryCodeFilter || !stateOptions.length}
                    >
                      <option value="">
                        {!countryCodeFilter
                          ? "Select country first"
                          : needsState
                          ? `Any ${stateLabel.toLowerCase()}`
                          : "No regions"}
                      </option>
                      {stateOptions.map((state) => (
                        <option key={state.code || state.name} value={state.name}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="topbar-filter-field">
                    <span>City</span>
                    <select
                      value={cityFilter}
                      onChange={(e) => handleCityFilterChange(e.target.value)}
                      disabled={
                        similarOnly ||
                        !countryCodeFilter ||
                        (needsState && !stateCodeFilter)
                      }
                    >
                      <option value="">
                        {!countryCodeFilter
                          ? "Select country first"
                          : needsState && !stateCodeFilter
                          ? `Select ${stateLabel.toLowerCase()} first`
                          : "Any city"}
                      </option>
                      {cityOptions.map((city) => (
                        <option key={city.code || city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="topbar-filter-field">
                    <span>Hobbies</span>
                    <div className="topbar-hobby-picker">
                      <div className="topbar-hobby-input">
                        <input
                          type="text"
                          value={hobbyFilterInput}
                          onChange={(e) => setHobbyFilterInput(e.target.value)}
                          onFocus={openHobbyFilter}
                          onBlur={closeHobbyFilter}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addHobbyFilterValue(hobbyFilterInput);
                            }
                          }}
                          placeholder="Search hobbies"
                          disabled={similarOnly}
                        />
                        <button
                          type="button"
                          className="topbar-hobby-add"
                          onClick={() => addHobbyFilterValue(hobbyFilterInput)}
                          disabled={similarOnly}
                        >
                          Add
                        </button>
                      </div>
                      {hobbyFilterOpen && (
                        <div className="topbar-hobby-dropdown">
                          {hobbyFilterSuggestions.length ? (
                            hobbyFilterSuggestions.map((hobby) => (
                              <button
                                key={hobby}
                                type="button"
                                className="topbar-hobby-option"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  addHobbyFilterValue(hobby);
                                  openHobbyFilter();
                                }}
                              >
                                {hobby}
                              </button>
                            ))
                          ) : (
                            <div className="topbar-hobby-option is-empty">No matches</div>
                          )}
                        </div>
                      )}
                    </div>
                    {hobbyFilterList.length ? (
                      <div className="topbar-hobby-chips">
                        {hobbyFilterList.map((hobby) => (
                          <span className="topbar-hobby-chip" key={hobby}>
                            {hobby}
                            <button
                              type="button"
                              className="topbar-hobby-remove"
                              onClick={() => removeHobbyFilterValue(hobby)}
                              disabled={similarOnly}
                            >
                              x
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="topbar-hobby-empty">Pick one or more hobbies.</div>
                    )}
                  </label>
                </div>
                <label className="topbar-filter-toggle">
                  <input
                    type="checkbox"
                    checked={similarOnly}
                    onChange={(e) => setSimilarOnly(e.target.checked)}
                  />
                  Similar hobbies near me
                </label>
                {needsSimilarProfile && (
                  <div className="topbar-filter-note">
                    Add a country and at least one hobby in your profile to use suggestions.
                  </div>
                )}
                {locationError && (
                  <div className="topbar-filter-note">{locationError}</div>
                )}
              </div>
              {loading && <div className="topbar-status">Loading directory...</div>}
              {error && <div className="topbar-status">{error}</div>}
              {!loading && !error && needsSimilarProfile && (
                <div className="topbar-status">Suggestions need your location and hobbies.</div>
              )}
              {!loading && !error && !needsSimilarProfile && isAtQueryOnly && (
                <div className="topbar-status">Keep typing after @ to search handles.</div>
              )}
              {!loading && !error && !needsSimilarProfile && isIdleSearch && (
                <div className="topbar-status">
                  Start typing or use filters to search for friends.
                </div>
              )}
              {!loading &&
                !error &&
                !needsSimilarProfile &&
                !isIdleSearch &&
                results.length === 0 && (
                  <div className="topbar-status">No matches found.</div>
                )}
              {!loading && !error && similarOnly && !activeQuery && results.length > 0 && (
                <div className="topbar-section-title">Suggested near you</div>
              )}
              {!loading &&
                !error &&
                results.map((profile) => {
                  const status = relationStatusFor(profile.userId);
                  const fullName =
                    profile.displayName ||
                    `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
                  const locationParts = [profile.city, profile.state, profile.country].filter(
                    Boolean
                  );
                  const locationLabel = locationParts.join(", ");
                  const hobbyTags = profile.hobbyTags?.slice(0, 3) ?? [];
                  return (
                    <div className="topbar-result" key={profile.id}>
                      {profile.avatarUrl ? (
                        <img
                          src={profile.avatarUrl}
                          alt={profile.handle || "Profile"}
                          className="topbar-avatar"
                          loading="lazy"
                        />
                      ) : (
                        <div className="topbar-avatar fallback" aria-hidden="true">
                          {(profile.handle || "U").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="topbar-result-meta">
                        <strong>{fullName || profile.handle || "User"}</strong>
                        <span>@{profile.handle || "user"}</span>
                        {locationLabel && (
                          <span className="topbar-result-location">{locationLabel}</span>
                        )}
                        {hobbyTags.length > 0 && (
                          <div className="topbar-result-tags">
                            {hobbyTags.map((hobby) => (
                              <span className="topbar-tag" key={hobby}>
                                {hobby}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="topbar-result-actions">
                        {status === "accepted" ? (
                          <span className="topbar-chip">Friends</span>
                        ) : status === "pending" ? (
                          <span className="topbar-chip">Requested</span>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost topbar-add"
                            onClick={() => requestFriend(profile)}
                            disabled={busyId === profile.userId}
                          >
                            {busyId === profile.userId ? "Sending..." : "Add"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import "../css/topbar.css";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  type ProfilePayload,
} from "../utils/profile-e2ee";

type DirectoryProfile = {
  id: number | string;
  userId?: number;
  handle?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  country?: string;
  state?: string;
  city?: string;
  hobbies?: string;
  hobbyTags?: string[];
  hobbyKeys?: string[];
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
  const [hobbyFilter, setHobbyFilter] = useState("");
  const [similarOnly, setSimilarOnly] = useState(false);
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
            const resolvedPayload = payload ?? fallbackPayload;
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
            const hobbyTags = parseHobbyList(resolvedPayload.hobbies);
            return {
              id: p.id ?? attrs.documentId,
              userId: profileUserId,
              username: userAttrs?.username,
              handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
              firstName: profileFirstName,
              lastName: profileLastName,
              displayName,
              avatarUrl: pickMediaUrl(attrs.avatar),
              country: resolvedPayload.country || "",
              state: resolvedPayload.state || "",
              city: resolvedPayload.city || "",
              hobbies: resolvedPayload.hobbies || "",
              hobbyTags,
              hobbyKeys: hobbyTags.map(hobbyKey),
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
      !hobbyFilter
    ) {
      return;
    }
    setOpen(true);
  }, [trimmedQuery, similarOnly, countryFilter, stateFilter, cityFilter, hobbyFilter]);

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
    () => (manualFiltersEnabled ? parseHobbyList(hobbyFilter).map(hobbyKey) : []),
    [hobbyFilter, manualFiltersEnabled]
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
    const userHobbySet = new Set(userHobbyKeys);
    return profiles
      .filter((p) => p.userId && p.userId !== user?.id)
      .filter((p) => {
        if (!activeQuery) return true;
        const handle = normalizeSearch(p.handle || p.username || "");
        const username = normalizeSearch(p.username || "");
        const first = normalizeSearch(p.firstName || "");
        const last = normalizeSearch(p.lastName || "");
        const full = normalizeSearch(`${p.firstName || ""} ${p.lastName || ""}`);
        const displayName = normalizeSearch(p.displayName || "");
        return (
          handle.includes(activeQuery) ||
          username.includes(activeQuery) ||
          first.includes(activeQuery) ||
          last.includes(activeQuery) ||
          full.includes(activeQuery) ||
          displayName.includes(activeQuery)
        );
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
                    <input
                      type="text"
                      value={hobbyFilter}
                      onChange={(e) => setHobbyFilter(e.target.value)}
                      placeholder="Hobby keywords"
                      disabled={similarOnly}
                    />
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
                          alt={profile.handle || profile.username || "Profile"}
                          className="topbar-avatar"
                          loading="lazy"
                        />
                      ) : (
                        <div className="topbar-avatar fallback" aria-hidden="true">
                          {(profile.handle || profile.username || "U").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="topbar-result-meta">
                        <strong>{fullName || profile.handle || profile.username || "User"}</strong>
                        <span>@{profile.handle || profile.username || "user"}</span>
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

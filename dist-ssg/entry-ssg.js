import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Infinity as Infinity$1 } from "lucide-react";
var api = axios.create({ baseURL: "http://localhost:1337/api" });
api.interceptors.request.use((config) => {
	const token = localStorage.getItem("token");
	const url = config.url || "";
	const isAuthEndpoint = url === "/auth/local" || url.startsWith("/auth/") || url === "/register" || url.startsWith("/register");
	const headers = config.headers ?? {};
	config.headers = headers;
	if (token && !isAuthEndpoint) if (typeof headers.set === "function") headers.set("Authorization", `Bearer ${token}`);
	else headers.Authorization = `Bearer ${token}`;
	else if (headers) if (typeof headers.delete === "function") headers.delete("Authorization");
	else delete headers.Authorization;
	return config;
});
var strapi_default = api;
var AuthContext = createContext(void 0);
const StaticAuthProvider = ({ children }) => {
	return /* @__PURE__ */ jsx(AuthContext.Provider, {
		value: {
			user: null,
			profile: null,
			profileLoading: false,
			login: () => void 0,
			logout: () => void 0,
			refreshProfile: async () => void 0
		},
		children
	});
};
const useAuth = () => {
	const context = useContext(AuthContext);
	if (!context) throw new Error("useAuth must be used within AuthProvider");
	return context;
};
var upsertMeta = (name, value, useProperty = false) => {
	const selector = useProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`;
	let tag = document.querySelector(selector);
	if (!tag) {
		tag = document.createElement("meta");
		tag.setAttribute(useProperty ? "property" : "name", name);
		document.head.appendChild(tag);
	}
	tag.setAttribute("content", value);
};
var upsertLink = (rel, href) => {
	let link = document.querySelector(`link[rel="${rel}"]`);
	if (!link) {
		link = document.createElement("link");
		link.setAttribute("rel", rel);
		document.head.appendChild(link);
	}
	link.setAttribute("href", href);
};
const usePageMeta = ({ title, description, type, canonical, robots, keywords, image, imageAlt }) => {
	useEffect(() => {
		const safeTitle = title.trim();
		const safeDescription = description.trim();
		document.title = safeTitle;
		upsertMeta("description", safeDescription);
		upsertMeta("robots", robots || "index, follow");
		if (keywords) upsertMeta("keywords", keywords);
		upsertMeta("og:title", safeTitle, true);
		upsertMeta("og:description", safeDescription, true);
		upsertMeta("og:type", type || "website", true);
		upsertMeta("og:url", canonical || window.location.href, true);
		upsertMeta("twitter:title", safeTitle);
		upsertMeta("twitter:description", safeDescription);
		if (image) {
			upsertMeta("og:image", image, true);
			upsertMeta("twitter:image", image);
			upsertMeta("twitter:card", "summary_large_image");
			const altText = imageAlt || safeTitle;
			upsertMeta("og:image:alt", altText, true);
			upsertMeta("twitter:image:alt", altText);
		}
		upsertLink("canonical", canonical || window.location.href);
	}, [
		title,
		description,
		type,
		canonical,
		robots,
		keywords,
		image,
		imageAlt
	]);
};
function Login() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState(null);
	const [info, setInfo] = useState(null);
	usePageMeta({
		title: "Login | Stick2YourDreams Connect",
		description: "Log in to Stick2YourDreams Connect to share progress updates and stay accountable with your support network.",
		type: "website",
		robots: "noindex, nofollow"
	});
	const { login } = useAuth();
	const navigate = useNavigate();
	const handleLogin = async (e) => {
		e.preventDefault();
		setError(null);
		setInfo(null);
		try {
			localStorage.removeItem("token");
			localStorage.removeItem("user");
			const res = await strapi_default.post("/auth/local", {
				identifier: email.trim().toLowerCase(),
				password
			});
			console.log("LOGIN STATUS:", res.status);
			console.log("LOGIN DATA:", res.data);
			if (!res.data?.jwt) {
				setError("Login succeeded but no token was returned.");
				return;
			}
			login(res.data.user, res.data.jwt);
			navigate("/dashboard");
		} catch (err) {
			if (!axios.isAxiosError(err)) {
				setError("Login failed");
				return;
			}
			const status = err.response?.status;
			const data = err.response?.data;
			const msg = data?.error?.message || data?.message || "Login failed";
			console.log("Strapi login error:", status, data);
			const msgLower = msg.toLowerCase();
			if (msgLower.includes("not confirmed") || msgLower.includes("confirm your email")) {
				setError("Please confirm your email before logging in.");
				setInfo("Check your inbox (and spam), then try again.");
				return;
			}
			if (msgLower.includes("invalid identifier or password")) {
				setError("Invalid email or password.");
				return;
			}
			if (status === 401) {
				setError("Unauthorized. Please try again.");
				return;
			}
			if (status === 403) {
				setError("Access denied. Your account may be blocked.");
				return;
			}
			setError(msg);
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "auth-shell",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "auth-hero",
			children: [
				/* @__PURE__ */ jsxs("button", {
					type: "button",
					className: "auth-brand",
					onClick: () => navigate("/"),
					children: [/* @__PURE__ */ jsx("span", {
						className: "auth-brand-mark",
						children: "S2YD"
					}), /* @__PURE__ */ jsx("span", {
						className: "auth-brand-text",
						children: "| Stick2YourDreams"
					})]
				}),
				/* @__PURE__ */ jsx("h1", { children: "Welcome back" }),
				/* @__PURE__ */ jsx("p", {
					className: "subhead",
					children: "Sign in to access your dashboard and keep the momentum going."
				})
			]
		}), /* @__PURE__ */ jsxs("form", {
			onSubmit: handleLogin,
			className: "auth-card",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "field",
					children: [/* @__PURE__ */ jsx("label", { children: "Email" }), /* @__PURE__ */ jsx("input", {
						className: "auth-input",
						type: "email",
						placeholder: "you@example.com",
						value: email,
						onChange: (e) => setEmail(e.target.value),
						required: true,
						autoComplete: "email"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "field",
					children: [/* @__PURE__ */ jsx("label", { children: "Password" }), /* @__PURE__ */ jsx("input", {
						className: "auth-input",
						type: "password",
						placeholder: "••••••••",
						value: password,
						onChange: (e) => setPassword(e.target.value),
						required: true,
						autoComplete: "current-password"
					})]
				}),
				error && /* @__PURE__ */ jsx("p", {
					className: "auth-message error",
					children: error
				}),
				info && /* @__PURE__ */ jsx("p", {
					className: "auth-message info",
					children: info
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "auth-actions",
					children: [/* @__PURE__ */ jsx("button", {
						type: "submit",
						className: "btn primary",
						children: "Login"
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "btn ghost",
						onClick: () => navigate("/register"),
						children: "Register with Stick2YourDreams"
					})]
				})
			]
		})]
	});
}
const TERMS_TITLE = "Stick2YourDreams Connect Terms and Conditions";
const TERMS_UPDATED = "Last updated: Dec 27, 2025";
const TERMS_SECTIONS = [
	{
		title: "1. Acceptance of these Terms",
		body: ["By creating an account or using Stick2YourDreams Connect (the \"Service\"), you agree to these Terms and Conditions. If you do not agree, do not use the Service.", "If you are using the Service on behalf of an organization, you represent that you have the authority to bind that organization to these Terms."]
	},
	{
		title: "2. Eligibility and Accounts",
		body: ["You must be at least 18 years old to use the Service. You are responsible for the accuracy of the information you provide and for safeguarding your account credentials.", "You agree to keep your account information current and to notify us promptly of any unauthorized use of your account."]
	},
	{
		title: "3. Community Standards",
		body: ["Stick2YourDreams is a motivational support network. Harassment, hateful conduct, threats, impersonation, and discriminatory content are not allowed.", "You agree not to post illegal content, malicious code, spam, or anything that would disrupt the Service or harm other users."]
	},
	{
		title: "4. Content You Post",
		body: ["You own the content you submit, but you grant Stick2YourDreams a non-exclusive, worldwide, royalty-free license to host, store, and display that content for operating the Service.", "You are responsible for the content you post and for ensuring you have the rights to any media or links you share."]
	},
	{
		title: "5. Moderation and Enforcement",
		body: ["We may remove content or restrict accounts that violate these Terms or our community standards.", "We may issue warnings and temporarily or permanently restrict accounts for repeated violations. This includes content that is abusive, hateful, or otherwise harmful."]
	},
	{
		title: "6. Beta Service Notice",
		body: ["The Service is in Beta. Features may change, break, or be removed without notice. You may experience interruptions or data loss.", "We appreciate your feedback and will use it to improve the Service."]
	},
	{
		title: "7. Privacy",
		body: ["We respect your privacy and handle data according to our policies. You control what you share with others.", "By using the Service, you acknowledge that we process your information to provide and improve the Service."]
	},
	{
		title: "8. Disclaimers",
		body: ["The Service is provided \"as is\" without warranties of any kind. We do not guarantee that the Service will be uninterrupted or error free.", "We are not responsible for user generated content or external links shared by users."]
	},
	{
		title: "9. Limitation of Liability",
		body: ["To the maximum extent permitted by law, Stick2YourDreams will not be liable for any indirect, incidental, special, consequential, or punitive damages.", "Our total liability for any claim related to the Service will not exceed the amount you paid to use the Service in the past 12 months (if any)."]
	},
	{
		title: "10. Termination",
		body: ["You may stop using the Service at any time. We may suspend or terminate your account if you violate these Terms or if required to protect the community."]
	},
	{
		title: "11. Changes to these Terms",
		body: ["We may update these Terms from time to time. If we make material changes, we will notify you by posting the updated Terms.", "Your continued use of the Service after updates means you accept the revised Terms."]
	},
	{
		title: "12. Contact",
		body: ["Questions or concerns can be sent to jasonadams@stick2yourdream.com."]
	}
];
var slugifyHandle = (value) => value.toString().trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
var getPasswordError = (password) => {
	const minLength = 12;
	if (!password || password.length < minLength) return `Password must be at least ${minLength} characters long.`;
	if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
	if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
	if (!/[0-9]/.test(password)) return "Password must include at least one number.";
	if (!/[^A-Za-z0-9]/.test(password)) return "Password must include at least one symbol (spaces allowed).";
	return null;
};
function Register() {
	const [form, setForm] = useState({
		username: "",
		email: "",
		password: "",
		confirmPassword: "",
		botField: ""
	});
	const [termsOpen, setTermsOpen] = useState(false);
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [termsRead, setTermsRead] = useState(false);
	const [error, setError] = useState(null);
	const [info, setInfo] = useState(null);
	const formStartRef = useRef(Date.now());
	usePageMeta({
		title: "Register | Stick2YourDreams Connect",
		description: "Create a Stick2YourDreams account to join a motivational support network that celebrates progress and accountability.",
		type: "website",
		robots: "noindex, nofollow"
	});
	const navigate = useNavigate();
	const handleChange = (e) => {
		setForm({
			...form,
			[e.target.name]: e.target.value
		});
	};
	const handleSubmit = async (e) => {
		e.preventDefault();
		setError(null);
		setInfo(null);
		if (form.botField) {
			setError("Unable to register at this time.");
			return;
		}
		if (form.password !== form.confirmPassword) {
			setError("Passwords do not match.");
			return;
		}
		if (!termsAccepted) {
			setError("Please read and accept the Terms and Conditions.");
			return;
		}
		const passwordError = getPasswordError(form.password);
		if (passwordError) {
			setError(passwordError);
			return;
		}
		if (Date.now() - formStartRef.current < 3e3) {
			setError("Please take a moment to review your info before signing up.");
			return;
		}
		try {
			const res = await strapi_default.post("/register", {
				username: form.username,
				email: form.email,
				password: form.password,
				formStart: formStartRef.current,
				botField: form.botField,
				termsAccepted
			});
			const lockedHandle = slugifyHandle(form.username || form.email);
			try {
				await strapi_default.post("/profiles", { data: {
					handle: lockedHandle,
					firstName: form.username,
					user: res.data.user.id,
					locale: "en"
				} });
			} catch {}
			setInfo(res.data.message || "Account created! Please check your email to confirm your account.");
			setTimeout(() => navigate("/login"), 1500);
		} catch (err) {
			if (axios.isAxiosError(err)) setError((err.response?.data)?.error?.message || (err.response?.data)?.message || "Error registering user");
			else setError("Error registering user");
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "auth-shell",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "auth-hero",
				children: [
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "auth-brand",
						onClick: () => navigate("/"),
						children: [/* @__PURE__ */ jsx("span", {
							className: "auth-brand-mark",
							children: "S2YD"
						}), /* @__PURE__ */ jsx("span", {
							className: "auth-brand-text",
							children: "| Stick2YourDreams"
						})]
					}),
					/* @__PURE__ */ jsx("h1", { children: "Create your account" }),
					/* @__PURE__ */ jsx("p", {
						className: "subhead",
						children: "Join the community and share your journey!"
					})
				]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "section register-section",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "section-header register-section-header",
					children: [/* @__PURE__ */ jsx("h2", { children: "What you Get!" }), /* @__PURE__ */ jsx("p", {
						className: "muted register-section-sub",
						children: "Define Trust Within Our Community!"
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "metrics register-metrics",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "metric register-metric",
							children: [/* @__PURE__ */ jsx("strong", { children: "Always" }), /* @__PURE__ */ jsx("span", { children: "A Driven Community" })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric register-metric",
							children: [/* @__PURE__ */ jsx("strong", { children: /* @__PURE__ */ jsx(Infinity$1, { size: 30 }) }), /* @__PURE__ */ jsx("span", { children: "People Who Care" })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric register-metric",
							children: [/* @__PURE__ */ jsx("strong", { children: "0" }), /* @__PURE__ */ jsx("span", { children: "No Nonsense Distractions" })]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "metric register-metric",
							children: [/* @__PURE__ */ jsx("strong", { children: "+" }), /* @__PURE__ */ jsx("span", { children: "A Cleaner and Safer Community" })]
						})
					]
				})]
			}),
			/* @__PURE__ */ jsxs("form", {
				onSubmit: handleSubmit,
				className: "auth-card",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "honeypot",
						"aria-hidden": "true",
						children: [/* @__PURE__ */ jsx("label", {
							htmlFor: "company",
							children: "Company"
						}), /* @__PURE__ */ jsx("input", {
							id: "company",
							name: "botField",
							type: "text",
							tabIndex: -1,
							autoComplete: "off",
							value: form.botField,
							onChange: handleChange
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "field",
						children: [/* @__PURE__ */ jsx("label", { children: "Username" }), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							name: "username",
							placeholder: "Pick a handle",
							onChange: handleChange,
							value: form.username,
							required: true
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "field",
						children: [/* @__PURE__ */ jsx("label", { children: "Email" }), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							name: "email",
							type: "email",
							placeholder: "you@example.com",
							onChange: handleChange,
							value: form.email,
							required: true
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "field",
						children: [
							/* @__PURE__ */ jsx("label", { children: "Password" }),
							/* @__PURE__ */ jsx("input", {
								className: "auth-input",
								name: "password",
								type: "password",
								placeholder: "Enter a strong password",
								onChange: handleChange,
								value: form.password,
								required: true
							}),
							/* @__PURE__ */ jsx("small", {
								className: "auth-hint",
								children: "At least 12 characters with upper/lowercase, a number, and a symbol (spaces allowed)."
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "field",
						children: [/* @__PURE__ */ jsx("label", { children: "Confirm Password" }), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							name: "confirmPassword",
							type: "password",
							placeholder: "Confirm Password",
							onChange: handleChange,
							value: form.confirmPassword,
							required: true
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "terms-consent",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "terms-open",
							onClick: () => {
								setTermsOpen(true);
								setTermsRead(false);
							},
							children: "Read Terms"
						}), /* @__PURE__ */ jsxs("button", {
							type: "button",
							className: `terms-checkbox ${termsAccepted ? "checked" : ""}`,
							onClick: () => {
								if (termsAccepted) {
									setTermsAccepted(false);
									return;
								}
								setTermsOpen(true);
								setTermsRead(false);
							},
							"aria-pressed": termsAccepted,
							children: [/* @__PURE__ */ jsx("span", {
								className: "terms-checkmark",
								"aria-hidden": "true"
							}), /* @__PURE__ */ jsx("span", { children: "I agree to the Terms and Conditions" })]
						})]
					}),
					error && /* @__PURE__ */ jsx("p", {
						className: "auth-message error",
						children: error
					}),
					info && /* @__PURE__ */ jsx("p", {
						className: "auth-message info",
						children: info
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "auth-actions",
						children: [/* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "btn primary",
							children: "Sign Up"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "btn ghost",
							onClick: () => navigate("/login"),
							children: "Back to Login"
						})]
					})
				]
			}),
			termsOpen && /* @__PURE__ */ jsx("div", {
				className: "terms-overlay",
				role: "dialog",
				"aria-modal": "true",
				children: /* @__PURE__ */ jsxs("div", {
					className: "terms-modal",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "terms-modal-header",
							children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: "Stick2YourDreams Connect Terms and Conditions" }), /* @__PURE__ */ jsx("p", {
								className: "terms-updated",
								children: "Last updated: Dec 27, 2025"
							})] }), /* @__PURE__ */ jsx("button", {
								className: "terms-close",
								type: "button",
								onClick: () => setTermsOpen(false),
								children: "Close"
							})]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "terms-modal-body",
							onScroll: (event) => {
								const target = event.currentTarget;
								if (target.scrollTop + target.clientHeight >= target.scrollHeight - 8) setTermsRead(true);
							},
							children: TERMS_SECTIONS.map((section) => /* @__PURE__ */ jsxs("section", {
								className: "terms-section",
								children: [/* @__PURE__ */ jsx("h4", { children: section.title }), section.body.map((paragraph, index) => /* @__PURE__ */ jsx("p", { children: paragraph }, `${section.title}-${index}`))]
							}, section.title))
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "terms-modal-footer",
							children: [/* @__PURE__ */ jsx("a", {
								className: "terms-link",
								href: "/terms",
								target: "_blank",
								rel: "noreferrer",
								children: "Open full page"
							}), /* @__PURE__ */ jsx("button", {
								className: "btn primary",
								type: "button",
								disabled: !termsRead,
								onClick: () => {
									setTermsAccepted(true);
									setTermsOpen(false);
								},
								children: termsRead ? "I Agree" : "Scroll to the end to enable"
							})]
						})
					]
				})
			})
		]
	});
}
var NOTIF_LAST_SEEN_KEY = "notifications_last_seen_v1";
var NOTIF_LIKE_SNAPSHOT_KEY = "notifications_like_snapshot_v1";
var REFRESH_MS = 6e4;
var normalize$2 = (entry) => entry?.attributes ?? entry ?? {};
var getEntity$2 = (entry) => entry?.data ?? entry ?? null;
var getEntityId$2 = (entry) => {
	const data = getEntity$2(entry);
	const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
	const num = Number(rawId);
	return Number.isFinite(num) ? num : void 0;
};
var safeParseJson$2 = (value) => {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};
var getLastSeen = (userId) => {
	if (typeof window === "undefined") return null;
	const raw = safeParseJson$2(localStorage.getItem(NOTIF_LAST_SEEN_KEY));
	if (!raw || typeof raw !== "object") return null;
	const entry = raw[String(userId)];
	return entry ? String(entry) : null;
};
var setLastSeen = (userId, iso) => {
	if (typeof window === "undefined") return;
	const raw = safeParseJson$2(localStorage.getItem(NOTIF_LAST_SEEN_KEY));
	const next = {
		...raw && typeof raw === "object" ? raw : {},
		[String(userId)]: iso
	};
	localStorage.setItem(NOTIF_LAST_SEEN_KEY, JSON.stringify(next));
};
var getLikeSnapshot = (userId) => {
	if (typeof window === "undefined") return null;
	const raw = safeParseJson$2(localStorage.getItem(NOTIF_LIKE_SNAPSHOT_KEY));
	if (!raw || typeof raw !== "object") return null;
	const entry = raw[String(userId)];
	return entry && typeof entry === "object" ? entry : null;
};
var setLikeSnapshot = (userId, snapshot) => {
	if (typeof window === "undefined") return;
	const raw = safeParseJson$2(localStorage.getItem(NOTIF_LIKE_SNAPSHOT_KEY));
	const next = {
		...raw && typeof raw === "object" ? raw : {},
		[String(userId)]: snapshot
	};
	localStorage.setItem(NOTIF_LIKE_SNAPSHOT_KEY, JSON.stringify(next));
};
const useNotifications = (userId) => {
	const [counts, setCounts] = useState({
		messages: 0,
		requests: 0,
		friendPosts: 0,
		comments: 0,
		likes: 0
	});
	const [loading, setLoading] = useState(false);
	const lastSeenRef = useRef(null);
	const likeSnapshotRef = useRef(null);
	const latestLikeSnapshotRef = useRef({});
	const refresh = useCallback(async () => {
		if (!userId || !Number.isFinite(Number(userId))) {
			setCounts({
				messages: 0,
				requests: 0,
				friendPosts: 0,
				comments: 0,
				likes: 0
			});
			return;
		}
		const currentUserId = Number(userId);
		setLoading(true);
		try {
			const lastSeenIso = lastSeenRef.current;
			const afterFilter = lastSeenIso ? `&filters[createdAt][$gt]=${encodeURIComponent(lastSeenIso)}` : "";
			const relations = ((await strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${currentUserId}&filters[$or][1][target][id][$eq]=${currentUserId}&populate=requester&populate=target&pagination[pageSize]=200`).catch(() => null))?.data?.data ?? []).map((f) => {
				const attrs = normalize$2(f);
				return {
					status: attrs.status || "pending",
					requesterId: getEntityId$2(attrs.requester),
					targetId: getEntityId$2(attrs.target)
				};
			});
			const pendingRequests = relations.filter((f) => f.status === "pending" && f.targetId === currentUserId).length;
			const acceptedFriendIds = relations.filter((f) => f.status === "accepted").map((f) => f.requesterId === currentUserId ? f.targetId : f.requesterId).filter(Boolean);
			const messageCount = (await strapi_default.get(`/messages?filters[recipient][id][$eq]=${currentUserId}${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`).catch(() => null))?.data?.data?.length ?? 0;
			const myPosts = ((await strapi_default.get(`/users-posts?filters[owner][id][$eq]=${currentUserId}&fields[0]=likes&sort=createdAt:desc&pagination[pageSize]=200`).catch(() => null))?.data?.data ?? []).map((p) => {
				const attrs = normalize$2(p);
				return {
					id: p.id ?? attrs.documentId,
					likes: Number(attrs.likes ?? 0)
				};
			}).filter((p) => p.id !== void 0 && p.id !== null);
			const myPostIds = myPosts.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
			let commentCount = 0;
			if (myPostIds.length) {
				const commentFilter = myPostIds.map((id, index) => `filters[target_id][$in][${index}]=${id}`).join("&");
				commentCount = (await strapi_default.get(`/comments?filters[target_type][$eq]=user&${commentFilter}${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`).catch(() => null))?.data?.data?.length ?? 0;
			}
			let friendPostCount = 0;
			if (acceptedFriendIds.length) {
				const friendFilter = acceptedFriendIds.map((id, index) => `filters[owner][id][$in][${index}]=${id}`).join("&");
				friendPostCount = (await strapi_default.get(`/users-posts?${friendFilter}${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`).catch(() => null))?.data?.data?.length ?? 0;
			}
			const prevSnapshot = likeSnapshotRef.current || {};
			let likeCount = 0;
			const nextSnapshot = {};
			myPosts.forEach((post) => {
				const key = String(post.id);
				const likes = Number(post.likes || 0);
				nextSnapshot[key] = likes;
				const prev = Number(prevSnapshot[key] || 0);
				if (likes > prev) likeCount += likes - prev;
			});
			latestLikeSnapshotRef.current = nextSnapshot;
			setCounts({
				messages: messageCount,
				requests: pendingRequests,
				friendPosts: friendPostCount,
				comments: commentCount,
				likes: likeCount
			});
		} finally {
			setLoading(false);
		}
	}, [userId]);
	useEffect(() => {
		if (!userId || !Number.isFinite(Number(userId))) return;
		lastSeenRef.current = getLastSeen(Number(userId));
		likeSnapshotRef.current = getLikeSnapshot(Number(userId));
		refresh();
		const interval = window.setInterval(refresh, REFRESH_MS);
		return () => window.clearInterval(interval);
	}, [refresh, userId]);
	const markAllRead = useCallback(() => {
		if (!userId || !Number.isFinite(Number(userId))) return;
		const iso = (/* @__PURE__ */ new Date()).toISOString();
		lastSeenRef.current = iso;
		setLastSeen(Number(userId), iso);
		likeSnapshotRef.current = latestLikeSnapshotRef.current;
		setLikeSnapshot(Number(userId), latestLikeSnapshotRef.current);
		setCounts((prev) => ({
			...prev,
			messages: 0,
			friendPosts: 0,
			comments: 0,
			likes: 0
		}));
	}, [userId]);
	return {
		counts,
		total: useMemo(() => counts.messages + counts.requests + counts.friendPosts + counts.comments + counts.likes, [
			counts.comments,
			counts.friendPosts,
			counts.likes,
			counts.messages,
			counts.requests
		]),
		loading,
		refresh,
		markAllRead
	};
};
function Sidebar({ active }) {
	const navigate = useNavigate();
	const { user, logout } = useAuth();
	const [showMoreProfile, setShowMoreProfile] = useState(false);
	const [profileSummary, setProfileSummary] = useState(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [showProfileMenu, setShowProfileMenu] = useState(false);
	const [showNotifications, setShowNotifications] = useState(false);
	const { counts, total, loading, refresh, markAllRead } = useNotifications(user?.id);
	const normalize$3 = (entry) => entry?.attributes ?? entry ?? {};
	const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
	const pickMediaUrl$1 = (mediaField) => {
		if (!mediaField) return void 0;
		const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
		if (!candidate) return void 0;
		const attrs = normalize$3(candidate);
		let url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
		if (!url) return void 0;
		return url.startsWith("/") ? `${apiBase$2}${url}` : url;
	};
	useEffect(() => {
		const load = async () => {
			if (!user) return;
			try {
				const entry = (await strapi_default.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`)).data?.data?.[0];
				if (!entry) return;
				const attrs = normalize$3(entry);
				setProfileSummary({
					displayName: attrs.firstName || attrs.lastName ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim() : attrs.handle || attrs.username || user.username,
					handle: attrs.handle || user.username,
					avatarUrl: pickMediaUrl$1(attrs.avatar),
					age: attrs.age || "",
					hobbies: attrs.hobbies || "",
					bio: attrs.bio || ""
				});
			} catch {}
		};
		load();
	}, [user]);
	useEffect(() => {
		setShowProfileMenu(false);
		setShowNotifications(false);
	}, [user]);
	useEffect(() => {
		setMenuOpen(false);
		setShowProfileMenu(false);
		setShowNotifications(false);
	}, [active]);
	const profileCard = useMemo(() => {
		if (!user) return null;
		return {
			displayName: profileSummary?.displayName || user.username || user.email || "Me",
			handle: profileSummary?.handle || user.username || user.email || "Profile",
			avatarUrl: profileSummary?.avatarUrl
		};
	}, [profileSummary, user]);
	const nameForDisplay = profileCard?.displayName || "Me";
	const mobileInitials = useMemo(() => {
		const parts = nameForDisplay.trim().split(" ").filter(Boolean);
		return `${parts[0]?.[0] || ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase() || nameForDisplay.charAt(0).toUpperCase();
	}, [nameForDisplay]);
	const handleLogoClick = () => {
		navigate("/");
		setMenuOpen(false);
	};
	const handleProfileAction = (path) => {
		navigate(path);
		setShowProfileMenu(false);
		setShowNotifications(false);
		setMenuOpen(false);
	};
	const toggleMobileMenu = () => {
		setMenuOpen((prev) => !prev);
		setShowNotifications(false);
	};
	const secondaryLine = profileCard?.handle || "Profile";
	const fallbackInitial = nameForDisplay.charAt(0).toUpperCase();
	return /* @__PURE__ */ jsxs("div", {
		className: `sidebar-shell ${menuOpen ? "open" : ""}`,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "sidebar-topbar",
				children: [/* @__PURE__ */ jsxs("button", {
					className: "brand",
					type: "button",
					onClick: handleLogoClick,
					style: { cursor: "pointer" },
					children: [/* @__PURE__ */ jsx("span", {
						className: "brand-mark",
						children: "S2YD"
					}), /* @__PURE__ */ jsx("span", {
						className: "brand-text",
						children: "Stick2YourDreams"
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "mobile-topbar-actions",
					children: [
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: `mobile-avatar-button ${menuOpen ? "is-open" : ""}`,
							onClick: toggleMobileMenu,
							"aria-label": `Open profile menu for ${nameForDisplay}`,
							children: profileCard?.avatarUrl ? /* @__PURE__ */ jsx("img", {
								src: profileCard.avatarUrl,
								alt: nameForDisplay,
								className: "mobile-avatar-image"
							}) : /* @__PURE__ */ jsx("span", {
								className: "mobile-avatar-fallback",
								"aria-hidden": "true",
								children: fallbackInitial
							})
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: `mobile-initials-button ${menuOpen ? "is-open" : ""}`,
							onClick: toggleMobileMenu,
							"aria-label": `Open profile menu for ${nameForDisplay}`,
							children: mobileInitials
						}),
						/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: "sidebar-bell mobile-topbar-bell",
							"aria-label": `Notifications (${total})`,
							onClick: () => {
								setShowNotifications((v) => !v);
								setShowProfileMenu(false);
								setMenuOpen(false);
								refresh();
							},
							children: [/* @__PURE__ */ jsx("svg", {
								viewBox: "0 0 24 24",
								"aria-hidden": "true",
								children: /* @__PURE__ */ jsx("path", {
									d: "M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z",
									fill: "currentColor"
								})
							}), total > 0 && /* @__PURE__ */ jsx("span", {
								className: "sidebar-bell-badge",
								children: total > 99 ? "99+" : total
							})]
						}),
						menuOpen && /* @__PURE__ */ jsxs("div", {
							className: "mobile-profile-menu",
							children: [
								/* @__PURE__ */ jsx("button", {
									className: "mobile-profile-item",
									type: "button",
									onClick: () => handleProfileAction("/dashboard"),
									children: "My Dashboard"
								}),
								/* @__PURE__ */ jsx("button", {
									className: "mobile-profile-item",
									type: "button",
									onClick: () => handleProfileAction("/me"),
									children: "My Profile"
								}),
								/* @__PURE__ */ jsx("button", {
									className: "mobile-profile-item",
									type: "button",
									onClick: () => handleProfileAction("/friends"),
									children: "My Friends"
								}),
								/* @__PURE__ */ jsx("button", {
									className: "mobile-profile-item",
									type: "button",
									onClick: () => {
										logout();
										navigate("/login");
										setMenuOpen(false);
									},
									children: "Logout"
								})
							]
						}),
						showNotifications && /* @__PURE__ */ jsxs("div", {
							className: "mobile-notification-panel",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "sidebar-notification-header",
								children: [/* @__PURE__ */ jsx("strong", { children: "Notifications" }), /* @__PURE__ */ jsx("button", {
									type: "button",
									className: "btn ghost",
									onClick: markAllRead,
									disabled: total === 0,
									children: "Mark read"
								})]
							}), /* @__PURE__ */ jsxs("div", {
								className: "sidebar-notification-list",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-item",
										children: [/* @__PURE__ */ jsx("span", { children: "New messages" }), /* @__PURE__ */ jsx("span", {
											className: "sidebar-notification-count",
											children: counts.messages
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-item",
										children: [/* @__PURE__ */ jsx("span", { children: "Friend requests" }), /* @__PURE__ */ jsx("span", {
											className: "sidebar-notification-count",
											children: counts.requests
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-item",
										children: [/* @__PURE__ */ jsx("span", { children: "Friend posts" }), /* @__PURE__ */ jsx("span", {
											className: "sidebar-notification-count",
											children: counts.friendPosts
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-item",
										children: [/* @__PURE__ */ jsx("span", { children: "Comments on your posts" }), /* @__PURE__ */ jsx("span", {
											className: "sidebar-notification-count",
											children: counts.comments
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-item",
										children: [/* @__PURE__ */ jsx("span", { children: "Likes on your posts" }), /* @__PURE__ */ jsx("span", {
											className: "sidebar-notification-count",
											children: counts.likes
										})]
									}),
									loading && /* @__PURE__ */ jsx("div", {
										className: "sidebar-notification-status",
										children: "Refreshing..."
									}),
									!loading && total === 0 && /* @__PURE__ */ jsx("div", {
										className: "sidebar-notification-status",
										children: "All caught up."
									})
								]
							})]
						})
					]
				})]
			}),
			/* @__PURE__ */ jsxs("aside", {
				className: "dash-nav",
				children: [
					/* @__PURE__ */ jsxs("button", {
						className: "brand",
						type: "button",
						onClick: handleLogoClick,
						style: { cursor: "pointer" },
						children: [/* @__PURE__ */ jsx("span", {
							className: "brand-mark",
							children: "S2YD"
						}), /* @__PURE__ */ jsx("span", {
							className: "brand-text",
							children: "Stick2YourDreams"
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "nav-actions",
						style: {
							flexDirection: "column",
							alignItems: "flex-start",
							gap: "8px",
							width: "100%"
						},
						children: profileCard && /* @__PURE__ */ jsxs("div", {
							className: "sidebar-profile-slot",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "sidebar-profile-row",
									children: [/* @__PURE__ */ jsxs("button", {
										type: "button",
										className: "sidebar-profile-button",
										onClick: () => {
											setShowProfileMenu((v) => !v);
											setShowNotifications(false);
										},
										style: {
											display: "flex",
											alignItems: "center",
											gap: "10px",
											background: "transparent",
											border: "1px solid rgba(255,255,255,0.08)",
											padding: "10px 12px",
											borderRadius: "12px",
											color: "#c7cede",
											cursor: "pointer"
										},
										children: [profileCard.avatarUrl ? /* @__PURE__ */ jsx("img", {
											src: profileCard.avatarUrl,
											alt: nameForDisplay,
											className: "avatar-octagon",
											style: {
												width: 48,
												height: 48,
												borderRadius: "50%"
											}
										}) : /* @__PURE__ */ jsx("div", {
											"aria-hidden": "true",
											style: {
												width: 48,
												height: 48,
												borderRadius: "50%",
												display: "grid",
												placeItems: "center",
												background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
												color: "#0b0d14",
												fontWeight: 700
											},
											children: fallbackInitial
										}), /* @__PURE__ */ jsxs("div", {
											style: {
												textAlign: "left",
												minWidth: 0
											},
											children: [/* @__PURE__ */ jsx("strong", {
												style: { display: "block" },
												children: nameForDisplay
											}), /* @__PURE__ */ jsx("span", {
												style: {
													fontSize: "12px",
													color: "#9ca3af",
													display: "block",
													maxWidth: "100%",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap"
												},
												title: secondaryLine,
												children: secondaryLine
											})]
										})]
									}), /* @__PURE__ */ jsxs("button", {
										type: "button",
										className: "sidebar-bell",
										"aria-label": `Notifications (${total})`,
										onClick: () => {
											setShowNotifications((v) => !v);
											setShowProfileMenu(false);
											refresh();
										},
										children: [/* @__PURE__ */ jsx("svg", {
											viewBox: "0 0 24 24",
											"aria-hidden": "true",
											children: /* @__PURE__ */ jsx("path", {
												d: "M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z",
												fill: "currentColor"
											})
										}), total > 0 && /* @__PURE__ */ jsx("span", {
											className: "sidebar-bell-badge",
											children: total > 99 ? "99+" : total
										})]
									})]
								}),
								showNotifications && /* @__PURE__ */ jsxs("div", {
									className: "sidebar-notification-panel",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-header",
										children: [/* @__PURE__ */ jsx("strong", { children: "Notifications" }), /* @__PURE__ */ jsx("button", {
											type: "button",
											className: "btn ghost",
											onClick: markAllRead,
											disabled: total === 0,
											children: "Mark read"
										})]
									}), /* @__PURE__ */ jsxs("div", {
										className: "sidebar-notification-list",
										children: [
											/* @__PURE__ */ jsxs("div", {
												className: "sidebar-notification-item",
												children: [/* @__PURE__ */ jsx("span", { children: "New messages" }), /* @__PURE__ */ jsx("span", {
													className: "sidebar-notification-count",
													children: counts.messages
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "sidebar-notification-item",
												children: [/* @__PURE__ */ jsx("span", { children: "Friend requests" }), /* @__PURE__ */ jsx("span", {
													className: "sidebar-notification-count",
													children: counts.requests
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "sidebar-notification-item",
												children: [/* @__PURE__ */ jsx("span", { children: "Friend posts" }), /* @__PURE__ */ jsx("span", {
													className: "sidebar-notification-count",
													children: counts.friendPosts
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "sidebar-notification-item",
												children: [/* @__PURE__ */ jsx("span", { children: "Comments on your posts" }), /* @__PURE__ */ jsx("span", {
													className: "sidebar-notification-count",
													children: counts.comments
												})]
											}),
											/* @__PURE__ */ jsxs("div", {
												className: "sidebar-notification-item",
												children: [/* @__PURE__ */ jsx("span", { children: "Likes on your posts" }), /* @__PURE__ */ jsx("span", {
													className: "sidebar-notification-count",
													children: counts.likes
												})]
											}),
											loading && /* @__PURE__ */ jsx("div", {
												className: "sidebar-notification-status",
												children: "Refreshing..."
											}),
											!loading && total === 0 && /* @__PURE__ */ jsx("div", {
												className: "sidebar-notification-status",
												children: "All caught up."
											})
										]
									})]
								}),
								showProfileMenu && /* @__PURE__ */ jsxs("div", {
									style: {
										position: "absolute",
										top: "110%",
										left: 0,
										right: 0,
										background: "#0f172a",
										border: "1px solid rgba(255,255,255,0.08)",
										borderRadius: "10px",
										boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
										overflow: "hidden",
										zIndex: 15
									},
									children: [
										/* @__PURE__ */ jsx("button", {
											className: "btn ghost nav-btn",
											type: "button",
											style: {
												width: "100%",
												border: "none",
												borderRadius: 0,
												justifyContent: "flex-start"
											},
											onClick: () => handleProfileAction("/dashboard"),
											children: "My Dashboard"
										}),
										/* @__PURE__ */ jsx("button", {
											className: "btn ghost nav-btn",
											type: "button",
											style: {
												width: "100%",
												border: "none",
												borderRadius: 0,
												justifyContent: "flex-start"
											},
											onClick: () => handleProfileAction("/me"),
											children: "My Profile"
										}),
										/* @__PURE__ */ jsx("button", {
											className: "btn ghost nav-btn",
											type: "button",
											style: {
												width: "100%",
												border: "none",
												borderRadius: 0,
												justifyContent: "flex-start"
											},
											onClick: () => handleProfileAction("/friends"),
											children: "My Friends"
										}),
										/* @__PURE__ */ jsx("button", {
											className: "btn ghost nav-btn",
											type: "button",
											style: {
												width: "100%",
												border: "none",
												borderRadius: 0,
												justifyContent: "flex-start"
											},
											onClick: () => {
												logout();
												navigate("/login");
												setShowProfileMenu(false);
											},
											children: "Logout"
										})
									]
								})
							]
						})
					}),
					user && /* @__PURE__ */ jsxs("div", {
						style: {
							marginTop: "12px",
							width: "100%"
						},
						children: [/* @__PURE__ */ jsx("button", {
							className: "btn ghost",
							type: "button",
							onClick: () => setShowMoreProfile((v) => !v),
							style: {
								width: "100%",
								marginBottom: showMoreProfile ? "8px" : 0
							},
							children: showMoreProfile ? "Hide details" : "Bio"
						}), showMoreProfile && /* @__PURE__ */ jsxs("div", {
							className: "bio-panel",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "bio-line",
									children: [
										/* @__PURE__ */ jsx("strong", { children: "Name:" }),
										" ",
										nameForDisplay
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "bio-line",
									children: [
										/* @__PURE__ */ jsx("strong", { children: "Age:" }),
										" ",
										profileSummary?.age || "-"
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "bio-line",
									children: [
										/* @__PURE__ */ jsx("strong", { children: "Hobbies:" }),
										" ",
										profileSummary?.hobbies || "-"
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "bio-line",
									children: [
										/* @__PURE__ */ jsx("strong", { children: "Bio:" }),
										" ",
										profileSummary?.bio || "-"
									]
								})
							]
						})]
					})
				]
			}),
			menuOpen && /* @__PURE__ */ jsx("button", {
				className: "sidebar-overlay",
				type: "button",
				onClick: () => setMenuOpen(false),
				"aria-label": "Close menu overlay"
			})
		]
	});
}
var normalize$1 = (entry) => entry?.attributes ?? entry ?? {};
var getEntity$1 = (entry) => entry?.data ?? entry ?? null;
var getEntityAttrs = (entry) => {
	const data = getEntity$1(entry);
	return data?.attributes ?? data ?? {};
};
var getEntityId$1 = (entry) => {
	const data = getEntity$1(entry);
	const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
	const num = Number(rawId);
	return Number.isFinite(num) ? num : void 0;
};
var apiBase$1 = "http://localhost:1337/api".replace(/\/api$/, "");
var pickMediaUrl = (mediaField) => {
	if (!mediaField) return void 0;
	const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
	if (!candidate) return void 0;
	const attrs = normalize$1(candidate);
	let url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
	if (!url) return void 0;
	return url.startsWith("/") ? `${apiBase$1}${url}` : url;
};
function TopbarSearch({ value, onChange }) {
	const { user } = useAuth();
	const [query, setQuery] = useState(value ?? "");
	const [profiles, setProfiles] = useState([]);
	const [relations, setRelations] = useState([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [busyId, setBusyId] = useState(null);
	const wrapperRef = useRef(null);
	useEffect(() => {
		if (value === void 0) return;
		setQuery(value);
	}, [value]);
	useEffect(() => {
		if (!user) return;
		let active = true;
		const load = async () => {
			setLoading(true);
			setError(null);
			try {
				const [profilesRes, friendsRes] = await Promise.all([strapi_default.get("/profiles?populate[0]=user&populate[1]=avatar"), strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target&pagination[pageSize]=200`)]);
				if (!active) return;
				setProfiles((profilesRes.data?.data ?? []).map((p) => {
					const attrs = normalize$1(p);
					const userAttrs = getEntityAttrs(attrs.user);
					const userId = getEntityId$1(attrs.user);
					return {
						id: p.id ?? attrs.documentId,
						userId,
						username: userAttrs?.username,
						handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
						firstName: attrs.firstName || "",
						lastName: attrs.lastName || "",
						avatarUrl: pickMediaUrl(attrs.avatar)
					};
				}));
				setRelations((friendsRes.data?.data ?? []).map((f) => {
					const attrs = normalize$1(f);
					return {
						requesterId: getEntityId$1(attrs.requester),
						targetId: getEntityId$1(attrs.target),
						status: attrs.status || "pending"
					};
				}));
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
		const handleClick = (event) => {
			if (!wrapperRef.current) return;
			if (!wrapperRef.current.contains(event.target)) setOpen(false);
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);
	const updateQuery = (next) => {
		if (onChange) onChange(next);
		if (value === void 0) setQuery(next);
		setOpen(Boolean(next.trim()));
	};
	const relationStatusFor = (profileUserId) => {
		if (!profileUserId || !relations.length) return null;
		return relations.find((f) => f.requesterId === user?.id && f.targetId === profileUserId || f.targetId === user?.id && f.requesterId === profileUserId)?.status ?? null;
	};
	const requestFriend = async (profile) => {
		if (!user || !profile.userId || profile.userId === user.id) return;
		const status = relationStatusFor(profile.userId);
		if (status === "pending" || status === "accepted") return;
		try {
			setBusyId(profile.userId);
			await strapi_default.post("/friends", { data: {
				target: profile.userId,
				status: "pending",
				locale: "en"
			} });
			setRelations((prev) => [...prev, {
				requesterId: user.id,
				targetId: profile.userId,
				status: "pending"
			}]);
		} catch {
			setError("Unable to send request.");
		} finally {
			setBusyId(null);
		}
	};
	const activeQuery = (value ?? query).trim().toLowerCase();
	const results = useMemo(() => {
		if (!activeQuery) return [];
		return profiles.filter((p) => p.userId && p.userId !== user?.id).filter((p) => {
			const handle = (p.handle || "").toLowerCase();
			const username = (p.username || "").toLowerCase();
			const first = (p.firstName || "").toLowerCase();
			const last = (p.lastName || "").toLowerCase();
			const full = `${first} ${last}`.trim();
			return handle.includes(activeQuery) || username.includes(activeQuery) || first.includes(activeQuery) || last.includes(activeQuery) || full.includes(activeQuery);
		}).slice(0, 6);
	}, [
		activeQuery,
		profiles,
		user?.id
	]);
	if (!user) return null;
	return /* @__PURE__ */ jsx("div", {
		className: "topbar",
		ref: wrapperRef,
		children: /* @__PURE__ */ jsx("div", {
			className: "topbar-inner",
			children: /* @__PURE__ */ jsxs("div", {
				className: "topbar-search",
				children: [/* @__PURE__ */ jsx("input", {
					type: "text",
					value: value ?? query,
					onChange: (e) => updateQuery(e.target.value),
					onFocus: () => setOpen(Boolean((value ?? query).trim())),
					placeholder: "Search by handle or name",
					"aria-label": "Search by handle or name"
				}), open && /* @__PURE__ */ jsxs("div", {
					className: "topbar-results",
					children: [
						loading && /* @__PURE__ */ jsx("div", {
							className: "topbar-status",
							children: "Loading directory..."
						}),
						error && /* @__PURE__ */ jsx("div", {
							className: "topbar-status",
							children: error
						}),
						!loading && !error && results.length === 0 && /* @__PURE__ */ jsx("div", {
							className: "topbar-status",
							children: "No matches found."
						}),
						!loading && !error && results.map((profile) => {
							const status = relationStatusFor(profile.userId);
							const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
							return /* @__PURE__ */ jsxs("div", {
								className: "topbar-result",
								children: [
									profile.avatarUrl ? /* @__PURE__ */ jsx("img", {
										src: profile.avatarUrl,
										alt: profile.handle || profile.username || "Profile",
										className: "topbar-avatar",
										loading: "lazy"
									}) : /* @__PURE__ */ jsx("div", {
										className: "topbar-avatar fallback",
										"aria-hidden": "true",
										children: (profile.handle || profile.username || "U").charAt(0).toUpperCase()
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "topbar-result-meta",
										children: [/* @__PURE__ */ jsx("strong", { children: fullName || profile.handle || profile.username || "User" }), /* @__PURE__ */ jsxs("span", { children: ["@", profile.handle || profile.username || "user"] })]
									}),
									/* @__PURE__ */ jsx("div", {
										className: "topbar-result-actions",
										children: status === "accepted" ? /* @__PURE__ */ jsx("span", {
											className: "topbar-chip",
											children: "Friends"
										}) : status === "pending" ? /* @__PURE__ */ jsx("span", {
											className: "topbar-chip",
											children: "Requested"
										}) : /* @__PURE__ */ jsx("button", {
											type: "button",
											className: "btn ghost topbar-add",
											onClick: () => requestFriend(profile),
											disabled: busyId === profile.userId,
											children: busyId === profile.userId ? "Sending..." : "Add"
										})
									})
								]
							}, profile.id);
						})
					]
				})]
			})
		})
	});
}
var DEFAULT_PREFERENCES = {
	backgrounds: {
		dashboard: {},
		profile: {},
		friends: {}
	},
	chat: {
		width: 360,
		height: 520,
		fontSize: 14
	}
};
var STORAGE_KEY$1 = "user_preferences_v1";
var apiBase = "http://localhost:1337/api".replace(/\/api$/, "");
var normalizeImage = (value) => {
	if (value === void 0) return void 0;
	if (value === "") return "";
	if (value.startsWith("data:") || value.startsWith("http")) return value;
	if (value.startsWith("/")) return `${apiBase}${value}`;
	return value;
};
var stripApiBase = (value) => {
	if (!value || !apiBase) return value;
	return value.startsWith(apiBase) ? value.slice(apiBase.length) || "/" : value;
};
var safeParseJson$1 = (value) => {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};
var mergeBackgrounds = (current, incoming) => {
	const next = { ...current };
	[
		"dashboard",
		"profile",
		"friends"
	].forEach((page) => {
		const entry = incoming?.[page];
		if (entry && typeof entry === "object") {
			const color = typeof entry.color === "string" ? entry.color : void 0;
			const image = typeof entry.image === "string" ? normalizeImage(entry.image) : void 0;
			next[page] = {
				...current[page],
				...color !== void 0 ? { color } : {},
				...image !== void 0 ? { image } : {}
			};
		}
	});
	return next;
};
var UserPreferencesContext = createContext(void 0);
const UserPreferencesProvider = ({ children }) => {
	const { user } = useAuth();
	const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
	const readyRef = useRef(false);
	const saveTimeoutRef = useRef(null);
	const storageKey = user?.id ? `${STORAGE_KEY$1}_${user.id}` : STORAGE_KEY$1;
	useEffect(() => {
		if (typeof window === "undefined") return;
		let active = true;
		readyRef.current = false;
		const raw = safeParseJson$1(localStorage.getItem(storageKey));
		if (raw && typeof raw === "object") setPreferences({
			...DEFAULT_PREFERENCES,
			...raw,
			backgrounds: mergeBackgrounds(DEFAULT_PREFERENCES.backgrounds, raw.backgrounds || {}),
			chat: {
				...DEFAULT_PREFERENCES.chat,
				...raw.chat || {}
			}
		});
		else setPreferences(DEFAULT_PREFERENCES);
		const loadRemote = async () => {
			if (!user?.id) {
				if (active) readyRef.current = true;
				return;
			}
			try {
				const data = (await strapi_default.get("/profiles/me")).data?.data;
				const attrs = data?.attributes ?? data ?? {};
				if (attrs?.backgrounds && typeof attrs.backgrounds === "object") setPreferences((prev) => ({
					...prev,
					backgrounds: mergeBackgrounds(prev.backgrounds, attrs.backgrounds)
				}));
			} catch {} finally {
				if (active) readyRef.current = true;
			}
		};
		loadRemote();
		return () => {
			active = false;
		};
	}, [storageKey, user?.id]);
	useEffect(() => {
		if (typeof window === "undefined") return;
		localStorage.setItem(storageKey, JSON.stringify(preferences));
	}, [preferences, storageKey]);
	const saveBackgrounds = useCallback(async (backgrounds) => {
		if (!user?.id) return;
		const payload = { ...backgrounds };
		Object.keys(payload).forEach((page) => {
			const image = payload[page]?.image;
			if (typeof image === "string") payload[page] = {
				...payload[page],
				image: stripApiBase(image)
			};
		});
		try {
			await strapi_default.put("/profiles/me", { data: { backgrounds: payload } });
		} catch {}
	}, [user?.id]);
	useEffect(() => {
		if (!user?.id || !readyRef.current) return;
		if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
		saveTimeoutRef.current = window.setTimeout(() => {
			saveBackgrounds(preferences.backgrounds);
		}, 600);
		return () => {
			if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
		};
	}, [
		preferences.backgrounds,
		saveBackgrounds,
		user?.id
	]);
	const setBackground = useCallback((page, updates) => {
		const image = updates.image !== void 0 ? normalizeImage(updates.image) : void 0;
		const nextUpdates = image !== void 0 ? {
			...updates,
			image
		} : updates;
		setPreferences((prev) => ({
			...prev,
			backgrounds: {
				...prev.backgrounds,
				[page]: {
					...prev.backgrounds[page],
					...nextUpdates
				}
			}
		}));
	}, []);
	const setBackgroundAll = useCallback((updates) => {
		const image = updates.image !== void 0 ? normalizeImage(updates.image) : void 0;
		const nextUpdates = image !== void 0 ? {
			...updates,
			image
		} : updates;
		setPreferences((prev) => {
			const nextBackgrounds = { ...prev.backgrounds };
			Object.keys(nextBackgrounds).forEach((page) => {
				nextBackgrounds[page] = {
					...nextBackgrounds[page],
					...nextUpdates
				};
			});
			return {
				...prev,
				backgrounds: nextBackgrounds
			};
		});
	}, []);
	const resetBackground = useCallback((page) => {
		setPreferences((prev) => ({
			...prev,
			backgrounds: {
				...prev.backgrounds,
				[page]: {}
			}
		}));
	}, []);
	const resetBackgroundAll = useCallback(() => {
		setPreferences((prev) => ({
			...prev,
			backgrounds: { ...DEFAULT_PREFERENCES.backgrounds }
		}));
	}, []);
	const setChatPrefs = useCallback((updates) => {
		setPreferences((prev) => ({
			...prev,
			chat: {
				...prev.chat,
				...updates
			}
		}));
	}, []);
	const getBackgroundStyle = useCallback((page) => {
		const bg = preferences.backgrounds[page];
		const color = (bg?.color || "").trim();
		const image = (normalizeImage(bg?.image || "") || "").trim();
		if (!color && !image) return void 0;
		const overlay = "linear-gradient(120deg, rgba(7, 9, 17, 0.65), rgba(7, 9, 17, 0.92))";
		const imageLayer = image ? `url(\"${image}\")` : "none";
		const backgroundImage = image ? `${overlay}, ${imageLayer}` : "none";
		return {
			backgroundColor: color || "#0b0d14",
			backgroundImage,
			backgroundSize: image ? "cover" : void 0,
			backgroundPosition: image ? "center" : void 0,
			backgroundRepeat: image ? "no-repeat" : void 0,
			backgroundAttachment: image ? "fixed" : void 0
		};
	}, [preferences.backgrounds]);
	const value = useMemo(() => ({
		preferences,
		setBackground,
		setBackgroundAll,
		resetBackground,
		resetBackgroundAll,
		setChatPrefs,
		getBackgroundStyle
	}), [
		getBackgroundStyle,
		preferences,
		resetBackground,
		resetBackgroundAll,
		setBackground,
		setBackgroundAll,
		setChatPrefs
	]);
	return /* @__PURE__ */ jsx(UserPreferencesContext.Provider, {
		value,
		children
	});
};
const useUserPreferences = () => {
	const context = useContext(UserPreferencesContext);
	if (!context) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
	return context;
};
var PREVIEW_DEBOUNCE_MS$1 = 450;
var extractFirstUrl$3 = (text) => {
	const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
	if (!match) return "";
	let url = match[0].replace(/[),.!?]+$/, "");
	if (url.startsWith("www.")) url = `https://${url}`;
	return url;
};
var hostnameFor$2 = (value) => {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
};
var isYoutubeUrl$2 = (value) => {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host.includes("youtube.com") || host === "youtu.be";
	} catch {
		return false;
	}
};
var isVideoUrl$1 = (value) => !!value && /\.(mp4|webm|mov)$/i.test(value);
var mediaDescriptor$1 = (mediaUrl, hasLink) => {
	if (mediaUrl) return isVideoUrl$1(mediaUrl) ? "with a video" : "with a picture";
	if (hasLink) return "with a link";
	return "";
};
var MOTIVATIONAL_PHRASES = [
	"Small steps today build the momentum you want tomorrow.",
	"Show up for yourself and the win will follow.",
	"Progress over perfection, always.",
	"Keep going. Your future self is already grateful.",
	"Consistency beats intensity. You have this.",
	"One focused action can change your whole day.",
	"You do not need to be perfect, just present.",
	"Start where you are and make the next right move.",
	"A calm mind creates strong progress.",
	"Choose progress, even if it is tiny.",
	"Your effort today is the seed of tomorrow.",
	"Keep the promise you made to yourself.",
	"You are closer than you think.",
	"One step forward is still forward.",
	"Little wins stack into big wins.",
	"You are building something that matters.",
	"Your pace is valid. Keep moving.",
	"Focus on what you can do in the next 10 minutes.",
	"Consistency turns dreams into plans.",
	"Take the next small action and breathe.",
	"Momentum loves a simple start.",
	"Be proud of showing up today.",
	"Quiet effort makes loud results.",
	"You can do hard things, one step at a time.",
	"Your future is shaped by what you do today.",
	"Choose progress over pressure.",
	"The habit is the win.",
	"Stay curious, stay kind, keep going.",
	"You are not behind. You are building.",
	"Your small action is still brave.",
	"Today counts, even if it feels ordinary.",
	"Make it simple. Then make it happen.",
	"Keep your focus narrow and your hope wide.",
	"You have what you need to begin.",
	"Your effort is already a success.",
	"Strong days start with one clear choice.",
	"Your goals want your attention, not your stress.",
	"One honest step beats ten perfect plans.",
	"You are doing better than you think.",
	"Keep your energy for what matters most.",
	"Be steady, be kind, be consistent.",
	"Your progress is real. Keep showing up.",
	"Let today be the day you move forward.",
	"Do the next doable thing.",
	"You are allowed to grow at your speed.",
	"Small moves, big direction.",
	"Every rep makes you stronger.",
	"Your momentum is building right now.",
	"Focus on the process and the results will follow.",
	"You are a builder. Keep building.",
	"You are stronger than your last excuse.",
	"Start small. Finish proud.",
	"Choose action over doubt.",
	"Your future self says thank you.",
	"Keep your eyes on the next step.",
	"Discipline is a gift you give yourself.",
	"You can reset and restart any time.",
	"Consistency is your superpower.",
	"Your effort is the plan.",
	"Do it imperfectly, do it today.",
	"Keep going, your growth is showing.",
	"One brave step changes everything.",
	"You are not alone in the work.",
	"Focus, breathe, move forward.",
	"You are creating your own momentum.",
	"The smallest step still moves you ahead.",
	"Your courage is in the try.",
	"Be the friend you need today.",
	"Progress loves patience.",
	"Let your actions speak louder than your doubts.",
	"Simple and steady beats rushed and messy.",
	"You are building trust with yourself.",
	"Your best effort today is enough.",
	"You have the power to choose a better next step.",
	"Keep your goals close and your worries far.",
	"You can do one more small thing.",
	"Your growth is worth the time.",
	"Show up. Breathe. Begin.",
	"You are building a life you believe in.",
	"Do the work, keep the faith.",
	"One good choice can set the tone for the day.",
	"You are capable of steady progress.",
	"Take the next step, then the next.",
	"You do not have to rush. Just continue.",
	"Your progress is proof of your strength.",
	"Keep your eyes on what you can control.",
	"Today is a fresh chance to try.",
	"Make it simple, make it consistent.",
	"You are doing the right kind of hard work.",
	"Your effort is building real change.",
	"Trust the process and keep your focus.",
	"You are allowed to be a work in progress.",
	"One focused hour beats a scattered day.",
	"You are capable of more than you feel today.",
	"Keep the routine, keep the dream.",
	"Progress is built in the quiet moments.",
	"Your dedication is paying off.",
	"Choose a small win right now.",
	"You are making steady forward motion.",
	"Do not quit. Adjust and continue.",
	"Your consistency is your edge.",
	"You are doing something meaningful today.",
	"Keep going. Your momentum is real."
];
var LinkPreviewCard$2 = ({ preview, url, compact = false }) => {
	const title = preview.title || preview.siteName || hostnameFor$2(url);
	const meta = preview.siteName || hostnameFor$2(url);
	const showBadge = preview.type === "video" || isYoutubeUrl$2(url);
	return /* @__PURE__ */ jsxs("a", {
		className: `link-preview-card${compact ? " is-compact" : ""}`,
		href: url,
		target: "_blank",
		rel: "noreferrer",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "link-preview-media",
			children: [preview.image ? /* @__PURE__ */ jsx("img", {
				src: preview.image,
				alt: title,
				loading: "lazy"
			}) : /* @__PURE__ */ jsx("div", {
				className: "link-preview-placeholder",
				children: "LINK"
			}), showBadge && /* @__PURE__ */ jsx("span", {
				className: "link-preview-badge",
				children: "Video"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "link-preview-body",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "link-preview-title",
					children: title
				}),
				preview.description && /* @__PURE__ */ jsx("p", {
					className: "link-preview-desc",
					children: preview.description
				}),
				/* @__PURE__ */ jsx("span", {
					className: "link-preview-url",
					children: meta
				})
			]
		})]
	});
};
function Dashboard() {
	const [posts, setPosts] = useState({
		admin: [],
		user: [],
		comments: []
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [formContent, setFormContent] = useState("");
	const [formFile, setFormFile] = useState(null);
	const [formError, setFormError] = useState(null);
	const [submitting, setSubmitting] = useState(false);
	const [commentInputs, setCommentInputs] = useState({});
	const [linkPreview, setLinkPreview] = useState(null);
	const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
	const [linkPreviewError, setLinkPreviewError] = useState(null);
	const [previewCache, setPreviewCache] = useState({});
	const navigate = useNavigate();
	const { user } = useAuth();
	const { getBackgroundStyle } = useUserPreferences();
	usePageMeta({
		title: "Dashboard | Stick2YourDreams Connect",
		description: "Share updates, celebrate wins, and stay accountable with your Stick2YourDreams community.",
		type: "website",
		robots: "noindex, nofollow"
	});
	const userLabel = user?.username || user?.email || "Guest";
	const userInitial = userLabel.charAt(0).toUpperCase();
	useEffect(() => {
		let cancelled = false;
		const loadPosts = async () => {
			setLoading(true);
			setError(null);
			if (!localStorage.getItem("token")) {
				setLoading(false);
				navigate("/login");
				return;
			}
			try {
				const [adminRes, userRes, commentsRes] = await Promise.all([
					strapi_default.get("/posts?populate=Pictures"),
					strapi_default.get("/users-posts?populate=Users_Pictures&populate=owner"),
					strapi_default.get("/comments?populate=owner")
				]);
				const allComments = commentsRes.data?.data ?? [];
				if (cancelled) return;
				setPosts({
					admin: adminRes.data?.data ?? [],
					user: userRes.data?.data ?? [],
					comments: allComments
				});
			} catch (err) {
				if (cancelled) return;
				if (axios.isAxiosError(err)) {
					const status = err.response?.status;
					const data = err.response?.data;
					const msg = data?.error?.message || data?.message || "Failed to load posts";
					if (status === 401) {
						setError(`401 Unauthorized. Token still in storage: ${!!localStorage.getItem("token")}. Message: ${msg}`);
						return;
					}
					if (status === 403) {
						setError("403 Forbidden: Enable Authenticated role permissions for Posts (find/findOne) in Strapi.");
						return;
					}
					setError(msg);
				} else setError("Failed to load posts");
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		loadPosts();
		return () => {
			cancelled = true;
		};
	}, [navigate]);
	const fetchLinkPreview = async (url, options) => {
		if (!url) return null;
		if (previewCache[url] !== void 0) return previewCache[url];
		if (!options?.silent) {
			setLinkPreviewLoading(true);
			setLinkPreviewError(null);
		}
		try {
			const data = (await strapi_default.get("/link-preview", { params: { url } })).data?.data;
			const preview = data?.url ? {
				url: data.url,
				title: data.title,
				description: data.description,
				image: data.image,
				siteName: data.siteName,
				type: data.type
			} : null;
			setPreviewCache((prev) => ({
				...prev,
				[url]: preview
			}));
			return preview;
		} catch {
			setPreviewCache((prev) => ({
				...prev,
				[url]: null
			}));
			if (!options?.silent) setLinkPreviewError("Unable to load link preview.");
			return null;
		} finally {
			if (!options?.silent) setLinkPreviewLoading(false);
		}
	};
	const normalizedPosts = useMemo(() => {
		const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
		const allComments = posts.comments ?? [];
		const normalize$3 = (p, source) => {
			const attributes = p?.attributes ?? p ?? {};
			const title = attributes.Title || attributes.title || "Untitled";
			const content = attributes.Posts_Content || attributes.Users_Content || attributes.content || "";
			const picturesRaw = attributes.Pictures?.data ?? attributes.Pictures ?? attributes.Users_Pictures?.data ?? attributes.Users_Pictures ?? attributes.pictures?.data ?? attributes.pictures;
			const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
			const mediaAttr = mediaItem?.attributes ?? mediaItem;
			const formats = mediaAttr?.formats;
			let imageUrl = mediaAttr?.url || formats?.large?.url || formats?.medium?.url || formats?.small?.url || formats?.thumbnail?.url;
			if (imageUrl && imageUrl.startsWith("/")) imageUrl = `${apiBase$2}${imageUrl}`;
			const targetIdStr = String(p.id ?? "");
			const matchedComments = allComments.filter((c) => {
				const targetType = String(c?.target_type ?? "").toLowerCase();
				const targetId = String(c?.target_id ?? "");
				return targetType === source && targetId === targetIdStr;
			}).map((c) => ({
				id: c.id,
				body: c.body,
				owner: c.attributes?.owner?.data?.attributes?.username || c.owner?.username || c.owner || "User",
				ownerId: c.attributes?.owner?.data?.id || c.owner?.id
			}));
			const ownerData = attributes.owner?.data ?? attributes.owner;
			const ownerAttrs = ownerData?.attributes ?? ownerData;
			const ownerId = ownerData?.id ?? (typeof ownerData === "number" ? ownerData : ownerAttrs?.id);
			const ownerName = source === "user" ? ownerAttrs?.username || ownerAttrs?.email || "User" : "S2YD";
			return {
				id: p.id ?? p.documentId ?? title,
				title,
				content,
				imageUrl,
				createdAt: attributes.createdAt,
				source,
				ownerName,
				ownerId,
				comments: matchedComments
			};
		};
		const adminPosts = Array.isArray(posts?.admin) ? posts.admin.map((p) => normalize$3(p, "admin")) : [];
		const userPosts = Array.isArray(posts?.user) ? posts.user.map((p) => normalize$3(p, "user")) : [];
		return [...adminPosts, ...userPosts];
	}, [posts]);
	useEffect(() => {
		const url = extractFirstUrl$3(formContent);
		if (!url) {
			setLinkPreview(null);
			setLinkPreviewError(null);
			setLinkPreviewLoading(false);
			return;
		}
		setLinkPreviewError(null);
		if (linkPreview?.url === url) return;
		const cached = previewCache[url];
		if (cached !== void 0) {
			setLinkPreview(cached);
			return;
		}
		let active = true;
		const handle = setTimeout(() => {
			fetchLinkPreview(url).then((preview) => {
				if (!active) return;
				setLinkPreview(preview);
			});
		}, PREVIEW_DEBOUNCE_MS$1);
		return () => {
			active = false;
			clearTimeout(handle);
		};
	}, [
		formContent,
		linkPreview?.url,
		previewCache
	]);
	useEffect(() => {
		const urls = Array.from(new Set(normalizedPosts.map((post) => extractFirstUrl$3(post.content)).filter((url) => url)));
		if (!urls.length) return;
		urls.forEach((url) => {
			if (previewCache[url] !== void 0) return;
			fetchLinkPreview(url, { silent: true });
		});
	}, [normalizedPosts, previewCache]);
	const formatDate = (date) => {
		if (!date) return "";
		try {
			return new Intl.DateTimeFormat("en", {
				month: "short",
				day: "numeric",
				year: "numeric"
			}).format(new Date(date));
		} catch {
			return date;
		}
	};
	const greeting = useMemo(() => {
		const hour = (/* @__PURE__ */ new Date()).getHours();
		if (hour < 12) return "Good Morning";
		if (hour < 18) return "Good Afternoon";
		return "Good Evening";
	}, []);
	const motivation = useMemo(() => {
		return MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)] || "Keep showing up for yourself.";
	}, []);
	const createPost = async () => {
		const content = formContent.trim();
		if (!content && !formFile) {
			setFormError("Add a message or a photo to post.");
			return;
		}
		const url = extractFirstUrl$3(content);
		const derivedTitle = (linkPreview?.url === url ? linkPreview.title : void 0) || (url ? hostnameFor$2(url) : "") || content || "Post";
		setFormError(null);
		setSubmitting(true);
		try {
			let uploadedId;
			if (formFile) {
				const fd = new FormData();
				fd.append("files", formFile);
				uploadedId = ((await strapi_default.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } })).data?.[0])?.id;
			}
			await strapi_default.post("/users-posts", { data: {
				Title: String(derivedTitle).slice(0, 80) || "Post",
				Users_Content: content,
				owner: user?.id,
				Users_Pictures: uploadedId ? [uploadedId] : void 0
			} });
			setFormContent("");
			setFormFile(null);
			setLinkPreview(null);
			setLinkPreviewError(null);
			const [adminRes, userRes] = await Promise.all([strapi_default.get("/posts?populate=Pictures"), strapi_default.get("/users-posts?populate=Users_Pictures&populate=owner")]);
			const commentsRes = await strapi_default.get("/comments?populate=owner");
			setPosts({
				admin: adminRes.data?.data ?? [],
				user: userRes.data?.data ?? [],
				comments: commentsRes.data?.data ?? []
			});
		} catch (err) {
			if (axios.isAxiosError(err)) setFormError(err.response?.data?.error?.message || err.response?.data?.message || "Failed to create post");
			else setFormError("Failed to create post");
		} finally {
			setSubmitting(false);
		}
	};
	const deletePost = async (postId) => {
		if (!window.confirm("Delete this post?")) return;
		try {
			await strapi_default.delete(`/users-posts/${postId}`);
			setPosts((prev) => ({
				...prev,
				user: (prev.user || []).filter((p) => Number(p.id ?? p.documentId) !== postId)
			}));
		} catch (err) {
			console.error("Delete post failed", err);
			setError("Failed to delete post");
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "dashboard-shell",
		style: getBackgroundStyle("dashboard"),
		children: [/* @__PURE__ */ jsx(Sidebar, { active: "dashboard" }), /* @__PURE__ */ jsxs("div", {
			className: "main-content",
			children: [
				user && /* @__PURE__ */ jsxs("div", {
					className: "topbar-greeting",
					children: [/* @__PURE__ */ jsxs("span", {
						className: "topbar-greeting-title",
						children: [
							greeting,
							" ",
							userLabel
						]
					}), /* @__PURE__ */ jsx("span", {
						className: "topbar-greeting-sub",
						children: motivation
					})]
				}),
				/* @__PURE__ */ jsx(TopbarSearch, {}),
				/* @__PURE__ */ jsxs("div", {
					className: "dash-hero",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "dash-hero__text",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "eyebrow",
								children: "S2YD"
							}),
							/* @__PURE__ */ jsx("h1", { children: "Posts" }),
							/* @__PURE__ */ jsx("p", {
								className: "subhead",
								children: "Fresh drops from the community. Rich cards, crisp typography, and cover art when available."
							})
						]
					}), /* @__PURE__ */ jsxs("div", {
						className: "hero-badge",
						style: {
							display: "flex",
							alignItems: "center",
							gap: "10px"
						},
						children: [/* @__PURE__ */ jsx("span", {
							className: "pill",
							title: "Live",
							children: "Live"
						}), /* @__PURE__ */ jsxs("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "10px"
							},
							children: [/* @__PURE__ */ jsx("div", {
								style: {
									width: 36,
									height: 36,
									borderRadius: "50%",
									background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
									display: "grid",
									placeItems: "center",
									color: "#fff",
									fontWeight: 700
								},
								children: userInitial
							}), /* @__PURE__ */ jsxs("div", {
								style: { lineHeight: 1.2 },
								children: [/* @__PURE__ */ jsx("div", {
									style: {
										fontSize: "12px",
										color: "#9ca3af"
									},
									children: "Signed in as"
								}), /* @__PURE__ */ jsx("div", {
									style: { fontWeight: 600 },
									children: userLabel
								})]
							})]
						})]
					})]
				}),
				loading && /* @__PURE__ */ jsx("p", {
					className: "status",
					children: "Loading posts…"
				}),
				error && /* @__PURE__ */ jsx("p", {
					className: "status status-error",
					children: error
				}),
				!loading && !error && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
					className: "panel-grid",
					children: /* @__PURE__ */ jsxs("section", {
						className: "panel post-composer",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "panel-header",
								children: /* @__PURE__ */ jsxs("div", { children: [
									/* @__PURE__ */ jsx("p", {
										className: "eyebrow",
										children: "Create"
									}),
									/* @__PURE__ */ jsx("h3", { children: "New Post" }),
									/* @__PURE__ */ jsx("p", {
										className: "panel-sub",
										children: "Let Your Friends Know What You're Up To!"
									})
								] })
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "post-composer__top",
								children: [/* @__PURE__ */ jsx("div", {
									className: "post-composer__avatar",
									children: /* @__PURE__ */ jsx("span", { children: userInitial })
								}), /* @__PURE__ */ jsxs("div", {
									className: "post-composer__input",
									children: [/* @__PURE__ */ jsx("textarea", {
										className: "auth-input",
										value: formContent,
										onChange: (e) => {
											setFormContent(e.target.value);
											setFormError(null);
										},
										placeholder: "What's on your mind? Drop a YouTube link or article.",
										rows: 4
									}), linkPreviewLoading && /* @__PURE__ */ jsx("span", {
										className: "post-composer__hint",
										children: "Loading preview..."
									})]
								})]
							}),
							linkPreview && /* @__PURE__ */ jsx(LinkPreviewCard$2, {
								preview: linkPreview,
								url: linkPreview.url || extractFirstUrl$3(formContent)
							}),
							linkPreviewError && /* @__PURE__ */ jsx("p", {
								className: "status status-error",
								children: linkPreviewError
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "post-composer__actions",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "post-composer__tools",
									children: [
										/* @__PURE__ */ jsxs("label", {
											className: "post-composer__tool",
											children: [/* @__PURE__ */ jsx("input", {
												type: "file",
												accept: "image/*",
												onChange: (e) => {
													setFormFile(e.target.files?.[0] || null);
													setFormError(null);
												}
											}), /* @__PURE__ */ jsx("span", { children: formFile ? "Change media" : "Add photo/video" })]
										}),
										/* @__PURE__ */ jsx("span", {
											className: "post-composer__file",
											children: formFile ? formFile.name : "No media selected"
										}),
										formFile && /* @__PURE__ */ jsx("button", {
											className: "btn ghost",
											type: "button",
											onClick: () => setFormFile(null),
											children: "Remove"
										})
									]
								}), /* @__PURE__ */ jsx("button", {
									className: "btn primary",
									type: "button",
									disabled: submitting,
									onClick: createPost,
									children: submitting ? "Posting..." : "Post"
								})]
							}),
							formError && /* @__PURE__ */ jsx("p", {
								className: "auth-message error",
								children: formError
							})
						]
					})
				}), /* @__PURE__ */ jsxs("div", {
					className: "posts-grid posts-grid--two",
					children: [normalizedPosts.length === 0 && /* @__PURE__ */ jsx("div", {
						className: "empty-state",
						children: /* @__PURE__ */ jsx("p", { children: "No posts yet. Add one in Strapi to see it here." })
					}), normalizedPosts.map((post) => {
						const postUrl = extractFirstUrl$3(post.content);
						const preview = postUrl ? previewCache[postUrl] : void 0;
						const hasLink = Boolean(postUrl);
						const descriptor = mediaDescriptor$1(post.imageUrl, hasLink);
						const previewImage = preview?.image;
						const showPreviewMedia = !post.imageUrl && !!previewImage;
						const showPlaceholder = !post.imageUrl && !previewImage;
						const authorLabel = post.ownerName || "User";
						const postId = Number(post.id);
						const canDelete = post.source === "user" && Number.isFinite(postId) && user?.id === post.ownerId;
						return /* @__PURE__ */ jsxs("article", {
							className: "post-card",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "post-meta-bar",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "post-meta-name",
											children: authorLabel
										}),
										/* @__PURE__ */ jsx("span", {
											className: "post-meta-text",
											children: "just posted an update"
										}),
										descriptor && /* @__PURE__ */ jsx("span", {
											className: "post-meta-tag",
											children: descriptor
										})
									]
								}),
								post.imageUrl ? /* @__PURE__ */ jsx("div", {
									className: "post-media",
									children: isVideoUrl$1(post.imageUrl) ? /* @__PURE__ */ jsx("video", {
										controls: true,
										style: {
											width: "100%",
											height: "100%",
											objectFit: "cover"
										},
										children: /* @__PURE__ */ jsx("source", { src: post.imageUrl })
									}) : /* @__PURE__ */ jsx("img", {
										src: post.imageUrl,
										alt: post.title,
										loading: "lazy"
									})
								}) : showPreviewMedia ? /* @__PURE__ */ jsx("div", {
									className: "post-media",
									children: /* @__PURE__ */ jsx("img", {
										src: previewImage,
										alt: preview?.title || post.title,
										loading: "lazy"
									})
								}) : showPlaceholder ? /* @__PURE__ */ jsxs("div", {
									className: "post-media placeholder",
									children: [/* @__PURE__ */ jsx("div", { className: "dots" }), /* @__PURE__ */ jsx("span", { children: "No image" })]
								}) : null,
								/* @__PURE__ */ jsxs("div", {
									className: "post-body",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "post-meta",
											children: [/* @__PURE__ */ jsx("span", {
												className: "pill subtle",
												children: "Feature"
											}), /* @__PURE__ */ jsxs("div", {
												className: "post-meta-right",
												children: [post.createdAt && /* @__PURE__ */ jsx("span", {
													className: "date",
													children: formatDate(post.createdAt)
												}), canDelete && /* @__PURE__ */ jsx("button", {
													className: "btn ghost post-delete",
													type: "button",
													onClick: () => deletePost(postId),
													children: "Delete"
												})]
											})]
										}),
										/* @__PURE__ */ jsx("h3", { children: post.title }),
										/* @__PURE__ */ jsx("p", { children: post.content }),
										preview && !post.imageUrl && /* @__PURE__ */ jsx(LinkPreviewCard$2, {
											preview,
											url: preview.url || postUrl,
											compact: true
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "comments",
											children: [
												/* @__PURE__ */ jsx("p", {
													className: "eyebrow",
													children: "Comments"
												}),
												post.comments && post.comments.length > 0 ? /* @__PURE__ */ jsx("ul", {
													className: "comment-list",
													children: post.comments.map((c) => /* @__PURE__ */ jsxs("li", {
														className: "comment-item",
														children: [
															/* @__PURE__ */ jsx("div", {
																className: "comment-author",
																children: c.owner || "User"
															}),
															/* @__PURE__ */ jsx("div", {
																className: "comment-body",
																children: c.body
															}),
															user?.id === c.ownerId && /* @__PURE__ */ jsx("button", {
																className: "btn ghost comment-delete",
																type: "button",
																onClick: async () => {
																	try {
																		await strapi_default.delete(`/comments/${c.id}`);
																		setPosts((prev) => ({
																			...prev,
																			comments: (prev.comments || []).filter((cc) => cc.id !== c.id)
																		}));
																	} catch (err) {
																		console.error("Delete comment failed", err);
																		setError("Failed to delete comment");
																	}
																},
																children: "Delete"
															})
														]
													}, c.id))
												}) : /* @__PURE__ */ jsx("p", {
													className: "status",
													children: "No comments yet."
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "comment-form",
													children: [/* @__PURE__ */ jsx("input", {
														className: "auth-input",
														placeholder: "Add a comment...",
														value: commentInputs[post.id] || "",
														onChange: (e) => setCommentInputs((prev) => ({
															...prev,
															[post.id]: e.target.value
														}))
													}), /* @__PURE__ */ jsx("button", {
														className: "btn primary",
														type: "button",
														disabled: !commentInputs[post.id]?.trim(),
														onClick: async () => {
															const body = (commentInputs[post.id] || "").trim();
															if (!body) return;
															try {
																await strapi_default.post("/comments", { data: {
																	body,
																	target_type: post.source === "admin" ? "admin" : "user",
																	target_id: post.id
																} });
																const res = await strapi_default.get("/comments?populate=owner");
																setPosts((prev) => ({
																	...prev,
																	comments: res.data?.data ?? []
																}));
																setCommentInputs((prev) => ({
																	...prev,
																	[post.id]: ""
																}));
															} catch (err) {
																console.error("Add comment failed", err);
																if (axios.isAxiosError(err)) {
																	const msg = err.response?.data?.error?.message || err.response?.data?.message || "Failed to add comment";
																	setError(String(msg));
																} else setError("Failed to add comment");
															}
														},
														children: "Comment"
													})]
												})
											]
										})
									]
								})
							]
						}, post.id);
					})]
				})] })
			]
		})]
	});
}
function ProtectedRoute({ children }) {
	const { user, profile, profileLoading } = useAuth();
	const location = useLocation();
	if (!user) return /* @__PURE__ */ jsx(Navigate, {
		to: "/login",
		replace: true
	});
	if (profileLoading && !profile) return null;
	if (!profile?.onboardingComplete && location.pathname !== "/me") return /* @__PURE__ */ jsx(Navigate, {
		to: "/me",
		replace: true
	});
	return children;
}
var CHAT_STORE_KEY = "chatLogs_v1";
var CHAT_ACTIVE_KEY = "chatActiveFriend_v1";
var CHAT_MIN_KEY = "chatMinimized_v1";
var CHAT_DRAFT_KEY = "chatDrafts_v1";
var CHAT_GIF_KEY = "chatGifDrafts_v1";
var CHAT_TTL_MS = 4 * 365 * 24 * 60 * 60 * 1e3;
var CHAT_REFRESH_MS = 1e4;
var normalize = (entry) => entry?.attributes ?? entry ?? {};
var getEntity = (entry) => entry?.data ?? entry ?? null;
var getEntityId = (entry) => {
	const data = getEntity(entry);
	const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
	const num = Number(rawId);
	return Number.isFinite(num) ? num : void 0;
};
var safeParseJson = (value) => {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};
var pruneLogs = (logs) => {
	const cutoff = Date.now() - CHAT_TTL_MS;
	const pruned = {};
	Object.entries(logs).forEach(([key, msgs]) => {
		const filtered = msgs.filter((m) => {
			const t = new Date(m.at).getTime();
			return Number.isFinite(t) ? t >= cutoff : true;
		});
		if (filtered.length) pruned[key] = filtered;
	});
	return pruned;
};
var ChatContext = createContext(void 0);
const ChatProvider = ({ children }) => {
	const { user } = useAuth();
	const userId = user?.id;
	const [activeFriend, setActiveFriend] = useState(null);
	const [popoutMinimized, setPopoutMinimized] = useState(true);
	const [chatLogs, setChatLogs] = useState({});
	const [drafts, setDrafts] = useState({});
	const [gifDrafts, setGifDrafts] = useState({});
	const storageKey = useCallback((base) => userId ? `${base}_${userId}` : base, [userId]);
	useEffect(() => {
		if (!userId) {
			setActiveFriend(null);
			setPopoutMinimized(true);
			setChatLogs({});
			setDrafts({});
			setGifDrafts({});
			return;
		}
		const activeRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_ACTIVE_KEY)));
		setActiveFriend(activeRaw && typeof activeRaw === "object" ? activeRaw : null);
		const minimizedRaw = localStorage.getItem(storageKey(CHAT_MIN_KEY));
		setPopoutMinimized(minimizedRaw === null ? true : minimizedRaw === "true");
		const logsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_STORE_KEY)));
		setChatLogs(logsRaw && typeof logsRaw === "object" ? pruneLogs(logsRaw) : {});
		const draftsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_DRAFT_KEY)));
		setDrafts(draftsRaw && typeof draftsRaw === "object" ? draftsRaw : {});
		const gifsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_GIF_KEY)));
		setGifDrafts(gifsRaw && typeof gifsRaw === "object" ? gifsRaw : {});
	}, [storageKey, userId]);
	useEffect(() => {
		if (!userId) return;
		localStorage.setItem(storageKey(CHAT_ACTIVE_KEY), JSON.stringify(activeFriend));
	}, [
		activeFriend,
		storageKey,
		userId
	]);
	useEffect(() => {
		if (!userId) return;
		localStorage.setItem(storageKey(CHAT_MIN_KEY), String(popoutMinimized));
	}, [
		popoutMinimized,
		storageKey,
		userId
	]);
	useEffect(() => {
		if (!userId) return;
		const pruned = pruneLogs(chatLogs);
		localStorage.setItem(storageKey(CHAT_STORE_KEY), JSON.stringify(pruned));
	}, [
		chatLogs,
		storageKey,
		userId
	]);
	useEffect(() => {
		if (!userId) return;
		localStorage.setItem(storageKey(CHAT_DRAFT_KEY), JSON.stringify(drafts));
	}, [
		drafts,
		storageKey,
		userId
	]);
	useEffect(() => {
		if (!userId) return;
		localStorage.setItem(storageKey(CHAT_GIF_KEY), JSON.stringify(gifDrafts));
	}, [
		gifDrafts,
		storageKey,
		userId
	]);
	const loadConversation = useCallback(async (friendId) => {
		if (!userId || !Number.isFinite(friendId)) return;
		const query = [
			`filters[$or][0][sender][id][$eq]=${userId}`,
			`filters[$or][0][recipient][id][$eq]=${friendId}`,
			`filters[$or][1][sender][id][$eq]=${friendId}`,
			`filters[$or][1][recipient][id][$eq]=${userId}`,
			"sort=createdAt:desc",
			"pagination[pageSize]=200",
			"populate=sender",
			"populate=recipient"
		].join("&");
		try {
			const mapped = ((await strapi_default.get(`/messages?${query}`)).data?.data ?? []).map((m) => {
				const attrs = normalize(m);
				const senderId = getEntityId(attrs.sender);
				return {
					id: m.id ?? attrs.documentId ?? `${senderId}-${attrs.createdAt ?? ""}`,
					body: attrs.body || "",
					from: senderId === userId ? "me" : "them",
					at: attrs.createdAt || (/* @__PURE__ */ new Date()).toISOString()
				};
			});
			mapped.sort((a, b) => {
				const aTime = new Date(a.at).getTime();
				return new Date(b.at).getTime() - aTime;
			});
			setChatLogs((prev) => ({
				...prev,
				[String(friendId)]: mapped
			}));
		} catch {}
	}, [userId]);
	useEffect(() => {
		if (!userId || !activeFriend?.userId) return;
		loadConversation(activeFriend.userId);
		const interval = window.setInterval(() => loadConversation(activeFriend.userId), CHAT_REFRESH_MS);
		return () => window.clearInterval(interval);
	}, [
		activeFriend?.userId,
		loadConversation,
		userId
	]);
	const openChat = useCallback((friend) => {
		if (!friend?.userId) return;
		setActiveFriend(friend);
		setPopoutMinimized(false);
		loadConversation(friend.userId);
	}, [loadConversation]);
	const setDraft = useCallback((friendId, value$1) => {
		if (!Number.isFinite(friendId)) return;
		setDrafts((prev) => ({
			...prev,
			[String(friendId)]: value$1
		}));
	}, []);
	const setGifDraft = useCallback((friendId, value$1) => {
		if (!Number.isFinite(friendId)) return;
		setGifDrafts((prev) => ({
			...prev,
			[String(friendId)]: value$1
		}));
	}, []);
	const sendMessage = useCallback(async (friendId, body) => {
		if (!userId || !Number.isFinite(friendId)) return "Missing sender or recipient.";
		if (!body.trim()) return "Message is empty.";
		try {
			await strapi_default.post("/messages", { data: {
				body,
				recipient: Number(friendId)
			} });
			setDrafts((prev) => ({
				...prev,
				[String(friendId)]: ""
			}));
			setGifDrafts((prev) => ({
				...prev,
				[String(friendId)]: ""
			}));
			await loadConversation(friendId);
			return null;
		} catch (err) {
			if (err && typeof err === "object" && "response" in err) {
				const anyErr = err;
				return anyErr.response?.data?.error?.message || anyErr.response?.data?.message || "Failed to send message";
			}
			return "Failed to send message";
		}
	}, [loadConversation, userId]);
	const value = useMemo(() => ({
		activeFriend,
		popoutMinimized,
		chatLogs,
		drafts,
		gifDrafts,
		openChat,
		setPopoutMinimized,
		setDraft,
		setGifDraft,
		sendMessage
	}), [
		activeFriend,
		chatLogs,
		drafts,
		gifDrafts,
		openChat,
		popoutMinimized,
		sendMessage,
		setDraft,
		setGifDraft,
		setPopoutMinimized
	]);
	return /* @__PURE__ */ jsx(ChatContext.Provider, {
		value,
		children
	});
};
const useChat = () => {
	const context = useContext(ChatContext);
	if (!context) throw new Error("useChat must be used within ChatProvider");
	return context;
};
var extractFirstUrl$2 = (text) => {
	const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
	if (!match) return "";
	let url = match[0].replace(/[),.!?]+$/, "");
	if (url.startsWith("www.")) url = `https://${url}`;
	return url;
};
var normalizeMatch = (value) => String(value || "").trim().toLowerCase();
var parseHobbyList = (value) => String(value || "").split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
var hostnameFor$1 = (value) => {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
};
var isYoutubeUrl$1 = (value) => {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host.includes("youtube.com") || host === "youtu.be";
	} catch {
		return false;
	}
};
var LinkPreviewCard$1 = ({ preview, url, compact = false }) => {
	const safePreview = preview ?? {
		url,
		title: hostnameFor$1(url),
		siteName: hostnameFor$1(url)
	};
	const title = safePreview.title || safePreview.siteName || hostnameFor$1(url);
	const meta = safePreview.siteName || hostnameFor$1(url);
	const showBadge = safePreview.type === "video" || isYoutubeUrl$1(url);
	return /* @__PURE__ */ jsxs("a", {
		className: `link-preview-card${compact ? " is-compact" : ""}`,
		href: url,
		target: "_blank",
		rel: "noreferrer",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "link-preview-media",
			children: [safePreview.image ? /* @__PURE__ */ jsx("img", {
				src: safePreview.image,
				alt: title,
				loading: "lazy"
			}) : /* @__PURE__ */ jsx("div", {
				className: "link-preview-placeholder",
				children: "LINK"
			}), showBadge && /* @__PURE__ */ jsx("span", {
				className: "link-preview-badge",
				children: "Video"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "link-preview-body",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "link-preview-title",
					children: title
				}),
				safePreview.description && /* @__PURE__ */ jsx("p", {
					className: "link-preview-desc",
					children: safePreview.description
				}),
				/* @__PURE__ */ jsx("span", {
					className: "link-preview-url",
					children: meta
				})
			]
		})]
	});
};
function Friends() {
	const { user } = useAuth();
	const { openChat } = useChat();
	const { getBackgroundStyle } = useUserPreferences();
	usePageMeta({
		title: "Friends | Stick2YourDreams Connect",
		description: "Find supportive friends, send messages, and discover new connections based on shared location, hobbies, and faith.",
		type: "website",
		robots: "noindex, nofollow"
	});
	const [query, setQuery] = useState("");
	const [profiles, setProfiles] = useState([]);
	const [friends, setFriends] = useState([]);
	const [postsByOwner, setPostsByOwner] = useState({});
	const [linkPreviews, setLinkPreviews] = useState({});
	const linkPreviewsRef = useRef(linkPreviews);
	useEffect(() => {
		linkPreviewsRef.current = linkPreviews;
	}, [linkPreviews]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const normalize$3 = (entry) => entry?.attributes ?? entry ?? {};
	const getEntity$3 = (entry) => entry?.data ?? entry ?? null;
	const getEntityAttrs$1 = (entry) => {
		const data = getEntity$3(entry);
		return data?.attributes ?? data ?? {};
	};
	const getEntityId$3 = (entry) => {
		const data = getEntity$3(entry);
		const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
		const num = Number(rawId);
		return Number.isFinite(num) ? num : void 0;
	};
	const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
	const pickMediaUrl$1 = (mediaField) => {
		if (!mediaField) return void 0;
		const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
		if (!candidate) return void 0;
		const attrs = normalize$3(candidate);
		let url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
		if (!url) return void 0;
		return url.startsWith("/") ? `${apiBase$2}${url}` : url;
	};
	const fetchLinkPreview = useCallback(async (url) => {
		if (!url) return;
		if (linkPreviewsRef.current[url] !== void 0) return;
		try {
			const data = (await strapi_default.get("/link-preview", { params: { url } })).data?.data;
			const preview = data?.url ? {
				url: data.url,
				title: data.title,
				description: data.description,
				image: data.image,
				siteName: data.siteName,
				type: data.type
			} : null;
			setLinkPreviews((prev) => prev[url] !== void 0 ? prev : {
				...prev,
				[url]: preview
			});
		} catch {
			setLinkPreviews((prev) => prev[url] !== void 0 ? prev : {
				...prev,
				[url]: null
			});
		}
	}, []);
	useEffect(() => {
		const load = async () => {
			if (!user) {
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const mappedProfiles = ((await strapi_default.get("/profiles?populate[0]=user&populate[1]=avatar")).data?.data ?? []).map((p) => {
					const attrs = normalize$3(p);
					const userAttrs = getEntityAttrs$1(attrs.user);
					const userId = getEntityId$3(attrs.user);
					return {
						id: p.id ?? attrs.documentId,
						userId,
						username: userAttrs?.username,
						firstName: attrs.firstName || "",
						lastName: attrs.lastName || "",
						handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
						bio: attrs.bio || "",
						religion: attrs.religion || "",
						hobbies: attrs.hobbies || "",
						country: attrs.country || "",
						state: attrs.state || "",
						city: attrs.city || "",
						avatarUrl: pickMediaUrl$1(attrs.avatar)
					};
				});
				const ownerIds = mappedProfiles.map((p) => typeof p.userId === "number" ? p.userId : void 0).filter((id) => typeof id === "number" && Number.isFinite(id));
				if (ownerIds.length) {
					const ownerFilter = ownerIds.map((id, index) => `filters[owner][id][$in][${index}]=${id}`).join("&");
					const postsRes = await strapi_default.get(`/users-posts?${ownerFilter}&populate=Users_Pictures&populate=owner&sort=createdAt:desc&pagination[pageSize]=200&publicationState=preview`);
					const grouped = {};
					const linkUrls = /* @__PURE__ */ new Set();
					(postsRes.data?.data ?? []).forEach((p) => {
						const attrs = normalize$3(p);
						const ownerId = getEntityId$3(attrs.owner);
						if (!ownerId) return;
						const imageUrl = pickMediaUrl$1(attrs.Users_Pictures);
						const content = attrs.Users_Content || "";
						const linkUrl = extractFirstUrl$2(content);
						if (linkUrl) linkUrls.add(linkUrl);
						(grouped[ownerId] = grouped[ownerId] || []).push({
							id: p.id ?? attrs.documentId,
							title: attrs.Title || "Untitled",
							content,
							imageUrl,
							createdAt: attrs.createdAt,
							linkUrl: linkUrl || void 0
						});
					});
					Object.values(grouped).forEach((list) => {
						list.sort((a, b) => {
							const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
							return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - aTime;
						});
					});
					setPostsByOwner(grouped);
					linkUrls.forEach((url) => {
						fetchLinkPreview(url);
					});
				} else setPostsByOwner({});
				const mappedFriends = ((await strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`)).data?.data ?? []).map((f) => {
					const attrs = normalize$3(f);
					return {
						id: f.id ?? attrs.documentId,
						idNumber: f.id ?? void 0,
						docId: attrs.documentId,
						requesterId: getEntityId$3(attrs.requester),
						targetId: getEntityId$3(attrs.target),
						status: attrs.status || "pending"
					};
				});
				setProfiles(mappedProfiles);
				setFriends(mappedFriends);
			} catch (err) {
				setError("Failed to load friends/profiles");
			} finally {
				setLoading(false);
			}
		};
		load();
	}, [fetchLinkPreview, user]);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = profiles.filter((p) => p.userId !== user?.id);
		if (!q) return list;
		return list.filter((f) => f.handle.toLowerCase().includes(q) || (f.username ?? "").toLowerCase().includes(q) || (f.firstName ?? "").toLowerCase().includes(q) || (f.lastName ?? "").toLowerCase().includes(q) || `${(f.firstName ?? "").toLowerCase()} ${(f.lastName ?? "").toLowerCase()}`.trim().includes(q));
	}, [
		profiles,
		query,
		user
	]);
	const relationStatusFor = (profile) => {
		if (!profile.userId || !friends.length) return null;
		return friends.find((f) => f.requesterId === user?.id && f.targetId === profile.userId || f.targetId === user?.id && f.requesterId === profile.userId)?.status ?? null;
	};
	const addFriend = async (profile) => {
		if (!user || !profile.userId || profile.userId === user.id) return;
		const status = relationStatusFor(profile);
		if (status === "pending" || status === "accepted") return;
		try {
			await strapi_default.post("/friends", { data: {
				target: profile.userId,
				status: "pending",
				locale: "en"
			} });
			setFriends(((await strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`)).data?.data ?? []).map((f) => {
				const attrs = normalize$3(f);
				return {
					id: f.id ?? attrs.documentId,
					idNumber: f.id ?? void 0,
					docId: attrs.documentId,
					requesterId: getEntityId$3(attrs.requester),
					targetId: getEntityId$3(attrs.target),
					status: attrs.status || "pending"
				};
			}));
			setError(null);
		} catch (err) {
			setError("Failed to add friend");
		}
	};
	const acceptFriend = async (relation) => {
		if (!relation?.id) return;
		try {
			const targetDoc = relation.docId ?? (typeof relation.id === "string" ? relation.id : null);
			const targetNum = relation.idNumber ?? (typeof relation.id === "number" ? relation.id : null);
			let updated = false;
			const payload = { data: {
				status: "accepted",
				locale: "en"
			} };
			if (targetNum) try {
				await strapi_default.put(`/friends/${targetNum}`, payload);
				updated = true;
			} catch (err) {
				if (!(err?.response?.status === 404)) throw err;
			}
			if (!updated && targetDoc) {
				await strapi_default.put(`/friends/${targetDoc}?locale=en`, payload);
				updated = true;
			}
			if (!updated) throw new Error("Update failed");
			if (user?.id) setFriends(((await strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`)).data?.data ?? []).map((f) => {
				const attrs = normalize$3(f);
				return {
					id: f.id ?? attrs.documentId,
					idNumber: f.id ?? void 0,
					docId: attrs.documentId,
					requesterId: getEntityId$3(attrs.requester),
					targetId: getEntityId$3(attrs.target),
					status: attrs.status || "pending"
				};
			}));
			setError(null);
		} catch (err) {
			setError("Failed to accept friend");
		}
	};
	const acceptedFriends = useMemo(() => friends.filter((f) => f.status === "accepted").map((f) => {
		const otherId = f.requesterId === user?.id ? f.targetId : f.requesterId;
		return {
			relation: f,
			profile: profiles.find((p) => p.userId === otherId)
		};
	}), [
		friends,
		profiles,
		user?.id
	]);
	const incomingPending = useMemo(() => friends.filter((f) => f.status === "pending" && f.targetId === user?.id).map((f) => {
		const otherId = f.requesterId === user?.id ? f.targetId : f.requesterId;
		return {
			relation: f,
			profile: profiles.find((p) => p.userId === otherId)
		};
	}), [
		friends,
		profiles,
		user?.id
	]);
	const myProfile = useMemo(() => profiles.find((p) => p.userId === user?.id) || null, [profiles, user?.id]);
	const suggestions = useMemo(() => {
		if (!user || !myProfile) return [];
		const relatedIds = /* @__PURE__ */ new Set();
		friends.forEach((f) => {
			if (f.requesterId === user.id && f.targetId) relatedIds.add(f.targetId);
			if (f.targetId === user.id && f.requesterId) relatedIds.add(f.requesterId);
		});
		const myReligion = normalizeMatch(myProfile.religion);
		const myCountry = normalizeMatch(myProfile.country);
		const myState = normalizeMatch(myProfile.state);
		const myCity = normalizeMatch(myProfile.city);
		const myHobbies = new Set(parseHobbyList(myProfile.hobbies).map(normalizeMatch));
		return profiles.filter((p) => p.userId && p.userId !== user.id && !relatedIds.has(p.userId)).map((p) => {
			const reasons = [];
			let score = 0;
			const religion = normalizeMatch(p.religion);
			const country = normalizeMatch(p.country);
			const state = normalizeMatch(p.state);
			const city = normalizeMatch(p.city);
			const hobbies = parseHobbyList(p.hobbies).map(normalizeMatch);
			if (myReligion && religion && myReligion === religion) {
				score += 3;
				reasons.push("Same religion");
			}
			if (myCountry && country && myCountry === country) {
				score += 3;
				reasons.push("Same country");
			}
			if (myState && state && myState === state) {
				score += 2;
				reasons.push("Same region");
			}
			if (myCity && city && myCity === city) {
				score += 2;
				reasons.push("Same city");
			}
			let overlap = 0;
			hobbies.forEach((hobby) => {
				if (hobby && myHobbies.has(hobby)) overlap += 1;
			});
			if (overlap > 0) {
				score += Math.min(overlap, 5);
				reasons.push(`${overlap} shared ${overlap === 1 ? "hobby" : "hobbies"}`);
			}
			return {
				profile: p,
				score,
				reasons
			};
		}).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
	}, [
		friends,
		myProfile,
		profiles,
		user
	]);
	const suggestionsReady = Boolean(myProfile?.religion || myProfile?.hobbies || myProfile?.country || myProfile?.state || myProfile?.city);
	const renderAvatar = (profile, size = 44) => {
		const handle = profile?.handle || profile?.username || "User";
		if (profile?.avatarUrl) return /* @__PURE__ */ jsx("img", {
			src: profile.avatarUrl,
			alt: handle,
			className: "friend-avatar",
			style: {
				width: size,
				height: size
			},
			loading: "lazy"
		});
		return /* @__PURE__ */ jsx("div", {
			className: "friend-avatar fallback",
			"aria-hidden": "true",
			style: {
				width: size,
				height: size
			},
			children: handle.charAt(0).toUpperCase()
		});
	};
	const handleOpenChat = (profile) => {
		if (!profile.userId) return;
		openChat({
			userId: profile.userId,
			handle: profile.handle,
			firstName: profile.firstName,
			lastName: profile.lastName,
			avatarUrl: profile.avatarUrl
		});
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "dashboard-shell",
		style: getBackgroundStyle("friends"),
		children: [/* @__PURE__ */ jsx(Sidebar, { active: "friends" }), /* @__PURE__ */ jsxs("div", {
			className: "main-content",
			children: [
				/* @__PURE__ */ jsx(TopbarSearch, {
					value: query,
					onChange: setQuery
				}),
				/* @__PURE__ */ jsx("div", {
					className: "dash-hero",
					children: /* @__PURE__ */ jsxs("div", {
						className: "dash-hero__text",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "eyebrow",
								children: "Friends"
							}),
							/* @__PURE__ */ jsx("h1", { children: "Find friends by handle" }),
							/* @__PURE__ */ jsx("p", {
								className: "subhead",
								children: "Add friends, view their bio and posts, and start a private message."
							})
						]
					})
				}),
				loading && /* @__PURE__ */ jsx("p", {
					className: "status",
					children: "Loading friends…"
				}),
				error && /* @__PURE__ */ jsx("p", {
					className: "status status-error",
					children: error
				}),
				/* @__PURE__ */ jsx("div", {
					className: "panel-grid",
					children: /* @__PURE__ */ jsxs("section", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("div", {
							className: "panel-header",
							children: /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
								className: "eyebrow",
								children: "Suggestions"
							}), /* @__PURE__ */ jsx("h3", { children: "Friend suggestions" })] })
						}), suggestions.length === 0 ? /* @__PURE__ */ jsx("p", {
							className: "status",
							children: suggestionsReady ? "No suggestions yet. Check back as more friends join." : "Complete your profile (location, hobbies, religion) to unlock suggestions."
						}) : /* @__PURE__ */ jsx("ul", {
							className: "suggestion-list",
							children: suggestions.map(({ profile: suggestion, reasons }) => {
								const displayName = `${suggestion.firstName || ""} ${suggestion.lastName || ""}`.trim();
								const handle = suggestion.handle || suggestion.username || "friend";
								const location = [
									suggestion.city,
									suggestion.state,
									suggestion.country
								].filter(Boolean).join(", ");
								return /* @__PURE__ */ jsxs("li", {
									className: "suggestion-item",
									children: [
										renderAvatar(suggestion, 40),
										/* @__PURE__ */ jsxs("div", {
											className: "suggestion-body",
											children: [
												/* @__PURE__ */ jsx("strong", { children: displayName || `@${handle}` }),
												/* @__PURE__ */ jsxs("span", { children: ["@", handle] }),
												location && /* @__PURE__ */ jsx("span", {
													className: "suggestion-location",
													children: location
												}),
												reasons.length > 0 && /* @__PURE__ */ jsx("div", {
													className: "suggestion-tags",
													children: reasons.map((reason) => /* @__PURE__ */ jsx("span", {
														className: "suggestion-tag",
														children: reason
													}, reason))
												})
											]
										}),
										/* @__PURE__ */ jsx("button", {
											className: "btn ghost",
											type: "button",
											onClick: () => addFriend(suggestion),
											children: "Add"
										})
									]
								}, suggestion.id);
							})
						})]
					})
				}),
				/* @__PURE__ */ jsx("div", {
					className: "panel-grid",
					children: /* @__PURE__ */ jsxs("section", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("div", {
							className: "panel-header",
							children: /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
								className: "eyebrow",
								children: "Friends"
							}), /* @__PURE__ */ jsx("h3", { children: "Current friends" })] })
						}), acceptedFriends.length === 0 ? /* @__PURE__ */ jsx("p", {
							className: "status",
							children: "0"
						}) : /* @__PURE__ */ jsx("ul", {
							className: "comment-list",
							children: acceptedFriends.map(({ relation, profile }) => {
								const displayName = `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim();
								return /* @__PURE__ */ jsxs("li", {
									className: "comment-item friend-item",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "friend-header",
										children: [renderAvatar(profile, 40), /* @__PURE__ */ jsxs("div", {
											className: "friend-header-meta",
											children: [/* @__PURE__ */ jsxs("strong", { children: ["@", profile?.handle || profile?.username || "friend"] }), displayName && /* @__PURE__ */ jsx("span", {
												className: "friend-name",
												children: displayName
											})]
										})]
									}), /* @__PURE__ */ jsx("p", {
										className: "comment-body",
										children: profile?.bio || "Friend"
									})]
								}, relation.id);
							})
						})]
					})
				}),
				incomingPending.length > 0 && /* @__PURE__ */ jsx("div", {
					className: "panel-grid",
					children: /* @__PURE__ */ jsxs("section", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("div", {
							className: "panel-header",
							children: /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
								className: "eyebrow",
								children: "Requests"
							}), /* @__PURE__ */ jsx("h3", { children: "Pending approvals" })] })
						}), /* @__PURE__ */ jsx("ul", {
							className: "comment-list",
							children: incomingPending.map(({ relation, profile }) => /* @__PURE__ */ jsxs("li", {
								className: "comment-item pending-approval",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "comment-body",
									children: [/* @__PURE__ */ jsxs("strong", { children: ["@", profile?.handle || profile?.username || "friend"] }), /* @__PURE__ */ jsx("p", { children: profile?.bio || "Pending request" })]
								}), /* @__PURE__ */ jsx("div", {
									className: "auth-actions",
									style: { marginLeft: "auto" },
									children: /* @__PURE__ */ jsx("button", {
										className: "btn primary",
										type: "button",
										onClick: () => acceptFriend(relation),
										children: "Accept"
									})
								})]
							}, relation.id))
						})]
					})
				}),
				/* @__PURE__ */ jsx("div", {
					className: "posts-grid",
					children: filtered.map((f) => {
						const status = relationStatusFor(f);
						const ownerPosts = f.userId ? postsByOwner[f.userId] : void 0;
						const latestPost = ownerPosts && ownerPosts.length ? ownerPosts[0] : void 0;
						const latestPreview = latestPost?.linkUrl ? linkPreviews[latestPost.linkUrl] : void 0;
						const displayName = `${f.firstName || ""} ${f.lastName || ""}`.trim();
						const canMessage = Boolean(f.userId);
						return /* @__PURE__ */ jsx("article", {
							className: "post-card",
							onClick: () => canMessage && handleOpenChat(f),
							style: { cursor: canMessage ? "pointer" : "default" },
							children: /* @__PURE__ */ jsxs("div", {
								className: "post-body",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "post-meta",
										children: [/* @__PURE__ */ jsx("span", {
											className: "pill subtle",
											children: "Friend"
										}), status && /* @__PURE__ */ jsx("span", {
											className: "pill subtle",
											children: status
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "friend-header",
										children: [renderAvatar(f, 48), /* @__PURE__ */ jsxs("div", {
											className: "friend-header-meta",
											children: [/* @__PURE__ */ jsxs("h3", { children: ["@", f.handle] }), displayName && /* @__PURE__ */ jsx("span", {
												className: "friend-name",
												children: displayName
											})]
										})]
									}),
									/* @__PURE__ */ jsx("p", {
										className: "comment-body",
										children: f.bio || "No bio yet."
									}),
									/* @__PURE__ */ jsx("button", {
										className: "btn ghost",
										type: "button",
										disabled: !f.userId || f.userId === user?.id || status === "pending" || status === "accepted",
										onClick: (e) => {
											e.stopPropagation();
											addFriend(f);
										},
										children: status === "accepted" ? "Friends" : status === "pending" ? "Requested" : "Add / Request"
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "friend-current-post",
										children: [/* @__PURE__ */ jsx("p", {
											className: "eyebrow",
											children: "Current post"
										}), latestPost ? /* @__PURE__ */ jsxs("div", {
											className: `friend-current-card ${latestPost.imageUrl ? "" : "no-media"}`,
											children: [latestPost.imageUrl && /* @__PURE__ */ jsx("img", {
												src: latestPost.imageUrl,
												alt: latestPost.title,
												loading: "lazy"
											}), /* @__PURE__ */ jsxs("div", { children: [
												/* @__PURE__ */ jsx("strong", { children: latestPost.title }),
												/* @__PURE__ */ jsx("p", { children: latestPost.content }),
												latestPost.linkUrl && /* @__PURE__ */ jsx("div", {
													className: "friend-link-preview",
													children: /* @__PURE__ */ jsx(LinkPreviewCard$1, {
														preview: latestPreview,
														url: latestPost.linkUrl
													})
												})
											] })]
										}) : /* @__PURE__ */ jsx("p", {
											className: "status",
											children: "No posts yet."
										})]
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "comments",
										children: [/* @__PURE__ */ jsx("p", {
											className: "eyebrow",
											children: "All posts"
										}), ownerPosts && ownerPosts.length ? /* @__PURE__ */ jsx("ul", {
											className: "comment-list friend-posts-list",
											children: ownerPosts.map((p) => /* @__PURE__ */ jsxs("li", {
												className: "comment-item",
												children: [p.imageUrl && /* @__PURE__ */ jsx("img", {
													src: p.imageUrl,
													alt: p.title,
													className: "avatar"
												}), /* @__PURE__ */ jsxs("div", {
													className: "comment-body",
													children: [
														/* @__PURE__ */ jsx("strong", { children: p.title }),
														/* @__PURE__ */ jsx("p", { children: p.content }),
														p.linkUrl && /* @__PURE__ */ jsx("div", {
															className: "friend-link-preview",
															children: /* @__PURE__ */ jsx(LinkPreviewCard$1, {
																preview: linkPreviews[p.linkUrl],
																url: p.linkUrl,
																compact: true
															})
														})
													]
												})]
											}, p.id))
										}) : /* @__PURE__ */ jsx("p", {
											className: "status",
											children: "No posts yet."
										})]
									}),
									/* @__PURE__ */ jsx("div", {
										className: "auth-actions",
										style: {
											marginTop: "8px",
											gap: "8px",
											flexWrap: "wrap"
										},
										children: /* @__PURE__ */ jsx("button", {
											className: "btn primary",
											type: "button",
											disabled: !canMessage,
											onClick: (e) => {
												e.stopPropagation();
												handleOpenChat(f);
											},
											children: "Message"
										})
									})
								]
							})
						}, f.id);
					})
				})
			]
		})]
	});
}
const HOBBY_OPTIONS = [
	"Abalone Fishing",
	"Abseiling (Rapelling)",
	"A Capella Singing",
	"Accordion",
	"Acid Etching",
	"Acro Dance (Acrobatic Dance)",
	"Acro Yoga",
	"Acrobatics",
	"Acrylic Painting",
	"Acting",
	"Action Figures (Making/ Collecting)",
	"Adventure Hobbies",
	"Aerobics",
	"Aeromodeling",
	"Aikido",
	"Air Guitar",
	"Air Hockey",
	"Airbrushing",
	"Airplane Spotting (Plane spotting)",
	"Airsoft",
	"Ajaeng",
	"Alphorn",
	"Alpine Hobbies/Sports",
	"Amateur Radio",
	"American Football",
	"Angling",
	"Animal Hobbies",
	"Animal Racing (Camel, Dog, Pig, Donkey)",
	"Animation",
	"Anime",
	"Ant Keeping",
	"Antiques/Antiquing",
	"Aquaponics",
	"Aquarium",
	"Aquascaping",
	"Arcade Games",
	"Archery",
	"Architecture",
	"Armwrestling",
	"Art (Making/Collecting/Restoration)",
	"Astrology",
	"Astronomy (Stargazing)",
	"Atumpan",
	"ATV (All-Terrain Vehicle)",
	"Auctions (In-person/Online)",
	"Audiophilia",
	"Aurora Photography",
	"Australian Football (Aussie Rules)",
	"Autobiography Writing",
	"Autoharp",
	"Automobile (Racing/Maintenance/Restoration/Detailing)",
	"Aviation",
	"Ax (Making/Throwing)",
	"Baby Sitting",
	"Backpacking",
	"Backyard Games",
	"Badminton",
	"Bagpipes Playing",
	"Baking",
	"Ball Games",
	"Ballet",
	"Ballooning",
	"Balloons (Art/Decoration)",
	"Ballroom Dancing",
	"Banjo Playing",
	"Barbecuing",
	"Barre",
	"BASE Jumping",
	"Baseball",
	"Basketball",
	"Bass Guitar",
	"Bassoon Playing",
	"Baton Twirling",
	"Beach Sports( Volleyball/Football)",
	"Beachcombing",
	"Beading (Bead Work)",
	"Beat Making",
	"Beatboxing",
	"Beekeeping",
	"Beer (Tasting/Brewing)",
	"Bells ( Ringing/Making)",
	"Belly Dancing",
	"Biathlon",
	"Bikejoring",
	"Biking (Cycling)",
	"Bikini (Fashion/Modeling)",
	"Billiards (Cue Sports/Pool/Snooker)",
	"Bingo",
	"Birdwatching (Photography/Feeding)",
	"Blacksmithing",
	"Blogging",
	"Blow Painting",
	"Board Games",
	"Boats (Racing/Restoration)",
	"Bobsleighing (Bobsledding)",
	"Bocce",
	"Bodybuilding",
	"Bongo Drums",
	"Bonsai",
	"Books (Clubs/Reading/Collecting/Restoration)",
	"Boomerang (Throwing/Making)",
	"Botany",
	"Bouldering",
	"Bowling",
	"Boxing",
	"Braille",
	"Brazilian Jiu-jitsu",
	"Breakdancing",
	"Bubble Art",
	"Building",
	"Bull Riding",
	"Bungee Jumping",
	"Bus (Spotting/Riding)",
	"Bushcraft",
	"Busking",
	"Butchering",
	"Butterfly (Rearing/ Watching /Photography)",
	"Buttons (Collecting/Making)",
	"Cabaret",
	"Cabasa",
	"Caber Toss",
	"Cactus Growing",
	"Cake Art",
	"Cake Decorating",
	"Calcio Storico",
	"Calf Roping",
	"Calligraphy",
	"Camel (Riding / Racing/Safaris)",
	"Camogie",
	"Camping",
	"Candle (Making/Art)",
	"Canning",
	"Canoeing",
	"Canyoneering",
	"Capoeira",
	"Car (Maintenance/Restoration/Racing)",
	"Card Games",
	"Cardistry",
	"Cards (Making/Collecting)",
	"Carnivals",
	"Carolling",
	"Carpentry",
	"Carting",
	"Cartography (Map Making)",
	"Cartooning",
	"Carving (Wood/Soap)",
	"Catering",
	"Cave Diving (Spelunking)",
	"Cello Playing",
	"Ceramics (Collecting /Making/Art)",
	"Chalk Art",
	"Chariot Racing",
	"Checkers (Draughts)",
	"Cheerleading",
	"Cheese (Making /Tasting)",
	"Chess",
	"Chessboxing",
	"Church (Attending/Photography/History)",
	"Cigar (Smoking/Collecting/Making)",
	"Cinema",
	"Circus",
	"Clarinet Playing",
	"Clavichord Playing",
	"Cleaning",
	"Climbing (Rock/Indoor)",
	"Clouds (Gazing/Art/Photography)",
	"Clowning",
	"Clubbing",
	"CNC Art",
	"Coaching",
	"Coding",
	"Coffee (Roasting/Tasting/Art)",
	"Coin (Collecting/Art)",
	"Collage",
	"Collecting Hobbies (Coins, Stamps, Sneakers etc)",
	"Coloring",
	"Comedy (Stand-up Comedy)",
	"Comics (Reading/Making/Collecting)",
	"Composing and Conducting Music",
	"Composting",
	"Computers",
	"Concerts",
	"Concrete Art",
	"Conga Drums",
	"Confectionery",
	"Cooking",
	"Cosplay",
	"Couponing",
	"Crabbing",
	"Crafting Hobbies",
	"Creative Hobbies",
	"Creative Writing",
	"Cribbage",
	"Cricket",
	"Cricut",
	"Crocheting",
	"Croquet",
	"Cross Country Sports (Running/Skiing)",
	"Cross Stitch",
	"CrossFit",
	"Crossword Puzzles",
	"Cryptocurrency (Mining /Investing)",
	"Cryptography",
	"Cue Sports",
	"Curling",
	"Cycling",
	"Cymbals Playing",
	"Dambe Fighting",
	"Dancing",
	"Dandyism (La Sape)",
	"Dartchery",
	"Darts",
	"Dating",
	"Debate",
	"Decathlon",
	"Decorating",
	"Decoupage",
	"Deep Sea Fishing",
	"Deltiology (Postcard Collecting)",
	"Demolition Derby",
	"Design Hobbies",
	"Diabolo",
	"Diary Keeping (Diarizing)",
	"Diecast",
	"Digiscoping",
	"Digital Art",
	"Diorama Making",
	"Dirt (Art/Shaping)",
	"Dirt Bike Racing",
	"Disc Golf",
	"Diving (Pool/Cliff)",
	"DIY (Do It Yourself)",
	"Djembe Drumming",
	"DJing",
	"Dodgeball",
	"Dog (Grooming/Walking/Sledding/Training)",
	"Dolls (Making/ Collecting)",
	"Dolphin Watching",
	"Dominoes",
	"Doodling",
	"Dowsing",
	"Drag Racing",
	"Drag Show",
	"Drama",
	"Draughts(Checkers)",
	"Drawing",
	"Driving",
	"Drone (Flying /Photography)",
	"Drum Playing",
	"Duathlon",
	"Duck Herding",
	"Duelling",
	"Dumpster Diving",
	"Dutch Oven Cooking",
	"Dynamophone (Telharmonium) Playing",
	"Eating (Gourmet/Competitive)",
	"E-Books (Design/Writing)",
	"Eclipse Watching/Chasing",
	"E-Commerce",
	"Edible Art",
	"Editing(Books/Photos/Videos)",
	"Egg Shell Painting/Carving",
	"Egyptology",
	"Eightball",
	"Electric Guitar",
	"Electronic Music",
	"Electronics (Repair/Restoration)",
	"Embossing",
	"Embroidery",
	"Engraving",
	"Entertaining",
	"Entomology",
	"Equestrianism",
	"Escapology",
	"Eskrima",
	"E-Sports",
	"Etching",
	"Exercise",
	"Exhibitions",
	"Experimenting",
	"Extreme Sports",
	"Face Slapping",
	"Factory Tours",
	"Falconry",
	"Fancy Dress Parties",
	"Fantasy Sports",
	"Farmer’s Markets Visiting",
	"Farming",
	"Fashion Design",
	"Fashion Shows Attending",
	"Felting",
	"Fencing",
	"Feng Shui",
	"Ferris Wheel",
	"Festivals Attending",
	"Fiddling",
	"Field Hockey",
	"Fighting (Martial Arts)",
	"Figure Skating",
	"Filmmaking",
	"Fine Dining",
	"Finger Painting",
	"Finswimming",
	"Fire Eating",
	"Fire Fighting",
	"Fire Poi",
	"Fish Farming",
	"Fish Keeping (Aquariums)",
	"Fishing (Fly/Sport/Deep Sea)",
	"Flame Throwing",
	"Flamenco Dancing",
	"Flea Markets Visiting",
	"Floorball",
	"Flowboarding",
	"Flower (Growing/Collecting/ Arranging/Pressing)",
	"Flute Playing",
	"Fly Tying",
	"Flyboarding",
	"Flying (Helicopters/Planes)",
	"Foam Parties",
	"Foil Surfing",
	"Food (Making/Blogging/Photography/Tours)",
	"Foosball (Table Football)",
	"Football",
	"Foraging",
	"Forest Bathing",
	"Fort Building",
	"Fossicking",
	"Fossil Hunting",
	"Fractal Burning (Electric Wood Burning)",
	"Free diving",
	"Freerunning",
	"Freestyle (Rapping/Running/Swimming)",
	"Frisbee",
	"Frugality",
	"Fruit Picking",
	"Furniture (Making/Collecting/Restoration)",
	"Futsal",
	"Gambling",
	"Gaming",
	"Goly Tama Dancing",
	"Garage Band",
	"Garage Sales",
	"Gardening",
	"Gardening (Miniature)",
	"Gemology",
	"Gemshorn Playing",
	"Genealogy",
	"Geocaching",
	"Geography",
	"Geology",
	"Ghost Hunting",
	"Gift Giving",
	"Gingerbread Art",
	"Glacier Hiking",
	"Glass (Blowing /Etching/Staining)",
	"Gliding",
	"Gnoming",
	"Go",
	"Go Karting",
	"Go-go Dancing",
	"Gold (Collecting/Craft/Investing)",
	"Golf",
	"Gong (Making/Playing)",
	"Gongoozling",
	"Gourmet (Cooking/Dining)",
	"Graffiti Art",
	"Graphic Design",
	"Grappling",
	"Grilling",
	"Grooming (Men’s Grooming)",
	"Guitar Playing",
	"Gun (Smithing/Collecting/Shooting/Restoration)",
	"Gym",
	"Gymnastics",
	"Gyotaku (Fish Printing)",
	"Gyrocopter",
	"Hacking (Ethical Hacking)",
	"Hair (Dressing/Art/Styling)",
	"Hammer Throw",
	"Hammocking",
	"Hand Painting",
	"Handball",
	"Handwriting Analysis",
	"Hang Gliding",
	"Hapkido",
	"Harmonica",
	"Harp Playing",
	"Harpastum",
	"Hat Making (Millinery)",
	"Healthy Living",
	"Helicopter (Flying/Riding)",
	"Heliskiing",
	"Herbalism",
	"Herping (Herpetology)",
	"High Jump",
	"Hikaru Dorodangu (Dirt Polishing)",
	"Hiking",
	"Hip Hop Music",
	"Hobby Horse",
	"Hockey",
	"Home Brewing",
	"Home Improvement",
	"Home Security",
	"Home Theatre",
	"Homing Pigeons",
	"Hookah (Shisha) Smoking",
	"Hooverball",
	"Horse Riding",
	"Horse Shoe (Art/Making)",
	"Horse Surfing",
	"Hot Air Ballooning",
	"Hot Rod",
	"Hot Tub Games",
	"Hula Hooping",
	"Hunting",
	"Hurling",
	"Hydroplane",
	"Hydroponics",
	"Ice Blocking",
	"Ice Climbing",
	"Ice Diving",
	"Ice Fishing",
	"Ice Hockey",
	"Ice Sailing",
	"Ice Sculpting",
	"Ice Skating",
	"Ice-cream (Tasting/Making)",
	"Icosathlon",
	"Igloo Building",
	"Illusion Art",
	"Illustration Art",
	"Improvisational Theater (Improv)",
	"Indoor Hobbies",
	"Indoor Sports (Cricket/Cycling/Hockey)",
	"Inline (Hockey/Skating)",
	"Insects (Collecting, Photography or Entomology)",
	"Instant Pot Cooking",
	"Interior design",
	"Inventing",
	"Investing",
	"Invisible Ink (Art/Tattoos)",
	"Ironing (Extreme Ironing)",
	"Jacuzzi (Hot Tub) Games",
	"Jal Tarang",
	"Jam Making",
	"Jam Skating",
	"Janggi (Korean Chess)",
	"Japanese Lantern Making/Art",
	"Jarrarium",
	"Javelin",
	"Jaw (Jew) Harp",
	"Jazz",
	"Jazzercise",
	"Jeet Kune Do",
	"Jenga",
	"Jet Skiing",
	"Jewellry Making",
	"Jigsaw Puzzles",
	"Jiu-Jitsu",
	"Jockeying",
	"Jogging",
	"Joinery",
	"Jorkyball",
	"Journaling",
	"Jousting",
	"Judo",
	"Juggling",
	"Juicing",
	"Jumping Rope",
	"Junk (Art/Collection)",
	"Kabaddi",
	"Kajukenbo",
	"Kamancheh",
	"Kanjira Playing",
	"Kanzashi Art",
	"Karaoke",
	"Karate",
	"Kart Racing",
	"Kayak Surfing",
	"Kayaking",
	"Kendama",
	"Kendo",
	"Kenpo",
	"Kettlebell Fitness",
	"Keyboard Playing",
	"Kickball",
	"Kickboxing",
	"Kicksled",
	"Kinetic Sculptures",
	"Kite Surfing",
	"Kites (Making or Flying)",
	"Kizomba Dancing",
	"Klezmer Music",
	"Knapping",
	"Kneeboarding",
	"Knife (Making/Throwing/Collecting/Restoration)",
	"Knitting",
	"Knot Tying (Knotting)",
	"Kombucha Brewing",
	"Korfball",
	"K-Pop Music",
	"Krav Maga",
	"Kubb",
	"Kung Fu",
	"Lacemaking",
	"Lacrosse",
	"Land Sailing",
	"Landscaping",
	"Language Learning",
	"Lapidary",
	"LARPing",
	"Laser Tag",
	"Lasso Throwing",
	"Latte Art",
	"Lawn Care",
	"Lawn Sports (Darts/Tennis/Bowling)",
	"Leaf (Art/Collecting)",
	"Learning",
	"Leather Crafting",
	"Lego (Building or Art)",
	"Lethwei",
	"Letter Writing",
	"Letterboxing",
	"Lightshow",
	"Limo Riding",
	"Line Dancing",
	"Linocut",
	"Listening to Music/Podcasts",
	"Lithography",
	"Livestreaming",
	"Lock Picking",
	"Log Rolling",
	"Long Jump",
	"Longboarding",
	"Luge (Skeleton)",
	"Lumberjack",
	"Machining",
	"Macramé",
	"Magic Tricks",
	"Magnet Art",
	"Mahjong",
	"Makeup Art",
	"Mall Visiting",
	"Mandala",
	"Mandolin Playing",
	"Manga",
	"Map Making (Cartography)",
	"Marathon and Ultra-marathon Running",
	"Marble (Playing/Collecting)",
	"Marble Art",
	"Marbles (Collecting or Playing)",
	"Marching",
	"Marimba",
	"Marionette",
	"Marksmanship",
	"Martial Arts",
	"Mask (Making/Collecting)",
	"Masquerade Parties",
	"Massaging",
	"Matchstick Models",
	"Mechanics",
	"Medieval (Art/Re-enactment/History)",
	"Meditation",
	"Memoir Writing",
	"Memorabilia Collecting",
	"Memory Training",
	"Mentalism",
	"Metal Detecting",
	"Metallurgy",
	"Metalworking",
	"Metaverse",
	"Meteorology",
	"Microscopy",
	"Miming",
	"Mineral Collecting",
	"Mini Golf (Miniature Golf)",
	"Miniature Art",
	"Minimalism",
	"Mixed Martial Arts (MMA)",
	"Mixology",
	"Model Making ( Aircraft, Cars, Trains, Ships)",
	"Modeling",
	"Monopoly",
	"Monster Truck Racing",
	"Mooing (Competitive)",
	"Mosaic",
	"Motocross",
	"Motorcycles (Racing/Restoration/Maintenance)",
	"Mountain Biking",
	"Mountain Climbing (Mountaineering)",
	"Movies (Watching/Making)",
	"Muay Thai",
	"Muraling",
	"Museum Visiting",
	"Mushroom (Farming/Hunting)",
	"Music (Listening /Making)",
	"Music Album (LP) collecting",
	"Nail Art",
	"NASCAR Racing",
	"Nature (Art/Study/Conservation)",
	"Necklace (Making/Collecting)",
	"Needle Felting",
	"Needlepoint",
	"Needlework",
	"Nerts",
	"Netball",
	"NFT (Collecting or Making)",
	"Ninja Warrior",
	"Ninjutsu (Ninjitsu)",
	"Noodling",
	"Nordic Skiing",
	"Novels (Reading or Writing)",
	"Numsimatics",
	"Oboe Playing",
	"Observatory",
	"Obstacle Course/ Running",
	"Ocarina Playing",
	"Oceanography",
	"Offroading",
	"Oil Painting",
	"Online Activities (Gaming/Poker)",
	"Opal Art",
	"Opera (Listening or Singing)",
	"Orchestra",
	"Orchid Growing",
	"Organ Playing",
	"Organic Farming",
	"Organizing",
	"Orienteering (Navigation)",
	"Origami",
	"Ornithology",
	"Ostrich Racing",
	"Ouija Board",
	"Outdoor Activities",
	"Outrigger Canoeing",
	"Paddle Boarding",
	"Pachisi",
	"Paddle Ball",
	"Pageants Attending",
	"Paintball",
	"Painting",
	"Paludarium",
	"Paper Crafts",
	"Papier Mache",
	"Parachuting",
	"Parades Attending",
	"Paragliding",
	"Park Visiting",
	"Parkour",
	"Partying",
	"Pen Pal",
	"Penmanship",
	"People Watching",
	"Performance Arts",
	"Pet(Sitting/Grooming)",
	"Petting Zoo",
	"Philately (Stamp Collecting)",
	"Photography",
	"Piano Playing",
	"Picnicking",
	"Piercing Arts",
	"Pig Racing",
	"Pigeon (Keeping/ Racing)",
	"Pilates",
	"Piloting",
	"Ping Pong (Table Tennis)",
	"Pipe (Making/Smoking)",
	"Planespotting",
	"Planetarium",
	"Plastic Art",
	"Playdough Modelling",
	"Poetry",
	"Poi Making",
	"Pokémon Go",
	"Poker",
	"Pole Climbing",
	"Pole Dancing",
	"Pole Vault",
	"Polo",
	"Pontoon Boats",
	"Pool (Billiards)",
	"Pottery",
	"Power Lifting",
	"Prepping",
	"Printing-3D",
	"Pub Crawling",
	"Pumpkin Art",
	"Puppetry",
	"Puzzles",
	"Pyrography",
	"Pyrotechnics",
	"Qawwali",
	"Qianball",
	"Qigong",
	"Quad Biking",
	"Quadcopter Flying",
	"Quadrathlon",
	"Quadruplane Models",
	"Quail Keeping",
	"Quartz Collecting",
	"Quatrefoil",
	"Quickstep Dancing",
	"Quidditch",
	"Quilling",
	"Quilting",
	"Quiz Games",
	"Quoits",
	"Race Walking",
	"Racquetball",
	"Rafting",
	"Rappelling (Abseiling)",
	"Rapping",
	"Raspberry Pi",
	"RC-Remote Control (Cars, Planes, Ships)",
	"Reading",
	"Robotics",
	"Rock Climbing",
	"Roller Skating",
	"Roller Blading",
	"Roller Skiing",
	"Rowing",
	"Rubik’s Cube",
	"Rugby",
	"Running (Marathon/Trail/Cross-country)",
	"Rock(Shaping/Carving/Collecting/Balancing)",
	"Recreational Vehicles (RV)",
	"Reggae Music",
	"Relaxing",
	"Radio (Listening/Monitoring)",
	"Reiki",
	"Rodeo",
	"Real Estate (Investing/Flipping)",
	"Rockets (Amateur Rocketry)",
	"Recycling",
	"Recycle Art",
	"Road Trips",
	"Roller Coasters",
	"Racing",
	"Relay Sports",
	"Recorder Playing",
	"Rogaining",
	"Role Playing",
	"Safari",
	"Sailing",
	"Sake Tasting",
	"Samba",
	"Sambo",
	"Sand Art (Sand Castles)",
	"Saxophone",
	"Scale Models",
	"Scavagenger Hunt",
	"Scootering",
	"Scouting",
	"Scrabble",
	"Scrapbooking",
	"Scuba Diving",
	"Sculling (Rowing)",
	"Sculpting",
	"Seashells (Art/Collecting)",
	"Seawalking",
	"Segway Polo",
	"Sewing",
	"Shadow Puppetry",
	"Shooting",
	"Shopping",
	"Shot Put",
	"Show Jumping",
	"Shuffleboard",
	"Singing",
	"Skateboarding",
	"Skating (Ice/Roller)",
	"Skeet Shooting",
	"Skeleton",
	"Sketching",
	"Skiing",
	"Skijoring",
	"Skimboarding",
	"Skipping Rope (Jumping Rope)",
	"Skydiving",
	"Slacklining",
	"Sledding",
	"Slingshot",
	"Sneaker Collecting",
	"Snorkelling",
	"Snowboarding",
	"Snowmobiling",
	"Snowshoeing",
	"Snuba diving",
	"Soap (Making/ Art)",
	"Soccer",
	"Social Media",
	"Socializing",
	"Softball",
	"Solitaire",
	"Songwriting",
	"Soul Cycle",
	"Spelunking (Caving)",
	"Sports",
	"Sprouting",
	"Squash",
	"Stamp Collecting (Philately)",
	"Stargazing",
	"Staycation",
	"Steeplechase",
	"Stone Skipping",
	"Stop Motion Art",
	"Storm Chasing",
	"Storytelling",
	"Street Art",
	"Street Luge",
	"Stretching",
	"Sudoku",
	"Sunbathing",
	"Surf skiing",
	"Surfing",
	"Survivalism",
	"Sushi",
	"Swimming",
	"Sword (Making/Collecting)",
	"Systema",
	"Table Football (Foosball)",
	"Table Tennis (Ping Pong)",
	"Tae Kwon Do",
	"Tag",
	"Tai Chi",
	"Tailoring",
	"Tambourine Playing",
	"Tandem Biking",
	"Tang Soo Do",
	"Tango",
	"Tap Dancing",
	"Tapestry Making",
	"Tarot Cards",
	"Tatting",
	"Tattooing (Tattoo art)",
	"Taxidermy",
	"Tea (Making/Tasting)",
	"Teaching/Tutoring",
	"Technology",
	"Tennis",
	"Teqball",
	"Tequila (Making/Tasting)",
	"Terrariums",
	"Textile (Making/Arts/Crafts)",
	"Theatre Attending",
	"Theme Park Visiting",
	"Theremin Playing",
	"Thrifting",
	"Tie and Dye",
	"Tinkering",
	"Tobogganing",
	"Toe Wrestling",
	"Toothpick (Models/Art)",
	"Topiary",
	"Toys (Playing/Making/ Collecting)",
	"Trail (Running/Biking)",
	"Training Animals (Dogs/Cats/Horses)",
	"Trainspotting",
	"Trampolining",
	"Trap Shooting",
	"Trapeze",
	"Trapping",
	"Travel",
	"Treasure Hunting",
	"Tree Climbing",
	"Tree House Making",
	"Triangle Playing",
	"Triathlons",
	"Triple Jump",
	"Trivia",
	"Trombone Playing",
	"Trumpet Playing",
	"Tuba Playing",
	"Tubing",
	"Tug of War",
	"TV Watching",
	"UFO Hunting",
	"Ukiyo-e",
	"Ukulele",
	"Ultimate Disc/Frisbee",
	"Ultra marathon",
	"Ultralight aviation",
	"Umpiring",
	"Underwater Photography/Videography",
	"Underwater Scooter",
	"Underwater sports (Hockey/Football)",
	"Unicycling",
	"Uno",
	"Upcycling",
	"Upholstery",
	"Urban Exploration/Hiking",
	"Urban Farming/Gardening",
	"Urban Survival/Prepping",
	"Vale Tudo",
	"Vaping",
	"Vaudeville",
	"Veena Playing",
	"Veganism/Vegetarian Hobbies",
	"Vegetable Gardening",
	"Vehicle Hobbies(Racing/Collecting/Restoration)",
	"Veneering",
	"Ventriloquism",
	"Vibraphone Playing",
	"Video Editing",
	"Video Games (Playing/Collecting)",
	"Videography",
	"Videophilia",
	"Vintage Hobbies (Collecting/Restoration)",
	"Vinyl Art",
	"Vinyl Record Collecting",
	"Viola Playing",
	"Violin Playing",
	"Virtual Reality (VR)",
	"Volleyball",
	"Volunteering",
	"Waboba",
	"Waxing",
	"Wakeboarding",
	"Wakesurfing",
	"Walking",
	"Waltz",
	"War (Games/Re-enactment)",
	"War Hammer",
	"Warli Art",
	"Washi Tape Art",
	"Waste Art (Recycle Art)",
	"Watches (Making/ Collecting/ Restoration)",
	"Watching (TV/Movies/Sports)",
	"Water Sports (Polo, Ski, JetSki)",
	"Watercolor Painting",
	"Wax (Sculptures/Art)",
	"Weather Watching",
	"Weaving",
	"Web Design/ Web Development",
	"Webtoons",
	"Wedding (Decoration/Planning)",
	"Weight Lifting (Weight Training)",
	"Welding",
	"Whale Watching",
	"Wheelchair Sports (Basketball/Marathon/Tennis)",
	"Whiskey (Making/Tasting)",
	"Whist",
	"White Water Rafting",
	"Whittling",
	"Wiffle Ball",
	"Wildlife Watching",
	"Window Shopping",
	"Windsurfing",
	"Wine (Tasting/Making)",
	"Wing Chun",
	"Wingsuit Flying (Wingsuiting)",
	"Witchcraft",
	"Wood Burning (Pyrography)",
	"Wood Carving",
	"Woodball",
	"Woodchopping",
	"Woodturning",
	"Woodworking",
	"Word Games",
	"Wreath Making",
	"Wrestling",
	"Writing",
	"Wushu (Kung Fu)",
	"Xalam",
	"Xare",
	"Xbox Gaming",
	"Xenomania",
	"Xeriscaping",
	"X-games",
	"Xiangqi (Chinese Chess)",
	"Xing Yi Quan",
	"Xpogo (Extreme Pogo)",
	"X-ray (Photography/Art)",
	"Xylography",
	"Xylophone",
	"Yak Polo",
	"Yard Design",
	"Yard Games",
	"Yard Sales",
	"Yarn Art",
	"Yarn Bombing",
	"Yatching",
	"Yodeling",
	"Yoga",
	"Yoghurt Making",
	"Youtube Channel",
	"Yo-yo",
	"Yukigassen",
	"Yurt Making",
	"Zampogna",
	"Zaouli Dance",
	"Zebra Racing",
	"Zen Gardens",
	"Zentangle Art",
	"Zero Gravity Flights",
	"Zine Making",
	"Ziplining",
	"Zither",
	"Zombie Makeup",
	"Zoo Volunteer",
	"Zoology",
	"Zorbing",
	"Zourkhaneh",
	"Zulu Dance",
	"Zumba",
	"Zydeco"
];
const RELIGION_OPTIONS = [
	"None",
	"Agnostic",
	"Atheist",
	"Spiritual but not religious",
	"Humanist",
	"Secular",
	"Deist",
	"Theist",
	"Monotheist",
	"Polytheist",
	"Pantheist",
	"Panentheist",
	"Animist",
	"Shamanist",
	"New Age",
	"Christian",
	"Catholic",
	"Roman Catholic",
	"Eastern Orthodox",
	"Oriental Orthodox",
	"Protestant",
	"Anglican",
	"Episcopalian",
	"Baptist",
	"Methodist",
	"Lutheran",
	"Presbyterian",
	"Reformed",
	"Pentecostal",
	"Charismatic",
	"Evangelical",
	"Seventh-day Adventist",
	"Latter-day Saints",
	"Jehovah's Witness",
	"Quaker",
	"Unitarian Universalist",
	"Mennonite",
	"Amish",
	"Church of Christ",
	"Christian Science",
	"Eastern Catholic",
	"Coptic Christian",
	"Assyrian Church of the East",
	"Nestorian",
	"Gnostic",
	"Islam",
	"Sunni",
	"Shia",
	"Sufi",
	"Ibadi",
	"Ahmadiyya",
	"Ismaili",
	"Zaydi",
	"Quranist",
	"Judaism",
	"Orthodox Judaism",
	"Conservative Judaism",
	"Reform Judaism",
	"Reconstructionist Judaism",
	"Hasidic",
	"Karaite Judaism",
	"Hinduism",
	"Vaishnavism",
	"Shaivism",
	"Shaktism",
	"Smartism",
	"Buddhism",
	"Theravada",
	"Mahayana",
	"Vajrayana",
	"Zen",
	"Nichiren",
	"Pure Land",
	"Jainism",
	"Sikhism",
	"Taoism",
	"Confucianism",
	"Shinto",
	"Baha'i",
	"Zoroastrianism",
	"Yazidism",
	"Druze",
	"Rastafari",
	"Pagan",
	"Neopagan",
	"Wicca",
	"Druidry",
	"Heathenry",
	"Asatru",
	"Hellenism",
	"Kemetic",
	"Roman Polytheism",
	"Celtic Polytheism",
	"Slavic Native Faith",
	"Baltic Native Faith",
	"African Traditional Religion",
	"Yoruba",
	"Vodun",
	"Ifa",
	"Santeria",
	"Candomble",
	"Umbanda",
	"Native American Spirituality",
	"Inuit Traditional",
	"Maori Spirituality",
	"Aboriginal Australian Spirituality",
	"Sami Shamanism",
	"Chinese Folk Religion",
	"Korean Shamanism",
	"Japanese Folk Religion",
	"Southeast Asian Folk Religion",
	"Tenrikyo",
	"Shugendo",
	"Eckankar",
	"Scientology",
	"Unification Church",
	"Caodaism",
	"Falun Gong",
	"Samaritanism",
	"Brahma Kumaris",
	"Radhasoami",
	"Swedenborgian",
	"Theosophy",
	"Anthroposophy",
	"Raelism",
	"Tengrism",
	"Manichaeism",
	"Mandaeism",
	"Satanism",
	"LaVeyan Satanism",
	"Church of Satan",
	"Temple of Set",
	"Pastafarianism",
	"Assemblies of God",
	"Church of God",
	"Foursquare",
	"Calvinism",
	"Church of the Nazarene",
	"Moravian Church",
	"Salvation Army",
	"Greek Orthodox",
	"Russian Orthodox",
	"Serbian Orthodox",
	"Antiochian Orthodox",
	"Armenian Apostolic",
	"Ethiopian Orthodox",
	"Eritrean Orthodox",
	"Syriac Orthodox",
	"Maronite",
	"Syriac Catholic",
	"Chaldean Catholic",
	"Melkite Catholic",
	"Greek Catholic",
	"Ukrainian Catholic",
	"Polish National Catholic",
	"Liberal Quaker",
	"Conservative Quaker",
	"Independent Catholic",
	"Non-denominational Christian",
	"Messianic Judaism",
	"Yeshivish",
	"Hasidic Chabad",
	"Reform Hindu",
	"Soka Gakkai",
	"Tiantai",
	"Huayan",
	"Madhyamaka",
	"Yogacara",
	"Nichiren Shoshu",
	"Bon",
	"Bektashi",
	"Alevi",
	"Dharma",
	"Unspecified"
];
var slug = (s) => (s || "").toString().trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
var AGE_OPTIONS = Array.from({ length: 103 }, (_, index) => String(18 + index));
var normalizeHobby = (value) => value.trim().replace(/\s+/g, " ");
var hobbyKey = (value) => normalizeHobby(value).toLowerCase();
var parseHobbies = (value) => {
	const seen = /* @__PURE__ */ new Set();
	return (value || "").split(/[,;\n]+/).map((entry) => normalizeHobby(entry)).filter((entry) => {
		if (!entry) return false;
		const key = hobbyKey(entry);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};
var normalizeLocation = (value) => value.trim().toLowerCase();
var matchByName = (list, value) => list.find((item) => normalizeLocation(item.name) === normalizeLocation(value));
var phoneDigits = (value) => (value || "").replace(/\D/g, "").slice(0, 10);
var formatPhone = (value) => {
	const digits = phoneDigits(value);
	if (!digits) return "";
	if (digits.length <= 3) return `(${digits}`;
	if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
	return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
var PREVIEW_DEBOUNCE_MS = 450;
var extractFirstUrl$1 = (text) => {
	const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
	if (!match) return "";
	let url = match[0].replace(/[),.!?]+$/, "");
	if (url.startsWith("www.")) url = `https://${url}`;
	return url;
};
var hostnameFor = (value) => {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
};
var isYoutubeUrl = (value) => {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host.includes("youtube.com") || host === "youtu.be";
	} catch {
		return false;
	}
};
var isVideoUrl = (value) => !!value && /\.(mp4|webm|mov)$/i.test(value);
var mediaDescriptor = (mediaUrl, hasLink) => {
	if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
	if (hasLink) return "with a link";
	return "";
};
var LinkPreviewCard = ({ preview, url, compact = false }) => {
	const title = preview.title || preview.siteName || hostnameFor(url);
	const meta = preview.siteName || hostnameFor(url);
	const showBadge = preview.type === "video" || isYoutubeUrl(url);
	return /* @__PURE__ */ jsxs("a", {
		className: `link-preview-card${compact ? " is-compact" : ""}`,
		href: url,
		target: "_blank",
		rel: "noreferrer",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "link-preview-media",
			children: [preview.image ? /* @__PURE__ */ jsx("img", {
				src: preview.image,
				alt: title,
				loading: "lazy"
			}) : /* @__PURE__ */ jsx("div", {
				className: "link-preview-placeholder",
				children: "LINK"
			}), showBadge && /* @__PURE__ */ jsx("span", {
				className: "link-preview-badge",
				children: "Video"
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "link-preview-body",
			children: [
				/* @__PURE__ */ jsx("p", {
					className: "link-preview-title",
					children: title
				}),
				preview.description && /* @__PURE__ */ jsx("p", {
					className: "link-preview-desc",
					children: preview.description
				}),
				/* @__PURE__ */ jsx("span", {
					className: "link-preview-url",
					children: meta
				})
			]
		})]
	});
};
function Me() {
	const { user, refreshProfile } = useAuth();
	const { preferences, setBackgroundAll, resetBackgroundAll, setChatPrefs, getBackgroundStyle } = useUserPreferences();
	usePageMeta({
		title: "My Profile | Stick2YourDreams Connect",
		description: "Complete your Stick2YourDreams profile to connect with friends who share your goals, location, and interests.",
		type: "profile",
		robots: "noindex, nofollow"
	});
	const [profile, setProfile] = useState({
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
		handle: ""
	});
	const profileSnapshotRef = useRef(null);
	const hobbySnapshotRef = useRef([]);
	const profileIdRef = useRef(null);
	const handleFixAttemptedRef = useRef(false);
	const [avatarFile, setAvatarFile] = useState(null);
	const [posts, setPosts] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [errorModal, setErrorModal] = useState(null);
	const [success, setSuccess] = useState(null);
	const [successModal, setSuccessModal] = useState(null);
	const [editing, setEditing] = useState(true);
	const [hobbyInput, setHobbyInput] = useState("");
	const [hobbyList, setHobbyList] = useState([]);
	const [postContent, setPostContent] = useState("");
	const [postFile, setPostFile] = useState(null);
	const [postSubmitting, setPostSubmitting] = useState(false);
	const [postError, setPostError] = useState(null);
	const [linkPreview, setLinkPreview] = useState(null);
	const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
	const [linkPreviewError, setLinkPreviewError] = useState(null);
	const [previewCache, setPreviewCache] = useState({});
	const [countryOptions, setCountryOptions] = useState([]);
	const [stateOptions, setStateOptions] = useState([]);
	const [cityOptions, setCityOptions] = useState([]);
	const [locationError, setLocationError] = useState(null);
	const [onboardingActive, setOnboardingActive] = useState(false);
	const [onboardingStep, setOnboardingStep] = useState(0);
	const [onboardingError, setOnboardingError] = useState(null);
	const [appearanceError, setAppearanceError] = useState(null);
	const [appearanceUploading, setAppearanceUploading] = useState(false);
	const [appearanceCollapsed, setAppearanceCollapsed] = useState(true);
	const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
	const normalize$3 = (entry) => entry?.attributes ?? entry ?? {};
	const filterLocationOptions = (options, term, limit = 200) => {
		if (!options.length) return [];
		const query = term.trim().toLowerCase();
		return (query ? options.filter((option) => option.name.toLowerCase().includes(query)) : options).slice(0, limit);
	};
	const currentBackground = preferences.backgrounds.dashboard;
	const appearanceColor = currentBackground.color || "#0b0d14";
	const handleBackgroundColor = (value) => {
		setAppearanceError(null);
		setBackgroundAll({ color: value });
	};
	const handleBackgroundImage = async (file) => {
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
			const url = ((await strapi_default.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } })).data?.[0])?.url;
			if (!url) {
				setAppearanceError("Upload failed. Please try again.");
				return;
			}
			setBackgroundAll({ image: url.startsWith("/") ? `${apiBase$2}${url}` : url });
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
		setChatPrefs({
			width: 360,
			height: 520,
			fontSize: 14
		});
	};
	const lockedUniqueHandle = useMemo(() => {
		if (!user) return "";
		return `${slug(user.username || user.email || "user") || "user"}-${user.id}`;
	}, [user]);
	const pickMediaUrl$1 = (mediaField) => {
		if (!mediaField) return void 0;
		const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
		if (!candidate) return void 0;
		const attrs = normalize$3(candidate);
		const url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
		if (!url) return void 0;
		return url.startsWith("/") ? `${apiBase$2}${url}` : url;
	};
	const handleCountryChange = (value) => {
		const match = matchByName(countryOptions, value);
		setProfile((prev) => ({
			...prev,
			country: value,
			countryCode: match?.code || "",
			state: "",
			stateCode: "",
			city: ""
		}));
		setStateOptions([]);
		setCityOptions([]);
	};
	const handleStateChange = (value) => {
		const match = matchByName(stateOptions, value);
		setProfile((prev) => ({
			...prev,
			state: value,
			stateCode: match?.code || "",
			city: ""
		}));
		setCityOptions([]);
	};
	const handleCityChange = (value) => {
		setProfile((prev) => ({
			...prev,
			city: value
		}));
	};
	useEffect(() => {
		let active = true;
		const loadCountries = async () => {
			try {
				const list = ((await strapi_default.get("/locations/countries")).data?.data ?? []).map((country) => ({
					name: country.name,
					code: country.code || country.isoCode || ""
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
			return match ? {
				...prev,
				countryCode: match.code
			} : prev;
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
				const list = ((await strapi_default.get("/locations/states", { params: { country: countryCode } })).data?.data ?? []).map((state) => ({
					name: state.name,
					code: state.code || state.isoCode || "",
					countryCode: state.countryCode
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
			return match ? {
				...prev,
				stateCode: match.code
			} : prev;
		});
	}, [stateOptions]);
	useEffect(() => {
		const countryCode = profile.countryCode;
		if (!countryCode) {
			setCityOptions([]);
			return;
		}
		if (stateOptions.length > 0 && !profile.stateCode) {
			setCityOptions([]);
			return;
		}
		let active = true;
		const loadCities = async () => {
			try {
				const list = ((await strapi_default.get("/locations/cities", { params: {
					country: countryCode,
					state: profile.stateCode || void 0
				} })).data?.data ?? []).map((city) => ({
					name: city.name,
					code: city.name
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
	}, [
		profile.countryCode,
		profile.stateCode,
		stateOptions.length
	]);
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
		strapi_default.put("/profiles/me", { data: {
			handle: lockedUniqueHandle,
			locale: "en"
		} }).then((res) => {
			const updated = res.data?.data;
			if (updated) setProfileFromEntry(updated);
			else setProfile((prev) => ({
				...prev,
				handle: lockedUniqueHandle
			}));
		}).catch(() => {
			handleFixAttemptedRef.current = false;
		});
	}, [
		loading,
		lockedUniqueHandle,
		profile.handle,
		user
	]);
	const setProfileFromEntry = (entry) => {
		if (!entry) return;
		const attrs = normalize$3(entry);
		profileIdRef.current = entry?.documentId ?? entry?.id ?? null;
		const parsedHobbies = parseHobbies(attrs.hobbies || "");
		setHobbyList(parsedHobbies);
		const onboardingComplete = typeof attrs.onboardingComplete === "boolean" ? attrs.onboardingComplete : true;
		const nextProfile = {
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
			avatarUrl: pickMediaUrl$1(attrs.avatar),
			onboardingComplete
		};
		setProfile(nextProfile);
		profileSnapshotRef.current = nextProfile;
		hobbySnapshotRef.current = parsedHobbies;
		setOnboardingActive(!onboardingComplete);
	};
	const fetchMyProfileByUser = async () => {
		if (!user) return null;
		return (await strapi_default.get(`/profiles/me?populate=avatar`)).data?.data ?? null;
	};
	const fetchMyProfileByHandle = async (handle) => {
		const target = (handle || "").trim() || lockedUniqueHandle;
		if (!target) return null;
		return (await strapi_default.get(`/profiles?filters[handle][$eq]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`)).data?.data?.[0] ?? null;
	};
	const fetchMyProfileByHandlePrefix = async (prefix) => {
		const target = (prefix || "").trim() || lockedUniqueHandle;
		if (!target) return null;
		return (await strapi_default.get(`/profiles?filters[handle][$startsWith]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`)).data?.data?.[0] ?? null;
	};
	const fetchMyProfile = async () => {
		const byUser = await fetchMyProfileByUser();
		if (byUser) return byUser;
		const candidates = [profile.handle, lockedUniqueHandle].filter((value) => value && value.toLowerCase() !== "user");
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
		setPosts(((await strapi_default.get(`/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&sort=createdAt:desc`)).data?.data ?? []).map((p) => {
			const attrs = normalize$3(p);
			const pic = pickMediaUrl$1(attrs.Users_Pictures);
			return {
				id: p.documentId ?? p.id ?? attrs.documentId,
				text: attrs.Users_Content || "",
				media: pic
			};
		}));
	};
	const fetchLinkPreview = async (url, options) => {
		if (!url) return null;
		if (previewCache[url] !== void 0) return previewCache[url];
		if (!options?.silent) {
			setLinkPreviewLoading(true);
			setLinkPreviewError(null);
		}
		try {
			const data = (await strapi_default.get("/link-preview", { params: { url } })).data?.data;
			const preview = data?.url ? {
				url: data.url,
				title: data.title,
				description: data.description,
				image: data.image,
				siteName: data.siteName,
				type: data.type
			} : null;
			setPreviewCache((prev) => ({
				...prev,
				[url]: preview
			}));
			return preview;
		} catch {
			setPreviewCache((prev) => ({
				...prev,
				[url]: null
			}));
			if (!options?.silent) setLinkPreviewError("Unable to load link preview.");
			return null;
		} finally {
			if (!options?.silent) setLinkPreviewLoading(false);
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
			let uploadedId;
			if (postFile) {
				const fd = new FormData();
				fd.append("files", postFile);
				uploadedId = (await strapi_default.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } })).data?.[0]?.id;
			}
			await strapi_default.post("/users-posts", { data: {
				Title: content.slice(0, 80) || "Post",
				Users_Content: content,
				owner: user.id,
				Users_Pictures: uploadedId ? [uploadedId] : void 0
			} });
			setPostContent("");
			setPostFile(null);
			setLinkPreview(null);
			setLinkPreviewError(null);
			await fetchMyPosts();
		} catch (err) {
			if (axios.isAxiosError(err)) {
				const msg = err.response?.data?.error?.message || err.response?.data?.message || "Failed to create post.";
				setPostError(String(msg));
			} else setPostError("Failed to create post.");
		} finally {
			setPostSubmitting(false);
		}
	};
	const deletePost = async (postId) => {
		if (!window.confirm("Delete this post?")) return;
		setPostError(null);
		try {
			await strapi_default.delete(`/users-posts/${postId}`);
			setPosts((prev) => prev.filter((p) => Number(p.id) !== postId));
		} catch (err) {
			console.error("Delete post failed", err);
			setPostError("Failed to delete post.");
		}
	};
	const updateHobbies = (next) => {
		setHobbyList(next);
		setProfile((prev) => ({
			...prev,
			hobbies: next.join(", ")
		}));
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
		updateHobbies([...hobbyList, match]);
		setHobbyInput("");
	};
	const removeHobby = (target) => {
		const key = hobbyKey(target);
		updateHobbies(hobbyList.filter((hobby) => hobbyKey(hobby) !== key));
	};
	const hobbySuggestions = useMemo(() => {
		const term = hobbyInput.trim().toLowerCase();
		const selected = new Set(hobbyList.map((hobby) => hobbyKey(hobby)));
		return HOBBY_OPTIONS.filter((hobby) => {
			if (selected.has(hobbyKey(hobby))) return false;
			return term ? hobby.toLowerCase().includes(term) : true;
		}).slice(0, 50);
	}, [hobbyInput, hobbyList]);
	const countrySuggestions = useMemo(() => filterLocationOptions(countryOptions, profile.country), [countryOptions, profile.country]);
	const stateSuggestions = useMemo(() => filterLocationOptions(stateOptions, profile.state), [stateOptions, profile.state]);
	const citySuggestions = useMemo(() => filterLocationOptions(cityOptions, profile.city), [cityOptions, profile.city]);
	const onboardingSteps = [
		"Basics",
		"Beliefs & Interests",
		"Location",
		"About you"
	];
	const hasBasics = profile.firstName.trim() && profile.lastName.trim() && profile.age && profile.gender;
	const hasBeliefs = profile.religion.trim() && hobbyList.length > 0;
	const hasState = stateOptions.length > 0 ? Boolean(profile.state || profile.stateCode) : true;
	const hasLocation = profile.country.trim() && profile.countryCode && hasState && profile.city.trim();
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
						handle: lockedUniqueHandle,
						onboardingComplete: false
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
		const url = extractFirstUrl$1(postContent);
		if (!url) {
			setLinkPreview(null);
			setLinkPreviewError(null);
			setLinkPreviewLoading(false);
			return;
		}
		setLinkPreviewError(null);
		if (linkPreview?.url === url) return;
		const cached = previewCache[url];
		if (cached !== void 0) {
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
	}, [
		postContent,
		linkPreview?.url,
		previewCache
	]);
	useEffect(() => {
		const urls = Array.from(new Set(posts.map((post) => extractFirstUrl$1(post.text)).filter((url) => url)));
		if (!urls.length) return;
		urls.forEach((url) => {
			if (previewCache[url] !== void 0) return;
			fetchLinkPreview(url, { silent: true });
		});
	}, [posts, previewCache]);
	const saveProfile = async (override) => {
		if (!user) return;
		const mergedProfile = override ? {
			...profile,
			...override
		} : profile;
		if (override) setProfile(mergedProfile);
		setError(null);
		setErrorModal(null);
		setSuccess(null);
		setSuccessModal(null);
		try {
			const safeFirst = mergedProfile.firstName || user.username || user.email || "user";
			const normalizedHandle = (mergedProfile.handle || "").trim();
			const baseHandle = normalizedHandle && normalizedHandle.toLowerCase() !== "user" ? normalizedHandle : lockedUniqueHandle;
			const buildUniqueHandle = () => `${baseHandle}-${user.id}-${Math.floor(1e3 + Math.random() * 9e3)}`;
			const phoneClean = phoneDigits(mergedProfile.phone);
			let avatarId;
			let uploadedAvatarUrl;
			if (avatarFile) {
				const fd = new FormData();
				fd.append("files", avatarFile);
				const uploadRes = await strapi_default.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
				avatarId = uploadRes.data?.[0]?.id;
				uploadedAvatarUrl = pickMediaUrl$1(uploadRes.data?.[0]);
			}
			const buildPayload = (handleValue) => {
				const onboardingComplete = typeof mergedProfile.onboardingComplete === "boolean" ? mergedProfile.onboardingComplete : true;
				const data = {
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
					user: user.id
				};
				data.phone = phoneClean ? phoneClean : null;
				if (avatarId) data.avatar = avatarId;
				return data;
			};
			let payload = buildPayload(baseHandle);
			const isHandleUniqueError = (err) => {
				if (!axios.isAxiosError(err)) return false;
				const msg = String(err.response?.data?.error?.message || err.response?.data?.message || "").toLowerCase();
				const handleErr = (err.response?.data?.error?.details?.errors ?? [])?.find((e) => (e?.path ?? []).includes("handle"));
				return msg.includes("unique") && (msg.includes("handle") || handleErr);
			};
			const doSave = async () => {
				return (await strapi_default.put("/profiles/me", { data: payload })).data?.data ?? null;
			};
			let saved = null;
			try {
				saved = await doSave();
			} catch (e) {
				if (isHandleUniqueError(e)) {
					payload = buildPayload(buildUniqueHandle());
					saved = await doSave();
					setProfile((prev) => ({
						...prev,
						handle: payload.handle
					}));
				} else throw e;
			}
			if (uploadedAvatarUrl) setProfile((prev) => ({
				...prev,
				avatarUrl: uploadedAvatarUrl
			}));
			if (saved) setProfileFromEntry(saved);
			else {
				const mine = await fetchMyProfileByUser();
				if (!mine) throw new Error("Save succeeded but no profile found");
				setProfileFromEntry(mine);
			}
			refreshProfile();
			setSuccess("Profile saved successfully.");
			setSuccessModal("Profile saved successfully.");
			setEditing(false);
		} catch (e) {
			if (axios.isAxiosError(e)) {
				const msg = e.response?.data?.error?.message || e.response?.data?.message || "Failed to save profile";
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
	const displayName = (profile.firstName || profile.lastName ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() : user.username) || user.email;
	const displayHandle = profile.handle && profile.handle.toLowerCase() !== "user" ? profile.handle : lockedUniqueHandle;
	const avatarImg = profile.avatarUrl;
	const initials = displayName?.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "ME";
	const phoneLink = phoneDigits(profile.phone);
	const phoneDisplay = formatPhone(profile.phone);
	const canDial = phoneLink.length === 10;
	const hobbiesDisplay = parseHobbies(profile.hobbies || "");
	const stateLabel = profile.countryCode === "US" ? "State" : "Province/Region";
	const locationDisplay = [
		profile.city,
		profile.state,
		profile.country
	].filter(Boolean).join(", ");
	const leftInfo = [
		["First Name", profile.firstName],
		["Last Name", profile.lastName],
		["Age", profile.age],
		["Religion", profile.religion],
		["Gender", profile.gender]
	];
	const rightInfo = [
		["Handle", displayHandle],
		["Phone", profile.phone],
		["Location", locationDisplay],
		["Country", profile.country],
		[stateLabel, profile.state],
		["City", profile.city],
		["Hobbies", profile.hobbies],
		["Occupation", profile.occupation],
		["Bio", profile.bio]
	];
	const renderInfoCard = (label, value) => /* @__PURE__ */ jsxs("div", {
		className: "profile-card",
		children: [/* @__PURE__ */ jsx("p", {
			className: "profile-card-label",
			children: label
		}), label === "Phone" ? /* @__PURE__ */ jsx("p", {
			className: "profile-card-value",
			children: phoneLink ? canDial ? /* @__PURE__ */ jsx("a", {
				href: `tel:${phoneLink}`,
				style: {
					color: "inherit",
					textDecoration: "underline"
				},
				children: phoneDisplay || value
			}) : phoneDisplay || value : "-"
		}) : label === "Hobbies" ? hobbiesDisplay.length ? /* @__PURE__ */ jsx("ul", {
			className: "profile-list",
			children: hobbiesDisplay.map((hobby) => /* @__PURE__ */ jsx("li", { children: hobby }, hobby))
		}) : /* @__PURE__ */ jsx("p", {
			className: "profile-card-value",
			children: "-"
		}) : /* @__PURE__ */ jsx("p", {
			className: "profile-card-value",
			children: value || "-"
		})]
	}, label);
	const onboardingTitle = onboardingSteps[onboardingStep] || "Profile setup";
	const renderOnboardingStep = () => {
		switch (onboardingStep) {
			case 0: return /* @__PURE__ */ jsxs("div", {
				className: "onboarding-fields",
				children: [
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "First Name"
						}), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							maxLength: 64,
							value: profile.firstName,
							onChange: (e) => setProfile({
								...profile,
								firstName: e.target.value
							})
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Last Name"
						}), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							maxLength: 64,
							value: profile.lastName,
							onChange: (e) => setProfile({
								...profile,
								lastName: e.target.value
							})
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Age"
						}), /* @__PURE__ */ jsxs("select", {
							className: "auth-input",
							value: profile.age,
							onChange: (e) => setProfile({
								...profile,
								age: e.target.value
							}),
							children: [/* @__PURE__ */ jsx("option", {
								value: "",
								children: "Select age"
							}), AGE_OPTIONS.map((age) => /* @__PURE__ */ jsx("option", {
								value: age,
								children: age
							}, age))]
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Gender"
						}), /* @__PURE__ */ jsxs("select", {
							className: "auth-input",
							value: profile.gender,
							onChange: (e) => setProfile({
								...profile,
								gender: e.target.value
							}),
							children: [
								/* @__PURE__ */ jsx("option", {
									value: "",
									children: "Select gender"
								}),
								/* @__PURE__ */ jsx("option", {
									value: "Male",
									children: "Male"
								}),
								/* @__PURE__ */ jsx("option", {
									value: "Female",
									children: "Female"
								})
							]
						})]
					})
				]
			});
			case 1: return /* @__PURE__ */ jsxs("div", {
				className: "onboarding-fields",
				children: [/* @__PURE__ */ jsxs("label", {
					className: "profile-field",
					children: [/* @__PURE__ */ jsx("span", {
						className: "profile-field-label",
						children: "Religion"
					}), /* @__PURE__ */ jsxs("select", {
						className: "auth-input",
						value: profile.religion,
						onChange: (e) => setProfile({
							...profile,
							religion: e.target.value
						}),
						children: [/* @__PURE__ */ jsx("option", {
							value: "",
							children: "Select religion"
						}), RELIGION_OPTIONS.map((religion) => /* @__PURE__ */ jsx("option", {
							value: religion,
							children: religion
						}, religion))]
					})]
				}), /* @__PURE__ */ jsxs("label", {
					className: "profile-field",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Hobbies"
						}),
						/* @__PURE__ */ jsxs("div", {
							style: {
								display: "flex",
								gap: 10,
								flexWrap: "wrap"
							},
							children: [/* @__PURE__ */ jsx("input", {
								className: "auth-input",
								list: "hobby-suggestions-onboarding",
								placeholder: "Search hobbies",
								value: hobbyInput,
								onChange: (e) => setHobbyInput(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										addHobby();
									}
								}
							}), /* @__PURE__ */ jsx("button", {
								className: "btn ghost",
								type: "button",
								onClick: addHobby,
								children: "Add"
							})]
						}),
						/* @__PURE__ */ jsx("datalist", {
							id: "hobby-suggestions-onboarding",
							children: hobbySuggestions.map((hobby) => /* @__PURE__ */ jsx("option", { value: hobby }, hobby))
						}),
						hobbyList.length ? /* @__PURE__ */ jsx("ul", {
							className: "profile-list",
							children: hobbyList.map((hobby) => /* @__PURE__ */ jsx("li", {
								style: { marginBottom: 6 },
								children: /* @__PURE__ */ jsxs("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 10
									},
									children: [/* @__PURE__ */ jsx("span", { children: hobby }), /* @__PURE__ */ jsx("button", {
										className: "btn ghost",
										type: "button",
										onClick: () => removeHobby(hobby),
										style: {
											padding: "2px 10px",
											fontSize: 12
										},
										children: "Remove"
									})]
								})
							}, hobby))
						}) : /* @__PURE__ */ jsx("p", {
							style: {
								margin: "8px 0 0",
								color: "#9ca3af"
							},
							children: "No hobbies added yet."
						}),
						/* @__PURE__ */ jsx("small", {
							style: { color: "#9ca3af" },
							children: "Choose from the suggestions and add one hobby at a time."
						})
					]
				})]
			});
			case 2: return /* @__PURE__ */ jsxs("div", {
				className: "onboarding-fields",
				children: [
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "profile-field-label",
								children: "Country"
							}),
							/* @__PURE__ */ jsx("input", {
								className: "auth-input",
								list: "country-options-onboarding",
								placeholder: "Search country",
								value: profile.country,
								onChange: (e) => handleCountryChange(e.target.value)
							}),
							/* @__PURE__ */ jsx("datalist", {
								id: "country-options-onboarding",
								children: countrySuggestions.map((country) => /* @__PURE__ */ jsx("option", { value: country.name }, country.code || country.name))
							})
						]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "profile-field-label",
								children: stateLabel
							}),
							/* @__PURE__ */ jsx("input", {
								className: "auth-input",
								list: "state-options-onboarding",
								placeholder: stateOptions.length ? `Search ${stateLabel.toLowerCase()}` : "Select country first",
								value: profile.state,
								onChange: (e) => handleStateChange(e.target.value),
								disabled: !profile.countryCode || !stateOptions.length
							}),
							/* @__PURE__ */ jsx("datalist", {
								id: "state-options-onboarding",
								children: stateSuggestions.map((state) => /* @__PURE__ */ jsx("option", { value: state.name }, state.code || state.name))
							})
						]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "profile-field-label",
								children: "City"
							}),
							/* @__PURE__ */ jsx("input", {
								className: "auth-input",
								list: "city-options-onboarding",
								placeholder: !profile.countryCode ? "Select country first" : stateOptions.length && !profile.stateCode ? `Select ${stateLabel.toLowerCase()} first` : "Search city",
								value: profile.city,
								onChange: (e) => handleCityChange(e.target.value),
								disabled: !profile.countryCode || stateOptions.length > 0 && !profile.stateCode
							}),
							/* @__PURE__ */ jsx("datalist", {
								id: "city-options-onboarding",
								children: citySuggestions.map((city) => /* @__PURE__ */ jsx("option", { value: city.name }, city.name))
							})
						]
					}),
					locationError && /* @__PURE__ */ jsx("p", {
						className: "profile-location-error",
						children: locationError
					})
				]
			});
			default: return /* @__PURE__ */ jsxs("div", {
				className: "onboarding-fields",
				children: [
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Occupation"
						}), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							maxLength: 64,
							value: profile.occupation,
							onChange: (e) => setProfile({
								...profile,
								occupation: e.target.value
							})
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "profile-field-label",
								children: "Bio"
							}),
							/* @__PURE__ */ jsx("textarea", {
								className: "auth-input",
								value: profile.bio,
								onChange: (e) => setProfile({
									...profile,
									bio: e.target.value
								}),
								maxLength: 500,
								rows: 3
							}),
							/* @__PURE__ */ jsxs("small", {
								style: { color: "#9ca3af" },
								children: [profile.bio.length, "/500 characters"]
							})
						]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "profile-field",
						children: [/* @__PURE__ */ jsx("span", {
							className: "profile-field-label",
							children: "Phone"
						}), /* @__PURE__ */ jsx("input", {
							className: "auth-input",
							type: "tel",
							maxLength: 14,
							placeholder: "(555) 123-4567",
							value: profile.phone || "",
							onChange: (e) => setProfile({
								...profile,
								phone: formatPhone(e.target.value)
							})
						})]
					})
				]
			});
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "dashboard-shell",
		style: getBackgroundStyle("profile"),
		children: [
			errorModal && /* @__PURE__ */ jsx("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.55)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1e3
				},
				children: /* @__PURE__ */ jsxs("div", {
					style: {
						background: "#101018",
						padding: "24px",
						borderRadius: "12px",
						boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
						maxWidth: "420px",
						width: "90%"
					},
					children: [
						/* @__PURE__ */ jsx("h3", {
							style: {
								margin: "0 0 12px",
								color: "#fff"
							},
							children: "Something went wrong"
						}),
						/* @__PURE__ */ jsx("p", {
							style: {
								margin: "0 0 16px",
								color: "#d1d1d6"
							},
							children: errorModal
						}),
						/* @__PURE__ */ jsx("div", {
							style: { textAlign: "right" },
							children: /* @__PURE__ */ jsx("button", {
								className: "btn primary",
								type: "button",
								onClick: () => setErrorModal(null),
								children: "OK"
							})
						})
					]
				})
			}),
			successModal && /* @__PURE__ */ jsx("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.45)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1e3
				},
				children: /* @__PURE__ */ jsxs("div", {
					style: {
						background: "#0f172a",
						padding: "24px",
						borderRadius: "12px",
						boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
						maxWidth: "420px",
						width: "90%",
						border: "1px solid rgba(16, 185, 129, 0.4)"
					},
					children: [
						/* @__PURE__ */ jsx("h3", {
							style: {
								margin: "0 0 12px",
								color: "#34d399"
							},
							children: "Success"
						}),
						/* @__PURE__ */ jsx("p", {
							style: {
								margin: "0 0 16px",
								color: "#d1fae5"
							},
							children: successModal
						}),
						/* @__PURE__ */ jsx("div", {
							style: { textAlign: "right" },
							children: /* @__PURE__ */ jsx("button", {
								className: "btn primary",
								type: "button",
								onClick: () => {
									setSuccessModal(null);
									setSuccess(null);
								},
								children: "OK"
							})
						})
					]
				})
			}),
			onboardingActive && /* @__PURE__ */ jsx("div", {
				className: "onboarding-overlay",
				children: /* @__PURE__ */ jsxs("div", {
					className: "onboarding-card",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "onboarding-header",
							children: [/* @__PURE__ */ jsxs("div", { children: [
								/* @__PURE__ */ jsx("p", {
									className: "eyebrow",
									children: "Getting started"
								}),
								/* @__PURE__ */ jsx("h3", { children: "Complete your profile" }),
								/* @__PURE__ */ jsx("p", {
									className: "onboarding-sub",
									children: "This step-by-step guide appears once."
								})
							] }), /* @__PURE__ */ jsxs("div", {
								className: "onboarding-progress",
								children: [
									"Step ",
									onboardingStep + 1,
									" of ",
									onboardingSteps.length
								]
							})]
						}),
						/* @__PURE__ */ jsx("h4", {
							className: "onboarding-title",
							children: onboardingTitle
						}),
						renderOnboardingStep(),
						onboardingError && /* @__PURE__ */ jsx("p", {
							className: "status status-error",
							children: onboardingError
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "onboarding-actions",
							children: [onboardingStep > 0 && /* @__PURE__ */ jsx("button", {
								className: "btn ghost",
								type: "button",
								onClick: () => setOnboardingStep((prev) => Math.max(prev - 1, 0)),
								children: "Back"
							}), /* @__PURE__ */ jsx("button", {
								className: "btn primary",
								type: "button",
								onClick: handleOnboardingNext,
								disabled: onboardingStep === onboardingSteps.length - 1 && !canFinishOnboarding,
								children: onboardingStep === onboardingSteps.length - 1 ? "Finish setup" : "Next"
							})]
						})
					]
				})
			}),
			/* @__PURE__ */ jsx(Sidebar, { active: "me" }),
			/* @__PURE__ */ jsxs("div", {
				className: "main-content",
				children: [
					/* @__PURE__ */ jsx(TopbarSearch, {}),
					/* @__PURE__ */ jsx("div", {
						className: "panel-grid profile-appearance-row",
						children: /* @__PURE__ */ jsxs("section", {
							className: "panel profile-appearance-panel",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "profile-appearance-header",
								children: [/* @__PURE__ */ jsxs("div", { children: [
									/* @__PURE__ */ jsx("p", {
										className: "eyebrow",
										children: "Style"
									}),
									/* @__PURE__ */ jsx("h4", { children: "Background & Chat" }),
									/* @__PURE__ */ jsx("p", {
										className: "profile-appearance-sub",
										children: "Update the background for dashboard, friends, and profile in one place."
									})
								] }), /* @__PURE__ */ jsx("button", {
									className: "btn ghost profile-appearance-toggle",
									type: "button",
									onClick: () => setAppearanceCollapsed((prev) => !prev),
									children: appearanceCollapsed ? "Expand" : "Minimize"
								})]
							}), !appearanceCollapsed && /* @__PURE__ */ jsxs("div", {
								className: "profile-appearance-body",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "profile-appearance-grid",
									children: [
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Background color"
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "appearance-color-row",
													children: [/* @__PURE__ */ jsx("input", {
														type: "color",
														value: appearanceColor,
														onChange: (e) => handleBackgroundColor(e.target.value),
														"aria-label": "Background color"
													}), /* @__PURE__ */ jsx("input", {
														className: "auth-input",
														value: currentBackground.color || "",
														placeholder: "#0b0d14",
														onChange: (e) => {
															setBackgroundAll({ color: e.target.value.trim() });
														}
													})]
												}),
												/* @__PURE__ */ jsx("small", {
													className: "profile-appearance-sub",
													children: "Leave blank to use the default gradient."
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Background image"
												}),
												/* @__PURE__ */ jsx("input", {
													type: "file",
													className: "auth-input",
													accept: "image/*",
													onChange: (e) => handleBackgroundImage(e.target.files?.[0] || null)
												}),
												currentBackground.image && /* @__PURE__ */ jsx("div", {
													className: "appearance-preview",
													children: /* @__PURE__ */ jsx("img", {
														src: currentBackground.image,
														alt: "Background preview"
													})
												}),
												/* @__PURE__ */ jsxs("div", {
													className: "appearance-actions",
													children: [/* @__PURE__ */ jsx("button", {
														className: "btn ghost",
														type: "button",
														onClick: clearBackgroundImage,
														children: "Remove image"
													}), /* @__PURE__ */ jsx("button", {
														className: "btn ghost",
														type: "button",
														onClick: resetBackgroundSettings,
														children: "Reset background"
													})]
												}),
												appearanceUploading && /* @__PURE__ */ jsx("small", {
													className: "profile-appearance-sub",
													children: "Uploading image..."
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Chat text size"
												}),
												/* @__PURE__ */ jsx("input", {
													className: "appearance-range",
													type: "range",
													min: 12,
													max: 20,
													step: 1,
													value: preferences.chat.fontSize,
													onChange: (e) => setChatPrefs({ fontSize: Number(e.target.value) })
												}),
												/* @__PURE__ */ jsxs("small", {
													className: "profile-appearance-sub",
													children: [
														"Current size: ",
														preferences.chat.fontSize,
														"px"
													]
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Chat size"
												}),
												/* @__PURE__ */ jsx("p", {
													className: "profile-appearance-sub",
													children: "Drag the chat corner to resize. It stays minimized when you leave friends."
												}),
												/* @__PURE__ */ jsx("button", {
													className: "btn ghost",
													type: "button",
													onClick: resetChatSettings,
													children: "Reset chat size"
												})
											]
										})
									]
								}), appearanceError && /* @__PURE__ */ jsx("p", {
									className: "profile-location-error",
									children: appearanceError
								})]
							})]
						})
					}),
					loading && /* @__PURE__ */ jsx("p", {
						className: "status",
						children: "Loading profile…"
					}),
					error && /* @__PURE__ */ jsx("p", {
						className: "status status-error",
						children: error
					}),
					success && /* @__PURE__ */ jsx("p", {
						className: "status status-success",
						children: success
					}),
					/* @__PURE__ */ jsx("div", {
						className: "panel-grid",
						style: { marginBottom: "16px" },
						children: /* @__PURE__ */ jsxs("section", {
							className: "panel",
							style: {
								background: "linear-gradient(135deg, rgba(92,128,255,0.12), rgba(16,185,129,0.08))",
								border: "1px solid rgba(255,255,255,0.06)",
								display: "grid",
								gridTemplateColumns: "auto 1fr",
								gap: "18px",
								alignItems: "center",
								padding: "20px 22px"
							},
							children: [/* @__PURE__ */ jsx("div", {
								style: {
									width: 96,
									height: 96,
									borderRadius: "22px",
									background: "rgba(255,255,255,0.06)",
									display: "grid",
									placeItems: "center",
									overflow: "hidden",
									boxShadow: "0 12px 40px rgba(0,0,0,0.25)"
								},
								children: avatarImg ? /* @__PURE__ */ jsx("img", {
									src: avatarImg,
									alt: displayName,
									style: {
										width: "100%",
										height: "100%",
										objectFit: "cover"
									}
								}) : /* @__PURE__ */ jsx("span", {
									style: {
										fontWeight: 700,
										color: "#cdd5e8",
										fontSize: 22
									},
									children: initials
								})
							}), /* @__PURE__ */ jsxs("div", {
								style: {
									display: "grid",
									gap: 10
								},
								children: [
									/* @__PURE__ */ jsxs("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 12,
											flexWrap: "wrap"
										},
										children: [/* @__PURE__ */ jsx("h2", {
											style: { margin: 0 },
											children: displayName
										}), /* @__PURE__ */ jsxs("span", {
											style: {
												background: "rgba(255,255,255,0.07)",
												border: "1px solid rgba(255,255,255,0.08)",
												padding: "6px 12px",
												borderRadius: 999,
												fontSize: 12,
												letterSpacing: .2
											},
											children: ["@", displayHandle]
										})]
									}),
									/* @__PURE__ */ jsx("p", {
										style: {
											margin: 0,
											color: "#cdd5e8",
											maxWidth: 720
										},
										children: profile.bio || "Share a quick bio to help friends recognize you."
									}),
									/* @__PURE__ */ jsxs("div", {
										style: {
											display: "flex",
											gap: 10,
											flexWrap: "wrap"
										},
										children: [/* @__PURE__ */ jsx("button", {
											className: "btn primary",
											type: "button",
											onClick: () => setEditing(true),
											children: "Edit Profile"
										}), /* @__PURE__ */ jsx("button", {
											className: "btn ghost",
											type: "button",
											onClick: () => window.scrollTo({
												top: 0,
												behavior: "smooth"
											}),
											children: "Jump to top"
										})]
									})
								]
							})]
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "panel-grid",
						children: /* @__PURE__ */ jsxs("section", {
							className: "panel",
							children: [/* @__PURE__ */ jsx("div", {
								className: "panel-header",
								children: /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
									className: "eyebrow",
									children: "About"
								}), /* @__PURE__ */ jsx("h3", { children: "Your Info" })] })
							}), editing ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("div", {
								className: "profile-columns",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "profile-column",
									children: [
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "First Name"
											}), /* @__PURE__ */ jsx("input", {
												className: "auth-input",
												maxLength: 64,
												value: profile.firstName,
												onChange: (e) => setProfile({
													...profile,
													firstName: e.target.value
												})
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Last Name"
											}), /* @__PURE__ */ jsx("input", {
												className: "auth-input",
												maxLength: 64,
												value: profile.lastName,
												onChange: (e) => setProfile({
													...profile,
													lastName: e.target.value
												})
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Age"
											}), /* @__PURE__ */ jsxs("select", {
												className: "auth-input",
												value: profile.age,
												onChange: (e) => setProfile({
													...profile,
													age: e.target.value
												}),
												children: [/* @__PURE__ */ jsx("option", {
													value: "",
													children: "Select age"
												}), AGE_OPTIONS.map((age) => /* @__PURE__ */ jsx("option", {
													value: age,
													children: age
												}, age))]
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Religion"
											}), /* @__PURE__ */ jsxs("select", {
												className: "auth-input",
												value: profile.religion,
												onChange: (e) => setProfile({
													...profile,
													religion: e.target.value
												}),
												children: [/* @__PURE__ */ jsx("option", {
													value: "",
													children: "Select religion"
												}), RELIGION_OPTIONS.map((religion) => /* @__PURE__ */ jsx("option", {
													value: religion,
													children: religion
												}, religion))]
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Gender"
											}), /* @__PURE__ */ jsxs("select", {
												className: "auth-input",
												value: profile.gender,
												onChange: (e) => setProfile({
													...profile,
													gender: e.target.value
												}),
												children: [
													/* @__PURE__ */ jsx("option", {
														value: "",
														children: "Select gender"
													}),
													/* @__PURE__ */ jsx("option", {
														value: "Male",
														children: "Male"
													}),
													/* @__PURE__ */ jsx("option", {
														value: "Female",
														children: "Female"
													})
												]
											})]
										})
									]
								}), /* @__PURE__ */ jsxs("div", {
									className: "profile-column",
									children: [
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Handle"
												}),
												/* @__PURE__ */ jsx("input", {
													className: "auth-input",
													value: lockedUniqueHandle,
													readOnly: true,
													disabled: true,
													tabIndex: -1,
													onFocus: (e) => e.target.blur(),
													style: {
														pointerEvents: "none",
														userSelect: "none",
														opacity: .7
													}
												}),
												/* @__PURE__ */ jsx("small", {
													style: { color: "#9ca3af" },
													children: "Locked + unique (username/email + user id)."
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Phone"
											}), /* @__PURE__ */ jsx("input", {
												className: "auth-input",
												type: "tel",
												maxLength: 14,
												placeholder: "(555) 123-4567",
												value: profile.phone || "",
												onChange: (e) => setProfile({
													...profile,
													phone: formatPhone(e.target.value)
												})
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Country"
												}),
												/* @__PURE__ */ jsx("input", {
													className: "auth-input",
													list: "country-options",
													placeholder: "Search country",
													value: profile.country,
													onChange: (e) => handleCountryChange(e.target.value)
												}),
												/* @__PURE__ */ jsx("datalist", {
													id: "country-options",
													children: countrySuggestions.map((country) => /* @__PURE__ */ jsx("option", { value: country.name }, country.code || country.name))
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: stateLabel
												}),
												/* @__PURE__ */ jsx("input", {
													className: "auth-input",
													list: "state-options",
													placeholder: stateOptions.length ? `Search ${stateLabel.toLowerCase()}` : "Select country first",
													value: profile.state,
													onChange: (e) => handleStateChange(e.target.value),
													disabled: !profile.countryCode || !stateOptions.length
												}),
												/* @__PURE__ */ jsx("datalist", {
													id: "state-options",
													children: stateSuggestions.map((state) => /* @__PURE__ */ jsx("option", { value: state.name }, state.code || state.name))
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "City"
												}),
												/* @__PURE__ */ jsx("input", {
													className: "auth-input",
													list: "city-options",
													placeholder: !profile.countryCode ? "Select country first" : stateOptions.length && !profile.stateCode ? `Select ${stateLabel.toLowerCase()} first` : "Search city",
													value: profile.city,
													onChange: (e) => handleCityChange(e.target.value),
													disabled: !profile.countryCode || stateOptions.length > 0 && !profile.stateCode
												}),
												/* @__PURE__ */ jsx("datalist", {
													id: "city-options",
													children: citySuggestions.map((city) => /* @__PURE__ */ jsx("option", { value: city.name }, city.name))
												})
											]
										}),
										locationError && /* @__PURE__ */ jsx("p", {
											className: "profile-location-error",
											children: locationError
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Hobbies"
												}),
												/* @__PURE__ */ jsxs("div", {
													style: {
														display: "flex",
														gap: 10,
														flexWrap: "wrap"
													},
													children: [/* @__PURE__ */ jsx("input", {
														className: "auth-input",
														list: "hobby-suggestions",
														placeholder: "Search hobbies",
														value: hobbyInput,
														onChange: (e) => setHobbyInput(e.target.value),
														onKeyDown: (e) => {
															if (e.key === "Enter") {
																e.preventDefault();
																addHobby();
															}
														}
													}), /* @__PURE__ */ jsx("button", {
														className: "btn ghost",
														type: "button",
														onClick: addHobby,
														children: "Add"
													})]
												}),
												/* @__PURE__ */ jsx("datalist", {
													id: "hobby-suggestions",
													children: hobbySuggestions.map((hobby) => /* @__PURE__ */ jsx("option", { value: hobby }, hobby))
												}),
												hobbyList.length ? /* @__PURE__ */ jsx("ul", {
													className: "profile-list",
													children: hobbyList.map((hobby) => /* @__PURE__ */ jsx("li", {
														style: { marginBottom: 6 },
														children: /* @__PURE__ */ jsxs("div", {
															style: {
																display: "flex",
																alignItems: "center",
																gap: 10
															},
															children: [/* @__PURE__ */ jsx("span", { children: hobby }), /* @__PURE__ */ jsx("button", {
																className: "btn ghost",
																type: "button",
																onClick: () => removeHobby(hobby),
																style: {
																	padding: "2px 10px",
																	fontSize: 12
																},
																children: "Remove"
															})]
														})
													}, hobby))
												}) : /* @__PURE__ */ jsx("p", {
													style: {
														margin: "8px 0 0",
														color: "#9ca3af"
													},
													children: "No hobbies added yet."
												}),
												/* @__PURE__ */ jsx("small", {
													style: { color: "#9ca3af" },
													children: "Choose from the suggestions and add one hobby at a time."
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Occupation"
											}), /* @__PURE__ */ jsx("input", {
												className: "auth-input",
												maxLength: 64,
												value: profile.occupation,
												onChange: (e) => setProfile({
													...profile,
													occupation: e.target.value
												})
											})]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "profile-field-label",
													children: "Bio"
												}),
												/* @__PURE__ */ jsx("textarea", {
													className: "auth-input",
													value: profile.bio,
													onChange: (e) => setProfile({
														...profile,
														bio: e.target.value
													}),
													maxLength: 500,
													rows: 3
												}),
												/* @__PURE__ */ jsxs("small", {
													style: { color: "#9ca3af" },
													children: [profile.bio.length, "/500 characters"]
												})
											]
										}),
										/* @__PURE__ */ jsxs("label", {
											className: "profile-field",
											children: [/* @__PURE__ */ jsx("span", {
												className: "profile-field-label",
												children: "Avatar"
											}), /* @__PURE__ */ jsx("input", {
												type: "file",
												className: "auth-input",
												accept: "image/*",
												onChange: (e) => setAvatarFile(e.target.files?.[0] || null)
											})]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "profile-actions",
											children: [/* @__PURE__ */ jsx("button", {
												className: "btn ghost",
												type: "button",
												onClick: cancelEdit,
												children: "Cancel"
											}), /* @__PURE__ */ jsx("button", {
												className: "btn primary",
												type: "button",
												onClick: () => saveProfile(),
												children: "Save Profile"
											})]
										})
									]
								})]
							}) }) : /* @__PURE__ */ jsxs("div", {
								className: "profile-columns",
								children: [/* @__PURE__ */ jsx("div", {
									className: "profile-column",
									children: leftInfo.map(([label, value]) => renderInfoCard(label, value))
								}), /* @__PURE__ */ jsx("div", {
									className: "profile-column",
									children: rightInfo.map(([label, value]) => renderInfoCard(label, value))
								})]
							})]
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "panel-grid",
						children: /* @__PURE__ */ jsxs("section", {
							className: "panel post-composer",
							children: [
								/* @__PURE__ */ jsx("div", {
									className: "panel-header",
									children: /* @__PURE__ */ jsxs("div", { children: [
										/* @__PURE__ */ jsx("p", {
											className: "eyebrow",
											children: "Share"
										}),
										/* @__PURE__ */ jsx("h3", { children: "New Post" }),
										/* @__PURE__ */ jsx("p", {
											className: "panel-sub",
											children: "What's On Your Mind?"
										})
									] })
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "post-composer__top",
									children: [/* @__PURE__ */ jsx("div", {
										className: "post-composer__avatar",
										children: avatarImg ? /* @__PURE__ */ jsx("img", {
											src: avatarImg,
											alt: displayName
										}) : /* @__PURE__ */ jsx("span", { children: initials })
									}), /* @__PURE__ */ jsxs("div", {
										className: "post-composer__input",
										children: [/* @__PURE__ */ jsx("textarea", {
											className: "auth-input",
											placeholder: "What's on your mind? Drop a YouTube link or article.",
											value: postContent,
											onChange: (e) => {
												setPostContent(e.target.value);
												setPostError(null);
											},
											rows: 4
										}), linkPreviewLoading && /* @__PURE__ */ jsx("span", {
											className: "post-composer__hint",
											children: "Loading preview..."
										})]
									})]
								}),
								linkPreview && /* @__PURE__ */ jsx(LinkPreviewCard, {
									preview: linkPreview,
									url: linkPreview.url || extractFirstUrl$1(postContent)
								}),
								linkPreviewError && /* @__PURE__ */ jsx("p", {
									className: "status status-error",
									children: linkPreviewError
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "post-composer__actions",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "post-composer__tools",
										children: [
											/* @__PURE__ */ jsxs("label", {
												className: "post-composer__tool",
												children: [/* @__PURE__ */ jsx("input", {
													type: "file",
													accept: "image/*",
													onChange: (e) => {
														setPostFile(e.target.files?.[0] || null);
														setPostError(null);
													}
												}), /* @__PURE__ */ jsx("span", { children: postFile ? "Change media" : "Add photo/video" })]
											}),
											/* @__PURE__ */ jsx("span", {
												className: "post-composer__file",
												children: postFile ? postFile.name : "No media selected"
											}),
											postFile && /* @__PURE__ */ jsx("button", {
												className: "btn ghost",
												type: "button",
												onClick: () => setPostFile(null),
												children: "Remove"
											})
										]
									}), /* @__PURE__ */ jsx("button", {
										className: "btn primary",
										type: "button",
										onClick: createPost,
										disabled: postSubmitting,
										children: postSubmitting ? "Posting..." : "Post"
									})]
								}),
								postError && /* @__PURE__ */ jsx("p", {
									className: "status status-error",
									children: postError
								})
							]
						})
					}),
					/* @__PURE__ */ jsx("div", {
						className: "posts-grid",
						children: posts.map((p) => {
							const postUrl = extractFirstUrl$1(p.text);
							const preview = postUrl ? previewCache[postUrl] : void 0;
							const hasLink = Boolean(postUrl);
							const descriptor = mediaDescriptor(p.media, hasLink);
							const postId = Number(p.id);
							return /* @__PURE__ */ jsxs("article", {
								className: "post-card",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "post-meta-bar",
										children: [
											/* @__PURE__ */ jsx("span", {
												className: "post-meta-name",
												children: displayName
											}),
											/* @__PURE__ */ jsx("span", {
												className: "post-meta-text",
												children: "just posted an update"
											}),
											descriptor && /* @__PURE__ */ jsx("span", {
												className: "post-meta-tag",
												children: descriptor
											}),
											Number.isFinite(postId) && /* @__PURE__ */ jsx("button", {
												className: "btn ghost post-delete",
												type: "button",
												onClick: () => deletePost(postId),
												children: "Delete"
											})
										]
									}),
									p.media ? /* @__PURE__ */ jsx("div", {
										className: "post-media",
										children: isVideoUrl(p.media) ? /* @__PURE__ */ jsx("video", {
											controls: true,
											style: {
												width: "100%",
												height: "100%",
												objectFit: "cover"
											},
											children: /* @__PURE__ */ jsx("source", { src: p.media })
										}) : /* @__PURE__ */ jsx("img", {
											src: p.media,
											alt: p.text,
											loading: "lazy"
										})
									}) : preview?.image ? /* @__PURE__ */ jsx("div", {
										className: "post-media",
										children: /* @__PURE__ */ jsx("img", {
											src: preview.image,
											alt: preview.title || displayName,
											loading: "lazy"
										})
									}) : null,
									/* @__PURE__ */ jsxs("div", {
										className: "post-body",
										children: [
											/* @__PURE__ */ jsx("h3", { children: user.username }),
											/* @__PURE__ */ jsx("p", { children: p.text }),
											preview && !p.media && /* @__PURE__ */ jsx(LinkPreviewCard, {
												preview,
												url: preview.url || postUrl,
												compact: true
											})
										]
									})
								]
							}, String(p.id));
						})
					})
				]
			})
		]
	});
}
var trimText = (value, max) => {
	const cleaned = String(value || "").replace(/\s+/g, " ").trim();
	if (!cleaned) return "";
	if (cleaned.length <= max) return cleaned;
	if (max <= 3) return cleaned.slice(0, max);
	return `${cleaned.slice(0, max - 3)}...`;
};
var extractFirstUrl = (text) => {
	const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
	if (!match) return "";
	let url = match[0].replace(/[),.!?]+$/, "");
	if (url.startsWith("www.")) url = `https://${url}`;
	return url;
};
function Landing() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();
	usePageMeta({
		title: "Stick2YourDreams Connect | Build momentum with friends",
		description: "Stick2YourDreams Connect is a motivational support network where friends keep you accountable, celebrate progress, and build momentum together.",
		type: "website",
		canonical: "https://s2ydconnection.com/",
		keywords: "accountability, motivational support, community, goals, progress, friends, social network, productivity",
		image: "https://s2ydconnection.com/logo.png",
		imageAlt: "Stick2YourDreams Connect logo"
	});
	const [profileSummary, setProfileSummary] = useState(null);
	const [profileMenuOpen, setProfileMenuOpen] = useState(false);
	const [showNotifications, setShowNotifications] = useState(false);
	const [featuredPosts, setFeaturedPosts] = useState([]);
	const [adminPosts, setAdminPosts] = useState([]);
	const [focusLoading, setFocusLoading] = useState(true);
	const [focusPreviews, setFocusPreviews] = useState({});
	const [suggestionOpen, setSuggestionOpen] = useState(false);
	const [suggestionName, setSuggestionName] = useState("");
	const [suggestionEmail, setSuggestionEmail] = useState("");
	const [suggestionMessage, setSuggestionMessage] = useState("");
	const [suggestionSending, setSuggestionSending] = useState(false);
	const [suggestionStatus, setSuggestionStatus] = useState(null);
	const [suggestionError, setSuggestionError] = useState(null);
	const { counts, total, loading, refresh, markAllRead } = useNotifications(user?.id);
	const normalize$3 = (entry) => entry?.attributes ?? entry ?? {};
	const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
	const pickMediaUrl$1 = (mediaField) => {
		if (!mediaField) return void 0;
		const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
		if (!candidate) return void 0;
		const attrs = normalize$3(candidate);
		let url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
		if (!url) return void 0;
		return url.startsWith("/") ? `${apiBase$2}${url}` : url;
	};
	const buildFocusPost = (entry, source) => {
		const attrs = normalize$3(entry);
		const titleRaw = attrs.Title || "";
		const contentRaw = source === "admin" ? attrs.Posts_Content || "" : attrs.Users_Content || "";
		const linkUrl = extractFirstUrl(contentRaw);
		const mediaField = source === "admin" ? attrs.Pictures : attrs.Users_Pictures;
		const ownerData = source === "featured" ? normalize$3(attrs.owner?.data ?? attrs.owner) : null;
		const author = source === "featured" ? ownerData?.username || ownerData?.email || "Community" : "S2YD";
		const title = trimText(titleRaw, 56) || trimText(contentRaw, 56) || (source === "admin" ? "Admin update" : "Featured update");
		return {
			id: entry.id ?? attrs.documentId ?? title,
			title,
			excerpt: trimText(contentRaw, 90) || "Fresh momentum from the crew.",
			imageUrl: pickMediaUrl$1(mediaField),
			author,
			linkUrl: linkUrl || void 0
		};
	};
	useEffect(() => {
		let active = true;
		const loadFocus = async () => {
			setFocusLoading(true);
			try {
				const [adminRes, featuredRes] = await Promise.all([strapi_default.get("/posts?populate=Pictures&sort=createdAt:desc&pagination[pageSize]=2"), strapi_default.get("/users-posts?populate=Users_Pictures&populate=owner&sort=createdAt:desc&pagination[pageSize]=2")]);
				if (!active) return;
				const admin = (adminRes.data?.data ?? []).map((p) => buildFocusPost(p, "admin"));
				const featured = (featuredRes.data?.data ?? []).map((p) => buildFocusPost(p, "featured"));
				setAdminPosts(admin);
				setFeaturedPosts(featured);
			} catch {
				if (!active) return;
				setAdminPosts([]);
				setFeaturedPosts([]);
			} finally {
				if (active) setFocusLoading(false);
			}
		};
		loadFocus();
		return () => {
			active = false;
		};
	}, []);
	useEffect(() => {
		let active = true;
		const urls = [...new Set([...featuredPosts, ...adminPosts].map((post) => post.linkUrl).filter((url) => Boolean(url)))];
		if (!urls.length) return;
		urls.forEach((url) => {
			if (focusPreviews[url] !== void 0) return;
			strapi_default.get("/link-preview", { params: { url } }).then((res) => {
				if (!active) return;
				const data = res.data?.data;
				const preview = data?.url ? {
					url: data.url,
					title: data.title,
					description: data.description,
					image: data.image,
					siteName: data.siteName,
					type: data.type
				} : null;
				setFocusPreviews((prev) => prev[url] !== void 0 ? prev : {
					...prev,
					[url]: preview
				});
			}).catch(() => {
				if (!active) return;
				setFocusPreviews((prev) => prev[url] !== void 0 ? prev : {
					...prev,
					[url]: null
				});
			});
		});
		return () => {
			active = false;
		};
	}, [
		adminPosts,
		featuredPosts,
		focusPreviews
	]);
	useEffect(() => {
		if (!user) {
			setProfileSummary(null);
			return;
		}
		const loadProfile = async () => {
			try {
				const data = (await strapi_default.get("/profiles/me?populate=avatar")).data?.data;
				const attrs = normalize$3(Array.isArray(data) ? data[0] : data);
				if (!attrs || Array.isArray(attrs)) return;
				setProfileSummary({
					displayName: attrs.firstName || attrs.lastName ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim() : attrs.handle || attrs.username || user.username,
					handle: attrs.handle || user.username,
					avatarUrl: pickMediaUrl$1(attrs.avatar)
				});
			} catch {
				setProfileSummary({
					displayName: user.username,
					handle: user.username
				});
			}
		};
		loadProfile();
	}, [user]);
	useEffect(() => {
		if (!user) return;
		if (!suggestionName) setSuggestionName(profileSummary?.displayName || user.username || "");
		if (!suggestionEmail && user.email) setSuggestionEmail(user.email);
	}, [
		profileSummary?.displayName,
		suggestionEmail,
		suggestionName,
		user
	]);
	useEffect(() => {
		setProfileMenuOpen(false);
		setShowNotifications(false);
	}, [user]);
	const nameForDisplay = useMemo(() => profileSummary?.displayName || user?.username || "Account", [profileSummary?.displayName, user?.username]);
	const focusHasPosts = featuredPosts.length > 0 || adminPosts.length > 0;
	const profileInitial = nameForDisplay.charAt(0).toUpperCase();
	const handleProfileAction = (path) => {
		navigate(path);
		setProfileMenuOpen(false);
		setShowNotifications(false);
	};
	const handleSuggestionSubmit = async () => {
		const message = suggestionMessage.trim();
		if (!message) {
			setSuggestionError("Please share a suggestion before sending.");
			return;
		}
		setSuggestionSending(true);
		setSuggestionError(null);
		setSuggestionStatus(null);
		try {
			await strapi_default.post("/suggestions", {
				message,
				name: suggestionName.trim(),
				email: suggestionEmail.trim(),
				pageUrl: window.location.href,
				userId: user?.id,
				handle: profileSummary?.handle || user?.username
			});
			setSuggestionStatus("Thank you! Your suggestion was sent.");
			setSuggestionMessage("");
		} catch {
			setSuggestionError("Unable to send suggestion right now.");
		} finally {
			setSuggestionSending(false);
		}
	};
	const renderFocusItem = (post, fallbackLabel, keyPrefix) => {
		const preview = post.linkUrl ? focusPreviews[post.linkUrl] : null;
		const thumbUrl = preview?.image || post.imageUrl;
		const title = preview?.title || post.title;
		const excerpt = trimText(preview?.description || post.excerpt, 90);
		const label = post.linkUrl ? "LINK" : fallbackLabel;
		const content = /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
			className: "focus-thumb",
			children: thumbUrl ? /* @__PURE__ */ jsx("img", {
				src: thumbUrl,
				alt: title,
				loading: "lazy"
			}) : /* @__PURE__ */ jsx("span", { children: label })
		}), /* @__PURE__ */ jsxs("div", {
			className: "focus-body",
			children: [
				/* @__PURE__ */ jsx("span", {
					className: "focus-title",
					children: title
				}),
				/* @__PURE__ */ jsx("span", {
					className: "focus-excerpt",
					children: excerpt
				}),
				post.author && /* @__PURE__ */ jsxs("span", {
					className: "focus-author",
					children: ["by ", post.author]
				})
			]
		})] });
		if (post.linkUrl) return /* @__PURE__ */ jsx("a", {
			className: "focus-item",
			href: post.linkUrl,
			target: "_blank",
			rel: "noreferrer",
			"aria-label": `Open link for ${title}`,
			children: content
		}, `${keyPrefix}-${post.id}`);
		return /* @__PURE__ */ jsx("div", {
			className: "focus-item",
			children: content
		}, `${keyPrefix}-${post.id}`);
	};
	return /* @__PURE__ */ jsxs("div", {
		className: "landing-page",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "landing-shell",
				children: [
					/* @__PURE__ */ jsxs("header", {
						className: "landing-nav",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "brand-mark",
								children: [/* @__PURE__ */ jsx("span", { children: "S2YD" }), /* @__PURE__ */ jsx("span", { children: "Stick2YourDreams" })]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "landing-beta",
								children: "BETA"
							}),
							/* @__PURE__ */ jsx("div", {
								className: "nav-actions",
								children: user ? /* @__PURE__ */ jsxs("div", {
									className: "landing-profile",
									children: [
										/* @__PURE__ */ jsx("button", {
											type: "button",
											className: "landing-profile-button",
											onClick: () => {
												setProfileMenuOpen((v) => !v);
												setShowNotifications(false);
											},
											"aria-expanded": profileMenuOpen,
											"aria-label": `Open profile menu for ${nameForDisplay}`,
											children: profileSummary?.avatarUrl ? /* @__PURE__ */ jsx("img", {
												src: profileSummary.avatarUrl,
												alt: nameForDisplay,
												className: "landing-profile-avatar"
											}) : /* @__PURE__ */ jsx("div", {
												className: "landing-profile-fallback",
												"aria-hidden": "true",
												children: profileInitial
											})
										}),
										/* @__PURE__ */ jsxs("button", {
											type: "button",
											className: "landing-bell",
											"aria-label": `Notifications (${total})`,
											onClick: () => {
												setShowNotifications((v) => !v);
												setProfileMenuOpen(false);
												refresh();
											},
											children: [/* @__PURE__ */ jsx("svg", {
												viewBox: "0 0 24 24",
												"aria-hidden": "true",
												children: /* @__PURE__ */ jsx("path", {
													d: "M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z",
													fill: "currentColor"
												})
											}), total > 0 && /* @__PURE__ */ jsx("span", {
												className: "landing-bell-badge",
												children: total > 99 ? "99+" : total
											})]
										}),
										showNotifications && /* @__PURE__ */ jsxs("div", {
											className: "landing-notification-panel",
											children: [/* @__PURE__ */ jsxs("div", {
												className: "landing-notification-header",
												children: [/* @__PURE__ */ jsx("strong", { children: "Notifications" }), /* @__PURE__ */ jsx("button", {
													type: "button",
													className: "landing-notification-clear",
													onClick: markAllRead,
													disabled: total === 0,
													children: "Mark read"
												})]
											}), /* @__PURE__ */ jsxs("div", {
												className: "landing-notification-list",
												children: [
													/* @__PURE__ */ jsxs("div", {
														className: "landing-notification-item",
														children: [/* @__PURE__ */ jsx("span", { children: "New messages" }), /* @__PURE__ */ jsx("span", {
															className: "landing-notification-count",
															children: counts.messages
														})]
													}),
													/* @__PURE__ */ jsxs("div", {
														className: "landing-notification-item",
														children: [/* @__PURE__ */ jsx("span", { children: "Friend requests" }), /* @__PURE__ */ jsx("span", {
															className: "landing-notification-count",
															children: counts.requests
														})]
													}),
													/* @__PURE__ */ jsxs("div", {
														className: "landing-notification-item",
														children: [/* @__PURE__ */ jsx("span", { children: "Friend posts" }), /* @__PURE__ */ jsx("span", {
															className: "landing-notification-count",
															children: counts.friendPosts
														})]
													}),
													/* @__PURE__ */ jsxs("div", {
														className: "landing-notification-item",
														children: [/* @__PURE__ */ jsx("span", { children: "Comments on your posts" }), /* @__PURE__ */ jsx("span", {
															className: "landing-notification-count",
															children: counts.comments
														})]
													}),
													/* @__PURE__ */ jsxs("div", {
														className: "landing-notification-item",
														children: [/* @__PURE__ */ jsx("span", { children: "Likes on your posts" }), /* @__PURE__ */ jsx("span", {
															className: "landing-notification-count",
															children: counts.likes
														})]
													}),
													loading && /* @__PURE__ */ jsx("div", {
														className: "landing-notification-status",
														children: "Refreshing..."
													}),
													!loading && total === 0 && /* @__PURE__ */ jsx("div", {
														className: "landing-notification-status",
														children: "All caught up."
													})
												]
											})]
										}),
										profileMenuOpen && /* @__PURE__ */ jsxs("div", {
											className: "landing-profile-menu",
											children: [
												/* @__PURE__ */ jsx("button", {
													type: "button",
													className: "landing-profile-item",
													onClick: () => handleProfileAction("/dashboard"),
													children: "My Dashboard"
												}),
												/* @__PURE__ */ jsx("button", {
													type: "button",
													className: "landing-profile-item",
													onClick: () => handleProfileAction("/me"),
													children: "My Profile"
												}),
												/* @__PURE__ */ jsx("button", {
													type: "button",
													className: "landing-profile-item",
													onClick: () => handleProfileAction("/friends"),
													children: "My Friends"
												}),
												/* @__PURE__ */ jsx("button", {
													type: "button",
													className: "landing-profile-item",
													onClick: () => {
														logout();
														setProfileMenuOpen(false);
														navigate("/login");
													},
													children: "Logout"
												})
											]
										})
									]
								}) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("button", {
									className: "btn-ghost",
									onClick: () => navigate("/login"),
									children: "Log in"
								}), /* @__PURE__ */ jsx("button", {
									className: "btn-primary",
									onClick: () => navigate("/register"),
									children: "Get started"
								})] })
							})
						]
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "hero",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "hero-copy",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "hero-badges",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "pill",
											children: "Creators & Builders"
										}),
										/* @__PURE__ */ jsx("span", {
											className: "pill",
											children: "Private messages"
										}),
										/* @__PURE__ */ jsx("span", {
											className: "pill",
											children: "Daily momentum"
										})
									]
								}),
								/* @__PURE__ */ jsx("h1", { children: "Let's Build a Community that Supports Each Other." }),
								/* @__PURE__ */ jsx("p", { children: "Stick2YourDreams is built on mutual support—because you don’t have to do this alone. Share what you’re working on, and get real feedback when you’re stuck, encouragement when you’re tired, and accountability when you need that extra push. And as you grow, you’ll pass it forward—helping someone else stay in motion, too. No fluff—just people lifting each other up and keeping their word." }),
								/* @__PURE__ */ jsxs("div", {
									className: "hero-cta",
									children: [/* @__PURE__ */ jsx("button", {
										className: "btn-primary",
										onClick: () => navigate("/register"),
										children: "Join the Community!"
									}), /* @__PURE__ */ jsx("button", {
										className: "btn-ghost",
										onClick: () => navigate("/login"),
										children: "Already with us?"
									})]
								})
							]
						}), /* @__PURE__ */ jsxs("div", {
							className: "hero-card",
							children: [
								/* @__PURE__ */ jsx("h3", { children: "Today's Focus" }),
								/* @__PURE__ */ jsx("p", { children: "What our community is doing." }),
								focusHasPosts ? /* @__PURE__ */ jsxs("div", {
									className: "hero-focus",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "focus-column",
										children: [/* @__PURE__ */ jsxs("div", {
											className: "focus-heading",
											children: [/* @__PURE__ */ jsx("span", {
												className: "focus-label",
												children: "Featured posts"
											}), /* @__PURE__ */ jsx("span", {
												className: "focus-sub",
												children: "Latest community updates."
											})]
										}), /* @__PURE__ */ jsx("div", {
											className: "focus-list",
											children: featuredPosts.length ? featuredPosts.map((post) => renderFocusItem(post, "NEW", "featured")) : /* @__PURE__ */ jsx("div", {
												className: "focus-empty",
												children: "No featured posts yet."
											})
										})]
									}), /* @__PURE__ */ jsxs("div", {
										className: "focus-column",
										children: [/* @__PURE__ */ jsxs("div", {
											className: "focus-heading",
											children: [/* @__PURE__ */ jsx("span", {
												className: "focus-label",
												children: "Admin posts"
											}), /* @__PURE__ */ jsx("span", {
												className: "focus-sub",
												children: "Signals from the S2YD team."
											})]
										}), /* @__PURE__ */ jsx("div", {
											className: "focus-list",
											children: adminPosts.length ? adminPosts.map((post) => renderFocusItem(post, "TEAM", "admin")) : /* @__PURE__ */ jsx("div", {
												className: "focus-empty",
												children: "No admin posts yet."
											})
										})]
									})]
								}) : /* @__PURE__ */ jsxs(Fragment, { children: [focusLoading && /* @__PURE__ */ jsx("span", {
									className: "focus-status",
									children: "Loading the latest posts..."
								}), /* @__PURE__ */ jsxs("div", {
									className: "hero-grid",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "mini-card",
											children: [/* @__PURE__ */ jsx("strong", { children: "Friend Signals" }), /* @__PURE__ */ jsx("p", { children: "See who's active, who needs a nudge, and who just shipped." })]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mini-card",
											children: [/* @__PURE__ */ jsx("strong", { children: "Share Posts" }), /* @__PURE__ */ jsx("p", { children: "Drop a quick win, a screenshot, or a link for feedback." })]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mini-card",
											children: [/* @__PURE__ */ jsx("strong", { children: "Private Threads" }), /* @__PURE__ */ jsx("p", { children: "Keep real conversations going without getting buried in noise." })]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mini-card",
											children: [/* @__PURE__ */ jsx("strong", { children: "Micro Goals" }), /* @__PURE__ */ jsx("p", { children: "Log tiny goals daily so you and your circle stay in sync." })]
										})
									]
								})] })
							]
						})]
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "section",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "section-header",
							children: [/* @__PURE__ */ jsx("h2", { children: "Built for people who make things" }), /* @__PURE__ */ jsx("span", {
								className: "muted",
								children: "Creators, founders, designers, builders."
							})]
						}), /* @__PURE__ */ jsxs("div", {
							className: "feature-grid",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Frictionless invites" }), /* @__PURE__ */ jsx("p", { children: "Find friends by handle and get instant context with bios and posts." })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Signals not noise" }), /* @__PURE__ */ jsx("p", { children: "Activity cues highlight who's moving so you can support fast." })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Media-forward" }), /* @__PURE__ */ jsx("p", { children: "Drop images, videos, and quick updates—no formatting battles." })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Private threads" }), /* @__PURE__ */ jsx("p", { children: "DMs that stay lightweight, focused, and discoverable with your crew." })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Momentum metrics" }), /* @__PURE__ */ jsx("p", { children: "Track streaks and tiny wins to keep the habit alive week over week." })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "feature",
									children: [/* @__PURE__ */ jsx("h3", { children: "Secure & trusted" }), /* @__PURE__ */ jsx("p", { children: "Built on Strapi with modern auth—your circle stays private." })]
								})
							]
						})]
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "section",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "section-header",
							children: [/* @__PURE__ */ jsx("h2", { children: "What you Get!" }), /* @__PURE__ */ jsx("span", {
								className: "muted",
								children: "Define Trust Within Our Community!"
							})]
						}), /* @__PURE__ */ jsxs("div", {
							className: "metrics",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "metric",
									children: [/* @__PURE__ */ jsx("strong", { children: "Always" }), /* @__PURE__ */ jsx("span", { children: "A Driven Community" })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "metric",
									children: [/* @__PURE__ */ jsx("strong", { children: /* @__PURE__ */ jsx(Infinity$1, { size: 30 }) }), /* @__PURE__ */ jsx("span", { children: "People Who Care" })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "metric",
									children: [/* @__PURE__ */ jsx("strong", { children: "0" }), /* @__PURE__ */ jsx("span", { children: "No Nonsense Distractions" })]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "metric",
									children: [/* @__PURE__ */ jsx("strong", { children: "+" }), /* @__PURE__ */ jsx("span", { children: "A Cleaner and Safer Community" })]
								})
							]
						})]
					}),
					/* @__PURE__ */ jsxs("footer", {
						className: "landing-footer",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "footer-row footer-brand",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "brand-mark",
									children: [/* @__PURE__ */ jsx("span", { children: "S2YD" }), /* @__PURE__ */ jsx("span", { children: "Stick2YourDreams" })]
								}), /* @__PURE__ */ jsx("p", { children: "A motivational support network built for real progress. Beta access is live and evolving." })]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "footer-row footer-column",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "footer-title",
										children: "Explore"
									}),
									/* @__PURE__ */ jsx("a", {
										href: "/login",
										children: "Login"
									}),
									/* @__PURE__ */ jsx("a", {
										href: "/register",
										children: "Create account"
									}),
									/* @__PURE__ */ jsx("a", {
										href: "/terms",
										children: "Terms"
									})
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "footer-row footer-column",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "footer-title",
										children: "Connect"
									}),
									/* @__PURE__ */ jsx("a", {
										href: "mailto:jasonadams@stick2yourdream.com",
										children: "Contact"
									}),
									/* @__PURE__ */ jsx("span", {
										className: "footer-muted",
										children: "support@stick2yourdreams.com"
									})
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "footer-row footer-meta",
								children: [/* @__PURE__ */ jsx("span", { children: "Stick2YourDreams Connect" }), /* @__PURE__ */ jsx("span", { children: "(c) 2025 Stick2YourDreams" })]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				className: "suggestion-fab",
				onClick: () => {
					setSuggestionOpen(true);
					setSuggestionStatus(null);
					setSuggestionError(null);
				},
				children: "Make A Suggestion!"
			}),
			suggestionOpen && /* @__PURE__ */ jsx("div", {
				className: "suggestion-overlay",
				role: "dialog",
				"aria-modal": "true",
				children: /* @__PURE__ */ jsxs("div", {
					className: "suggestion-modal",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "suggestion-header",
							children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", { children: "Suggestion Box" }), /* @__PURE__ */ jsx("p", { children: "Help us shape the beta. Share what you want to see next." })] }), /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "suggestion-close",
								onClick: () => setSuggestionOpen(false),
								children: "Close"
							})]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "suggestion-body",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "field",
									children: [/* @__PURE__ */ jsx("label", { children: "Your name (optional)" }), /* @__PURE__ */ jsx("input", {
										className: "auth-input",
										value: suggestionName,
										onChange: (e) => setSuggestionName(e.target.value),
										placeholder: "Your name"
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "field",
									children: [/* @__PURE__ */ jsx("label", { children: "Email (optional)" }), /* @__PURE__ */ jsx("input", {
										className: "auth-input",
										type: "email",
										value: suggestionEmail,
										onChange: (e) => setSuggestionEmail(e.target.value),
										placeholder: "you@example.com"
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "field",
									children: [/* @__PURE__ */ jsx("label", { children: "Your suggestion" }), /* @__PURE__ */ jsx("textarea", {
										className: "auth-input",
										rows: 4,
										value: suggestionMessage,
										onChange: (e) => setSuggestionMessage(e.target.value),
										placeholder: "Tell us what would make Stick2YourDreams better."
									})]
								}),
								suggestionError && /* @__PURE__ */ jsx("p", {
									className: "auth-message error",
									children: suggestionError
								}),
								suggestionStatus && /* @__PURE__ */ jsx("p", {
									className: "auth-message info",
									children: suggestionStatus
								})
							]
						}),
						/* @__PURE__ */ jsxs("div", {
							className: "suggestion-footer",
							children: [/* @__PURE__ */ jsx("button", {
								className: "btn-ghost",
								type: "button",
								onClick: () => setSuggestionOpen(false),
								children: "Cancel"
							}), /* @__PURE__ */ jsx("button", {
								className: "btn-primary",
								type: "button",
								onClick: handleSuggestionSubmit,
								disabled: suggestionSending,
								children: suggestionSending ? "Sending..." : "Send suggestion"
							})]
						})
					]
				})
			})
		]
	});
}
function Terms() {
	const navigate = useNavigate();
	usePageMeta({
		title: "Terms & Conditions | Stick2YourDreams Connect",
		description: "Review the Stick2YourDreams Connect terms and conditions for community guidelines, safety, and platform usage.",
		type: "website"
	});
	return /* @__PURE__ */ jsx("div", {
		className: "terms-page",
		children: /* @__PURE__ */ jsxs("div", {
			className: "terms-shell",
			children: [/* @__PURE__ */ jsxs("header", {
				className: "terms-header",
				children: [/* @__PURE__ */ jsxs("button", {
					className: "terms-brand",
					type: "button",
					onClick: () => navigate("/"),
					children: [/* @__PURE__ */ jsx("span", {
						className: "terms-mark",
						children: "S2YD"
					}), /* @__PURE__ */ jsx("span", {
						className: "terms-text",
						children: "Stick2YourDreams"
					})]
				}), /* @__PURE__ */ jsx("button", {
					className: "terms-back",
					type: "button",
					onClick: () => navigate(-1),
					children: "Back"
				})]
			}), /* @__PURE__ */ jsxs("main", {
				className: "terms-card",
				children: [
					/* @__PURE__ */ jsx("h1", { children: TERMS_TITLE }),
					/* @__PURE__ */ jsx("p", {
						className: "terms-updated",
						children: TERMS_UPDATED
					}),
					TERMS_SECTIONS.map((section) => /* @__PURE__ */ jsxs("section", {
						className: "terms-section",
						children: [/* @__PURE__ */ jsx("h2", { children: section.title }), section.body.map((paragraph, index) => /* @__PURE__ */ jsx("p", { children: paragraph }, `${section.title}-${index}`))]
					}, section.title))
				]
			})]
		})
	});
}
function AppRoutes() {
	return /* @__PURE__ */ jsxs(Routes, { children: [
		/* @__PURE__ */ jsx(Route, {
			path: "/",
			element: /* @__PURE__ */ jsx(Landing, {})
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/home",
			element: /* @__PURE__ */ jsx(Navigate, {
				to: "/",
				replace: true
			})
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/login",
			element: /* @__PURE__ */ jsx(Login, {})
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/register",
			element: /* @__PURE__ */ jsx(Register, {})
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/terms",
			element: /* @__PURE__ */ jsx(Terms, {})
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/dashboard",
			element: /* @__PURE__ */ jsx(ProtectedRoute, { children: /* @__PURE__ */ jsx(Dashboard, {}) })
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/friends",
			element: /* @__PURE__ */ jsx(ProtectedRoute, { children: /* @__PURE__ */ jsx(Friends, {}) })
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/me",
			element: /* @__PURE__ */ jsx(ProtectedRoute, { children: /* @__PURE__ */ jsx(Me, {}) })
		}),
		/* @__PURE__ */ jsx(Route, {
			path: "/landing",
			element: /* @__PURE__ */ jsx(Navigate, {
				to: "/",
				replace: true
			})
		})
	] });
}
var extractLinks = (text) => {
	return text.match(/(https?:\/\/[^\s]+)/g) || [];
};
var parseYouTubeId = (url) => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v");
		if (parsed.hostname === "youtu.be") return parsed.pathname.replace("/", "") || null;
	} catch {
		return null;
	}
	return null;
};
var getDisplayName = (handle, firstName, lastName) => {
	return `${firstName || ""} ${lastName || ""}`.trim() || (handle ? `@${handle}` : "Friend");
};
function ChatDock() {
	const location = useLocation();
	const { user } = useAuth();
	const { preferences, setChatPrefs } = useUserPreferences();
	const { activeFriend, popoutMinimized, chatLogs, drafts, gifDrafts, openChat, setPopoutMinimized, setDraft, setGifDraft, sendMessage } = useChat();
	const [error, setError] = useState(null);
	const [linkMeta, setLinkMeta] = useState({});
	const linkMetaRef = useRef(linkMeta);
	const popoutRef = useRef(null);
	const sizeRef = useRef({
		width: preferences.chat.width,
		height: preferences.chat.height
	});
	const lastPathRef = useRef(location.pathname);
	const [friendOptions, setFriendOptions] = useState([]);
	const [friendsLoading, setFriendsLoading] = useState(false);
	const [friendsError, setFriendsError] = useState(null);
	const [friendMenuOpen, setFriendMenuOpen] = useState(false);
	const friendMenuRef = useRef(null);
	const chatPrefs = preferences.chat;
	const hideForRoute = [
		"/",
		"/home",
		"/landing",
		"/login",
		"/register"
	].includes(location.pathname);
	const normalize$3 = (entry) => entry?.attributes ?? entry ?? {};
	const getEntity$3 = (entry) => entry?.data ?? entry ?? null;
	const getEntityAttrs$1 = (entry) => {
		const data = getEntity$3(entry);
		return data?.attributes ?? data ?? {};
	};
	const getEntityId$3 = (entry) => {
		const data = getEntity$3(entry);
		const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
		const num = Number(rawId);
		return Number.isFinite(num) ? num : void 0;
	};
	const apiBase$2 = "http://localhost:1337/api".replace(/\/api$/, "");
	const pickMediaUrl$1 = (mediaField) => {
		if (!mediaField) return void 0;
		const candidate = (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ?? (Array.isArray(mediaField) ? mediaField[0] : mediaField);
		if (!candidate) return void 0;
		const attrs = normalize$3(candidate);
		let url = attrs.url || attrs.formats?.large?.url || attrs.formats?.medium?.url || attrs.formats?.small?.url || attrs.formats?.thumbnail?.url;
		if (!url) return void 0;
		return url.startsWith("/") ? `${apiBase$2}${url}` : url;
	};
	useEffect(() => {
		linkMetaRef.current = linkMeta;
	}, [linkMeta]);
	useEffect(() => {
		if (popoutMinimized) setFriendMenuOpen(false);
	}, [popoutMinimized]);
	useEffect(() => {
		if (!friendMenuOpen) return;
		const handleClick = (event) => {
			const target = event.target;
			if (!friendMenuRef.current || !target) return;
			if (!friendMenuRef.current.contains(target)) setFriendMenuOpen(false);
		};
		const handleKey = (event) => {
			if (event.key === "Escape") setFriendMenuOpen(false);
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [friendMenuOpen]);
	useEffect(() => {
		sizeRef.current = {
			width: chatPrefs.width,
			height: chatPrefs.height
		};
	}, [chatPrefs.height, chatPrefs.width]);
	useEffect(() => {
		if (lastPathRef.current === "/friends" && location.pathname !== "/friends") setPopoutMinimized(true);
		lastPathRef.current = location.pathname;
	}, [location.pathname, setPopoutMinimized]);
	useEffect(() => {
		if (!user?.id) {
			setFriendOptions([]);
			setFriendsError(null);
			setFriendsLoading(false);
			return;
		}
		let active = true;
		const loadFriends = async () => {
			setFriendsLoading(true);
			setFriendsError(null);
			try {
				const friendsRes = await strapi_default.get(`/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target&pagination[pageSize]=200`);
				const acceptedIds = /* @__PURE__ */ new Set();
				(friendsRes.data?.data ?? []).forEach((relation) => {
					const attrs = normalize$3(relation);
					if (attrs.status !== "accepted") return;
					const requesterId = getEntityId$3(attrs.requester);
					const targetId = getEntityId$3(attrs.target);
					const friendId$1 = requesterId === user.id ? targetId : requesterId;
					if (friendId$1) acceptedIds.add(friendId$1);
				});
				const friendIds = Array.from(acceptedIds);
				if (!friendIds.length) {
					if (active) setFriendOptions([]);
					return;
				}
				const filter = friendIds.map((id, index) => `filters[user][id][$in][${index}]=${id}`).join("&");
				const mapped = ((await strapi_default.get(`/profiles?${filter}&populate=avatar&populate=user&pagination[pageSize]=200`)).data?.data ?? []).map((p) => {
					const attrs = normalize$3(p);
					const userAttrs = getEntityAttrs$1(attrs.user);
					const userId = getEntityId$3(attrs.user);
					if (!userId) return null;
					return {
						userId,
						handle: attrs.handle || userAttrs?.username || "",
						firstName: attrs.firstName || "",
						lastName: attrs.lastName || "",
						avatarUrl: pickMediaUrl$1(attrs.avatar)
					};
				}).filter(Boolean);
				mapped.sort((a, b) => getDisplayName(a.handle, a.firstName, a.lastName).localeCompare(getDisplayName(b.handle, b.firstName, b.lastName)));
				if (active) setFriendOptions(mapped);
			} catch {
				if (active) setFriendsError("Unable to load friends.");
			} finally {
				if (active) setFriendsLoading(false);
			}
		};
		loadFriends();
		return () => {
			active = false;
		};
	}, [user?.id]);
	useEffect(() => {
		const el = popoutRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			if (!entries.length || popoutMinimized) return;
			const rect = entries[0].target.getBoundingClientRect();
			const width = Math.round(rect.width);
			const height = Math.round(rect.height);
			const current = sizeRef.current;
			if (Math.abs(width - current.width) < 2 && Math.abs(height - current.height) < 2) return;
			sizeRef.current = {
				width,
				height
			};
			setChatPrefs({
				width,
				height
			});
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [popoutMinimized, setChatPrefs]);
	const fetchPreviewMeta = useCallback(async (url, fallbackThumb) => {
		if (!url || linkMetaRef.current[url]) return;
		try {
			const data = (await strapi_default.get("/link-preview", { params: { url } })).data?.data;
			setLinkMeta((prev) => ({
				...prev,
				[url]: {
					title: data?.title || data?.siteName || url.replace(/^https?:\/\//, ""),
					thumb: data?.image || fallbackThumb
				}
			}));
		} catch {
			setLinkMeta((prev) => ({
				...prev,
				[url]: {
					title: url.replace(/^https?:\/\//, ""),
					thumb: fallbackThumb
				}
			}));
		}
	}, []);
	useEffect(() => {
		if (!activeFriend?.userId) return;
		const messages$1 = chatLogs[String(activeFriend.userId)] || [];
		if (!messages$1.length) return;
		messages$1.forEach((m) => {
			extractLinks(m.body || "").forEach((url) => {
				const ytId = parseYouTubeId(url);
				const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : void 0;
				if (!linkMetaRef.current[url]) fetchPreviewMeta(url, thumb);
				else if (thumb && !linkMetaRef.current[url]?.thumb) setLinkMeta((prev) => ({
					...prev,
					[url]: {
						...prev[url],
						thumb
					}
				}));
			});
		});
	}, [
		activeFriend?.userId,
		chatLogs,
		fetchPreviewMeta
	]);
	if (!user || hideForRoute) return null;
	const friendList = activeFriend?.userId && !friendOptions.some((f) => f.userId === activeFriend.userId) ? [activeFriend, ...friendOptions] : friendOptions;
	const friendId = activeFriend?.userId;
	const key = friendId ? String(friendId) : "";
	const messages = friendId ? chatLogs[key] || [] : [];
	const messageDraft = friendId ? drafts[key] || "" : "";
	const gifDraft = friendId ? gifDrafts[key] || "" : "";
	const displayName = activeFriend ? getDisplayName(activeFriend.handle, activeFriend.firstName, activeFriend.lastName) : "Select a friend";
	const handleLabel = activeFriend?.handle ? `@${activeFriend.handle}` : displayName;
	const handleSend = async () => {
		if (!friendId) return;
		const body = `${messageDraft}${gifDraft ? `\n${gifDraft}` : ""}`.trim();
		if (!body) return;
		setError(await sendMessage(friendId, body));
	};
	const handleSelectFriend = (value) => {
		const selectedId = Number(value);
		if (!selectedId || !Number.isFinite(selectedId)) return;
		const next = friendList.find((f) => f.userId === selectedId);
		if (next) {
			openChat(next);
			setFriendMenuOpen(false);
		}
	};
	const getInitials = (friend) => {
		return (`${friend.firstName || ""} ${friend.lastName || ""}`.trim() || friend.handle || "Friend").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
	};
	const popoutStyle = {
		width: chatPrefs.width,
		height: popoutMinimized ? void 0 : chatPrefs.height,
		["--chat-font-size"]: `${chatPrefs.fontSize}px`
	};
	return /* @__PURE__ */ jsxs("div", {
		ref: popoutRef,
		className: `message-popout ${popoutMinimized ? "minimized" : ""}`,
		style: popoutStyle,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "message-popout__header",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "message-popout__title",
					children: [/* @__PURE__ */ jsx("p", {
						className: "eyebrow",
						children: "Chat"
					}), !popoutMinimized && /* @__PURE__ */ jsxs("div", {
						className: "chat-friend-picker",
						ref: friendMenuRef,
						children: [/* @__PURE__ */ jsxs("button", {
							className: "chat-friend-trigger",
							type: "button",
							onClick: () => setFriendMenuOpen((prev) => !prev),
							"aria-haspopup": "listbox",
							"aria-expanded": friendMenuOpen,
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "chat-friend-trigger__label",
									children: friendsLoading ? "Loading friends..." : activeFriend ? displayName : "Select a friend"
								}),
								/* @__PURE__ */ jsx("span", {
									className: "chat-friend-trigger__meta",
									children: activeFriend?.handle ? `@${activeFriend.handle}` : "Pick someone to chat"
								}),
								/* @__PURE__ */ jsx("span", {
									className: "chat-friend-trigger__chevron",
									"aria-hidden": "true"
								})
							]
						}), friendMenuOpen && /* @__PURE__ */ jsx("div", {
							className: "chat-friend-menu",
							role: "listbox",
							children: friendsLoading ? /* @__PURE__ */ jsx("div", {
								className: "chat-friend-option is-disabled",
								children: "Loading friends..."
							}) : friendList.length === 0 ? /* @__PURE__ */ jsx("div", {
								className: "chat-friend-option is-disabled",
								children: "No friends yet."
							}) : friendList.map((friend) => {
								const label = getDisplayName(friend.handle, friend.firstName, friend.lastName);
								const isActive = friend.userId === friendId;
								return /* @__PURE__ */ jsxs("button", {
									type: "button",
									className: `chat-friend-option${isActive ? " is-active" : ""}`,
									role: "option",
									"aria-selected": isActive,
									onClick: () => handleSelectFriend(String(friend.userId)),
									children: [/* @__PURE__ */ jsx("span", {
										className: "chat-friend-option__avatar",
										style: friend.avatarUrl ? { backgroundImage: `url(${friend.avatarUrl})` } : void 0,
										children: !friend.avatarUrl && getInitials(friend)
									}), /* @__PURE__ */ jsxs("span", {
										className: "chat-friend-option__meta",
										children: [/* @__PURE__ */ jsx("span", {
											className: "chat-friend-option__name",
											children: label
										}), friend.handle && /* @__PURE__ */ jsxs("span", {
											className: "chat-friend-option__handle",
											children: ["@", friend.handle]
										})]
									})]
								}, friend.userId);
							})
						})]
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "message-popout__actions",
					children: [!popoutMinimized && /* @__PURE__ */ jsxs("div", {
						className: "chat-font-control",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "chat-font-label",
								children: "A"
							}),
							/* @__PURE__ */ jsx("input", {
								"aria-label": "Chat text size",
								type: "range",
								min: 12,
								max: 20,
								step: 1,
								value: chatPrefs.fontSize,
								onChange: (e) => setChatPrefs({ fontSize: Number(e.target.value) })
							}),
							/* @__PURE__ */ jsx("span", {
								className: "chat-font-label large",
								children: "A"
							})
						]
					}), /* @__PURE__ */ jsx("button", {
						className: "btn ghost",
						type: "button",
						onClick: () => setPopoutMinimized(!popoutMinimized),
						children: popoutMinimized ? "Expand" : "Minimize"
					})]
				})]
			}),
			!popoutMinimized && friendsError && /* @__PURE__ */ jsx("p", {
				className: "status status-error",
				style: { padding: "0 14px" },
				children: friendsError
			}),
			!popoutMinimized && /* @__PURE__ */ jsxs(Fragment, { children: [
				/* @__PURE__ */ jsx("div", {
					className: "message-popout__body",
					children: !friendId ? /* @__PURE__ */ jsx("div", {
						className: "status",
						children: "Select a friend to start chatting."
					}) : messages.length === 0 ? /* @__PURE__ */ jsx("div", {
						className: "status",
						children: "No messages yet."
					}) : messages.map((m) => /* @__PURE__ */ jsxs("div", {
						className: `message-bubble ${m.from === "me" ? "outgoing" : "incoming"}`,
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "message-meta",
								children: [/* @__PURE__ */ jsx("span", { children: m.from === "me" ? "You" : displayName }), /* @__PURE__ */ jsx("span", { children: new Date(m.at).toLocaleTimeString([], {
									hour: "2-digit",
									minute: "2-digit"
								}) })]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "comment-body",
								style: { whiteSpace: "pre-wrap" },
								children: m.body
							}),
							extractLinks(m.body).map((url) => {
								const meta = linkMeta[url];
								const thumb = meta?.thumb;
								const title = meta?.title || url.replace(/^https?:\/\//, "");
								return /* @__PURE__ */ jsxs("div", {
									style: {
										marginTop: "8px",
										border: "1px solid rgba(255,255,255,0.08)",
										borderRadius: "10px",
										overflow: "hidden",
										background: "rgba(255,255,255,0.03)"
									},
									children: [thumb && /* @__PURE__ */ jsx("a", {
										href: url,
										target: "_blank",
										rel: "noreferrer",
										style: { display: "block" },
										children: /* @__PURE__ */ jsx("img", {
											src: thumb,
											alt: title,
											style: {
												width: "100%",
												height: "auto",
												display: "block"
											},
											loading: "lazy"
										})
									}), /* @__PURE__ */ jsx("div", {
										style: { padding: "8px 10px" },
										children: /* @__PURE__ */ jsx("a", {
											href: url,
											target: "_blank",
											rel: "noreferrer",
											style: { color: "#8fb5ff" },
											children: title
										})
									})]
								}, `${m.id}-${url}`);
							})
						]
					}, m.id))
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "message-popout__friends",
					children: [/* @__PURE__ */ jsx("p", {
						className: "eyebrow",
						children: "Quick reactions"
					}), /* @__PURE__ */ jsx(EmojiBar, { onPick: (emoji) => {
						if (friendId) setDraft(friendId, `${messageDraft}${emoji}`);
					} })]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "message-popout__footer",
					children: [
						/* @__PURE__ */ jsx("input", {
							className: "auth-input",
							placeholder: "Paste a GIF / image / video URL (optional)",
							value: gifDraft,
							onChange: (e) => {
								if (friendId) setGifDraft(friendId, e.target.value);
							},
							disabled: !friendId
						}),
						/* @__PURE__ */ jsx("input", {
							className: "auth-input",
							placeholder: `Message ${handleLabel}...`,
							value: messageDraft,
							onChange: (e) => {
								if (friendId) setDraft(friendId, e.target.value);
							},
							disabled: !friendId
						}),
						error && /* @__PURE__ */ jsx("p", {
							className: "status status-error",
							children: error
						}),
						/* @__PURE__ */ jsx("div", {
							className: "auth-actions",
							style: { justifyContent: "flex-end" },
							children: /* @__PURE__ */ jsx("button", {
								className: "btn primary",
								type: "button",
								onClick: handleSend,
								children: "Send"
							})
						})
					]
				})
			] })
		]
	});
}
function EmojiBar({ onPick }) {
	return /* @__PURE__ */ jsx("div", {
		className: "message-popout__chips",
		children: [
			"😀",
			"😄",
			"👏",
			"🙌",
			"💪",
			"🔥",
			"✨",
			"❤️",
			"🙏",
			"🎉"
		].map((e) => /* @__PURE__ */ jsx("button", {
			className: "btn ghost",
			type: "button",
			onClick: () => onPick(e),
			style: { padding: "6px 10px" },
			children: e
		}, e))
	});
}
var STORAGE_KEY = "s2yd_consent_v1";
var DEFAULT_COPY = {
	title: "We value your privacy",
	message: "We use cookies and similar technologies to personalize your experience and measure site usage. You can accept or decline analytics and advertising storage.",
	acceptText: "Accept",
	rejectText: "Reject"
};
var readStoredConsent = () => {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed?.status === "granted" || parsed?.status === "denied") return parsed;
	} catch {
		return null;
	}
	return null;
};
var persistConsent = (status) => {
	if (typeof window === "undefined") return;
	const payload = {
		status,
		ts: Date.now()
	};
	localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};
var pushGtag = (...args) => {
	if (typeof window === "undefined") return;
	const w = window;
	w.dataLayer = w.dataLayer || [];
	if (typeof w.gtag === "function") w.gtag(...args);
	else w.dataLayer.push(args);
};
var applyConsent = (status) => {
	pushGtag("consent", "update", {
		ad_storage: status,
		analytics_storage: status,
		ad_user_data: status,
		ad_personalization: status
	});
};
function ConsentBanner() {
	const [settings, setSettings] = useState(null);
	const [consent, setConsent] = useState(null);
	useEffect(() => {
		const stored = readStoredConsent();
		if (stored) {
			setConsent(stored);
			applyConsent(stored.status);
		}
	}, []);
	useEffect(() => {
		let active = true;
		const loadSettings = async () => {
			try {
				const data = (await strapi_default.get("/consent-banner")).data?.data;
				const attrs = data?.attributes ?? data ?? {};
				if (active) setSettings(attrs);
			} catch {
				if (active) setSettings(null);
			}
		};
		loadSettings();
		return () => {
			active = false;
		};
	}, []);
	const copy = useMemo(() => ({
		title: settings?.title?.trim() || DEFAULT_COPY.title,
		message: settings?.message?.trim() || DEFAULT_COPY.message,
		acceptText: settings?.acceptText?.trim() || DEFAULT_COPY.acceptText,
		rejectText: settings?.rejectText?.trim() || DEFAULT_COPY.rejectText
	}), [settings]);
	if (!(settings?.enabled !== false && !consent)) return null;
	const handleChoice = (status) => {
		persistConsent(status);
		applyConsent(status);
		setConsent({
			status,
			ts: Date.now()
		});
	};
	return /* @__PURE__ */ jsx("div", {
		className: "consent-banner",
		role: "dialog",
		"aria-live": "polite",
		children: /* @__PURE__ */ jsxs("div", {
			className: "consent-banner__body",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "consent-banner__content",
				children: [/* @__PURE__ */ jsx("p", {
					className: "consent-banner__title",
					children: copy.title
				}), /* @__PURE__ */ jsx("p", {
					className: "consent-banner__message",
					children: copy.message
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "consent-banner__actions",
				children: [/* @__PURE__ */ jsx("button", {
					className: "btn ghost",
					type: "button",
					onClick: () => handleChoice("denied"),
					children: copy.rejectText
				}), /* @__PURE__ */ jsx("button", {
					className: "btn primary",
					type: "button",
					onClick: () => handleChoice("granted"),
					children: copy.acceptText
				})]
			})]
		})
	});
}
const render = (url) => {
	return { html: renderToString(/* @__PURE__ */ jsx(StaticRouter, {
		location: url,
		children: /* @__PURE__ */ jsx(StaticAuthProvider, { children: /* @__PURE__ */ jsx(UserPreferencesProvider, { children: /* @__PURE__ */ jsxs(ChatProvider, { children: [
			/* @__PURE__ */ jsx(AppRoutes, {}),
			/* @__PURE__ */ jsx(ChatDock, {}),
			/* @__PURE__ */ jsx(ConsentBanner, {})
		] }) }) })
	})) };
};
export { render };

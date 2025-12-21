// src/api/strapi.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // http://localhost:1337/api
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  const url = config.url || "";

  const isAuthEndpoint =
    url === "/auth/local" ||
    url.startsWith("/auth/") ||
    url === "/register" ||
    url.startsWith("/register");

  if (token && !isAuthEndpoint) {
    // Axios v1 may use AxiosHeaders which needs .set()
    const headers: any = (config.headers ??= {});
    if (typeof headers.set === "function") {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.Authorization = `Bearer ${token}`;
    }
  } else if (config.headers) {
    const headers: any = config.headers;
    if (typeof headers.delete === "function") headers.delete("Authorization");
    else delete headers.Authorization;
  }

  return config;
});

export default api;

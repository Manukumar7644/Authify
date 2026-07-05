import useAuth from "@/auth/store";
import { refreshToken } from "@/services/AuthService";
import axios from "axios";
import toast from "react-hot-toast";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8083/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 10000,
});

// ✅ REQUEST INTERCEPTOR
apiClient.interceptors.request.use((config) => {
  const url = config.url || "";

  // auth routes pe token mat bhejo
  if (
    url.includes("/auth/login") ||
    url.includes("/auth/register") ||
    url.includes("/auth/refresh")
  ) {
    return config;
  }

  const accessToken = useAuth.getState().accessToken;

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

let isRefreshing = false;
let pending: any[] = [];

function queueRequest(cb: any) {
  pending.push(cb);
}

function resolveQueue(newToken: string | null) {
  pending.forEach((cb) => cb(newToken));
  pending = [];
}

// ✅ RESPONSE INTERCEPTOR
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    const url = original?.url || "";

    // 🔥 1. AUTH ROUTES SKIP (MOST IMPORTANT FIX)
    if (
      url.includes("/auth/login") ||
      url.includes("/auth/register") ||
      url.includes("/auth/refresh")
    ) {
      return Promise.reject(error);
    }

    // 🔥 2. NORMAL ERROR (NOT 401)
    if (status !== 401 || original._retry) {
      if (error.response?.data) {
        toast.error(error.response.data?.message || "Something went wrong");
      }
      return Promise.reject(error);
    }

    original._retry = true;

    // 🔥 3. QUEUE HANDLE
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        queueRequest((newToken: string) => {
          if (!newToken) return reject(error);

          original.headers.Authorization = `Bearer ${newToken}`;
          resolve(apiClient(original));
        });
      });
    }

    isRefreshing = true;

    try {
      console.log("🔄 Refreshing token...");

      const loginResponse = await refreshToken();
      const newToken = loginResponse?.accessToken;

      if (!newToken) throw new Error("No access token received");

      // update store
      useAuth
        .getState()
        .changeLocalLoginData(newToken, loginResponse.user, true);

      resolveQueue(newToken);

      original.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(original);
    } catch (err) {
      console.error("❌ Refresh failed");

      resolveQueue(null);
      useAuth.getState().logout();

      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;

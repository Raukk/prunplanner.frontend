import axios, { AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

import router from "@/router";

// Stores
import { useUserStore } from "@/stores/userStore";

/**
 * A request that already used its one post refresh retry. Without this a
 * request the backend answers with 401 for any reason other than an
 * expired token — a permission, a deleted record — loops forever:
 * refresh succeeds, the retry 401s again, and it refreshes again.
 */
type RetryableRequest = AxiosRequestConfig & { _retried?: boolean };

export const setAxiosHeader = (
	config: InternalAxiosRequestConfig<unknown>
): InternalAxiosRequestConfig<unknown> => {
	const userStore = useUserStore();
	const token = userStore.accessToken;

	if (token) {
		config.headers.Authorization = `Bearer ${token}`;
		config.headers.withCredentials = true;
	}

	return config;
};

export default function axiosSetup() {
	// Interceptors

	// Request Authorization Header
	axios.interceptors.request.use(
		async (config) => setAxiosHeader(config),
		(error) => {
			Promise.reject(error);
		}
	);

	// Response Token Expiry interceptor
	axios.interceptors.response.use(
		(response) => response,
		async (error) => {
			const userStore = useUserStore();
			const originalRequest: RetryableRequest = error.config;

			if (error.response && error.response.status === 401) {
				if (
					originalRequest.url &&
					originalRequest.url.includes("/user/refresh/")
				) {
					userStore.logout();
					router.push("/");
					return Promise.reject(error);
				}

				// already retried once with a fresh token, so the 401 is
				// about this request, not about the token
				if (originalRequest._retried) {
					return Promise.reject(error);
				}

				const tokenRefreshStatus: boolean =
					await userStore.performTokenRefresh();

				if (tokenRefreshStatus) {
					originalRequest._retried = true;
					return axios(originalRequest);
				} else {
					userStore.logout();
					router.push("/");
					return Promise.reject(error);
				}
			}

			return Promise.reject(error);
		}
	);
}

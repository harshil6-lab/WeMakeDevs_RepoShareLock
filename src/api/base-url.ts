/**
 * Base URL for API requests. Relative by default so the browser keeps sending
 * the session cookie to the origin that served the application.
 */
export const apiBaseUrl =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "/api";

export const SITE_NAME = "SPS Search";
export const ADMIN_EMAIL = "joshuasteeljoshua19@gmail.com";
export const SITE_URL = "https://8493834.github.io/search/";
export const GITHUB_REPO = "8493834/search";
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAC3iFzGz2CikXJRDLgLAxAquVWzxoVV2Q",
  authDomain: "sps-search.firebaseapp.com",
  projectId: "sps-search",
  appId: "1:233921986620:web:4c748ba81ac7127533433",
};
export const OVERVIEW_API_URL = "https://sps-overview.joshuasteeljoshua19.workers.dev/";
export const OVERVIEW_API_FALLBACK_URLS = ["https://mad-cardinal-8523.joshuasteeljoshua19.deno.net/", "https://search-verel-helper.vercel.app/"];
export const OVERVIEW_API_URLS = [OVERVIEW_API_URL, ...OVERVIEW_API_FALLBACK_URLS].filter(Boolean);
// Backup for Firebase (sign-in + site list), used only when Firebase can't be reached. See SETUP-BACKUPS.md.
export const SUPABASE_CONFIG = { url: "https://kspyizluupmvbswtmfji.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzcHlpemx1dXBtdmJzd3RtZmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDU0NzcsImV4cCI6MjEwODEyMTQ3N30.w-Oj5monefPJo8KRCXO1ZBuqMK7bPMyvHbdisj5nuC8" };
export const SUPABASE_READY = !SUPABASE_CONFIG.url.startsWith("YOUR_");
export const FIREBASE_READY = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

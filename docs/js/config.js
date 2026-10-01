// Firebase settings for SPS Search (already filled in).
// These values are NOT secrets - they identify your project. What protects your data
// is firestore.rules, which only lets the admin email below approve, deny or delete.

export const SITE_NAME = "SPS Search";

// Must match the email inside firestore.rules
export const ADMIN_EMAIL = "joshuasteeljoshua19@gmail.com";

// "owner/repo" of this GitHub repository. Powers the "Run crawl now" link in the Manage panel.
export const GITHUB_REPO = "8493834/search";

// Firebase console -> Project settings -> Your apps -> Web app -> "firebaseConfig"
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAC3iFzGz2CikXJRDLgLAxAquVWzxoVV2Q",
  authDomain: "sps-search.firebaseapp.com",
  projectId: "sps-search",
  appId: "1:233921986620:web:4c748ba81ac7127533433",
};

export const FIREBASE_READY = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

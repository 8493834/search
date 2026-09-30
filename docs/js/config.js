// >>> EDIT THIS FILE after creating your Firebase project (see README.md, step 2). <<<
// These values are NOT secrets - they identify your project. What protects your data
// is firestore.rules, which only lets the admin email below approve, deny or delete.

export const SITE_NAME = "SPS Search";

// Must match the email inside firestore.rules
export const ADMIN_EMAIL = "joshuasteeljoshua19@gmail.com";

// "owner/repo" of this GitHub repository. Powers the "Run crawl now" link in the Manage panel.
export const GITHUB_REPO = "YOUR_USERNAME/YOUR_REPO";

// Firebase console -> Project settings -> Your apps -> Web app -> "firebaseConfig"
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID",
};

export const FIREBASE_READY = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

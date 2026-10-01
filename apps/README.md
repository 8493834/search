# SPS Search apps

All apps open the live website (`https://8493834.github.io/search/`), so they are always up to date and you never rebuild them when the index changes.

## Build the installers (free, automatic)
1. Repo **Actions** tab > **Build apps (Windows, Mac, Linux, Android)** > **Run workflow**.
2. When it finishes (about 10 minutes), open the run and download the files under **Artifacts**:
   - `SPS-Search-windows`: `.exe` installer
   - `SPS-Search-mac`: `.dmg` (one for Apple Silicon, one for Intel)
   - `SPS-Search-linux`: `.AppImage` and `.deb`
   - `SPS-Search-android`: `app-debug.apk`

## Installing (the apps are unsigned)
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info > Run anyway**.
- **Mac:** open the `.dmg`, drag to Applications, then right-click the app > **Open** the first time. If it says the app is "damaged", run `xattr -cr "/Applications/SPS Search.app"` in Terminal.
- **Linux:** `chmod +x SPS-Search-*.AppImage && ./SPS-Search-*.AppImage`, or install the `.deb`.
- **Android:** copy the APK to the phone, open it, and allow "install unknown apps" for your file manager or browser.

## iPhone / iPad
A real iOS app needs a paid Apple Developer account ($99/year) and a Mac. Free option: open the site in Safari > **Share > Add to Home Screen**. It then opens full screen like an app and works offline for pages you've already visited.

## Sign-in inside the apps
Google blocks sign-in inside embedded app windows. In the apps, searching works as normal, and the sign-in / "Get my site on here" / Manage buttons open your normal web browser instead.

## Changing the address
If your site address changes, update it in `apps/desktop/main.js`, `apps/desktop/offline.html`, `apps/android/capacitor.config.json`, `apps/android/www/index.html` and `docs/js/config.js` (`SITE_URL`).

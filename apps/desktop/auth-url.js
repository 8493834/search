// Reads the sign-in result the website sends back as  spssearch://auth?id_token=...&access_token=...
function parseAuthUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "spssearch:" || u.hostname !== "auth") return null;
    const idToken = u.searchParams.get("id_token") || "";
    const accessToken = u.searchParams.get("access_token") || "";
    return idToken || accessToken ? { idToken, accessToken } : null;
  } catch {
    return null;
  }
}
module.exports = { parseAuthUrl };

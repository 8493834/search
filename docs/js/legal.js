// Agreements: Terms + Privacy on the first visit, and a separate agreement for each feature that
// sends data somewhere (AI overviews, submitting sites and panels, Google sign-in).
// Stored on this device only. Bump TERMS_VERSION when the terms or policy change in a way that
// needs people to agree again.
export const TERMS_VERSION = 1;
const KEY = "sps_consent";

export const FEATURES = {
  ai: {
    label: "AI-written overviews",
    detail: "If I turn on AI overviews, my search words and short snippets from the top results are sent to AI helper services (Cloudflare, with Deno and Vercel as backups) to write a summary. The summary is written by an AI model, can be wrong, and is not advice. It is off unless I switch it on.",
  },
  submit: {
    label: "Submitting sites and knowledge panels",
    detail: "If I submit a site or ask for a knowledge panel, what I send, together with my Google account email address, is stored and reviewed by the site admin. I confirm I own the site or am allowed to submit it, and that the facts I give are true. Approved sites and panels are public, and the email address of the person who requested one is stored with it and can be read publicly.",
  },
  signin: {
    label: "Signing in with Google",
    detail: "If I sign in, Google shares my email address and basic profile details with SPS Search's sign-in service (Firebase, with Supabase as a backup). My email address is stored with my account and with anything I submit.",
  },
};

/* ---------- storage ---------- */
function read() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c && c.v === TERMS_VERSION && c.terms === true ? c : null; // an older version means "ask again"
  } catch { return null; }
}
export const getConsent = read;
export const hasConsent = (key) => { const c = read(); return !!c && c[key] === true; };
export function saveConsent(patch) {
  const c = { ...(read() || { v: TERMS_VERSION }), ...patch, v: TERMS_VERSION, at: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch { return false; }
}
export function clearConsent() { try { localStorage.removeItem(KEY); } catch {} }

/* ---------- tiny DOM helper ---------- */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}
export const legalLink = (page, text) => el("a", { href: page, target: "_blank", rel: "noopener" }, text);
export const reviewLine = () => el("p", { class: "hint legal-review" }, "Review the ", legalLink("terms.html", "Terms and Conditions"), " and the ", legalLink("privacy.html", "Privacy Policy"), ".");

/* ---------- the dialog ---------- */
// boxes: [{key, label, detail, required, checked, disabled}]. Resolves to {key: bool} or null when cancelled.
function agreementDialog({ title, lead, boxes, confirm, cancel, allLabel, decline, locked }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "agree", "aria-labelledby": "agree-title" });
    const checks = {};
    const done = (val) => { dlg.close(); resolve(val); };
    dlg.addEventListener("close", () => dlg.remove());
    const confirmBtn = el("button", { class: "btn primary", type: "button" }, confirm);
    const update = () => { confirmBtn.disabled = !boxes.every((b) => !b.required || checks[b.key].checked); };

    const list = el("div", { class: "agree-list" }, boxes.map((b) => {
      const input = el("input", { type: "checkbox", id: "agree-" + b.key, checked: !!b.checked, disabled: !!b.disabled });
      checks[b.key] = input;
      input.addEventListener("change", update);
      return el("label", { class: "agree-item", for: "agree-" + b.key },
        input,
        el("span", {}, el("strong", {}, b.label, b.required ? "" : " (optional)"), b.detail ? el("small", {}, b.detail) : null));
    }));

    confirmBtn.onclick = () => done(Object.fromEntries(boxes.map((b) => [b.key, checks[b.key].checked])));
    const actions = el("div", { class: "agree-actions" });
    if (decline) actions.append(el("button", { class: "btn", type: "button", onclick: () => done(null) }, decline));
    if (cancel) actions.append(el("button", { class: "btn", type: "button", onclick: () => done(null) }, cancel));
    actions.append(el("span", { class: "spacer" }));
    if (allLabel) actions.append(el("button", { class: "btn", type: "button", onclick: () => {
      boxes.forEach((b) => { if (!b.disabled) checks[b.key].checked = true; });
      done(Object.fromEntries(boxes.map((b) => [b.key, checks[b.key].checked])));
    } }, allLabel));
    actions.append(confirmBtn);

    dlg.append(el("h2", { id: "agree-title" }, title), lead, list, actions);
    if (locked) dlg.addEventListener("cancel", (e) => e.preventDefault()); // can't be closed with Esc
    else dlg.addEventListener("cancel", () => resolve(null));
    document.body.append(dlg);
    update();
    dlg.showModal();
    (boxes.find((b) => !b.disabled) && checks[boxes.find((b) => !b.disabled).key] || confirmBtn).focus();
  });
}

const termsBox = (extra = {}) => ({
  key: "terms", required: true,
  label: "I have read and agree to the Terms and Conditions and the Privacy Policy.",
  detail: "If I am under 18, a parent or guardian agrees for me.", ...extra,
});

/** First visit (or the terms changed): returns true when agreed, false when declined. */
export async function firstVisit() {
  if (read()) return true;
  const res = await agreementDialog({
    title: "Welcome to SPS Search",
    lead: el("div", {},
      el("p", {}, "Before you start, please review and agree. Searching runs in your browser, and nothing about your searches is sent to us unless you turn on a feature below."),
      reviewLine()),
    boxes: [
      termsBox(),
      { key: "ai", label: FEATURES.ai.label, detail: FEATURES.ai.detail },
      { key: "submit", label: FEATURES.submit.label, detail: FEATURES.submit.detail },
      { key: "signin", label: FEATURES.signin.label, detail: FEATURES.signin.detail },
    ],
    confirm: "Agree and continue", allLabel: "Agree to all", decline: "I don't agree", locked: true,
  });
  if (!res || !res.terms) return false;
  saveConsent({ terms: true, ai: !!res.ai, submit: !!res.submit, signin: !!res.signin });
  return true;
}

/** Review or change the optional agreements later (Settings). Resolves to true if saved. */
export async function reviewAgreements() {
  const c = read() || {};
  const res = await agreementDialog({
    title: "Your agreements",
    lead: el("div", {}, el("p", {}, "You agreed to the Terms and the Privacy Policy on " + (c.at ? new Date(c.at).toLocaleDateString() : "an earlier visit") + ". You can change the optional ones any time."), reviewLine()),
    boxes: [
      termsBox({ checked: true, disabled: true, detail: "To withdraw this, stop using SPS Search and ask us to delete your data." }),
      { key: "ai", label: FEATURES.ai.label, detail: FEATURES.ai.detail, checked: !!c.ai },
      { key: "submit", label: FEATURES.submit.label, detail: FEATURES.submit.detail, checked: !!c.submit },
      { key: "signin", label: FEATURES.signin.label, detail: FEATURES.signin.detail, checked: !!c.signin },
    ],
    confirm: "Save", cancel: "Cancel",
  });
  if (!res) return false;
  saveConsent({ ai: res.ai, submit: res.submit, signin: res.signin });
  return true;
}

/** Ask for one feature's agreement the first time it is used. Resolves to true when agreed. */
export async function requireConsent(key) {
  if (hasConsent(key)) return true;
  const f = FEATURES[key];
  const res = await agreementDialog({
    title: f.label,
    lead: el("div", {}, el("p", {}, key === "signin" ? "Review the Terms and Conditions and the Privacy Policy before you sign in with Google." : "Please read this before you use this feature."), reviewLine()),
    boxes: [{ key, required: true, label: "I have read and agree.", detail: f.detail }],
    confirm: key === "signin" ? "Agree and continue to Google" : "Agree and continue", cancel: "Not now",
  });
  if (!res || !res[key]) return false;
  saveConsent({ terms: true, [key]: true });
  return true;
}

/** A card shown inside a page when its feature has not been agreed to yet. */
export function featureCard(key, onAgreed) {
  const f = FEATURES[key];
  return el("div", { class: "card" },
    el("h2", { style: "margin-top:0;font-size:1.1rem" }, f.label),
    el("p", {}, f.detail),
    reviewLine(),
    el("button", { class: "btn primary", onclick: async () => { if (await requireConsent(key)) onAgreed(); } }, "Review and agree"));
}

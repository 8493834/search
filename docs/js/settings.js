// Per-profile settings, kept in this browser (see profiles.js). Everything is off unless listed here as on.
import { getProfileSettings, setProfileSetting } from "./profiles.js";
const DEFAULTS = { overview: false, aionline: false };

export function getSettings() { return { ...DEFAULTS, ...getProfileSettings() }; }
export function getSetting(name) { return getSettings()[name]; }
export function setSetting(name, value) { return setProfileSetting(name, value); }

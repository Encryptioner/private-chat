// src/lib/modelLoadCache.js
// Tracks which chat models have loaded successfully before, in this browser.
// Used (alongside isGoodNetwork()) to decide whether to auto-load the model on
// open or ask first: a model that loaded before is very likely still cached, so
// this is the only positive signal on browsers without the Network Information
// API (Safari/iOS — isGoodNetwork() always returns false there).
const STORAGE_KEY = "pc_models_loaded_v1";

const readAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

export const hasLoadedModelBefore = (key) => !!readAll()[key];

export const markModelLoaded = (key) => {
  try {
    const all = readAll();
    all[key] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable (private browsing quota, etc.) — non-fatal, the
    // ask-first prompt just reappears next visit.
  }
};

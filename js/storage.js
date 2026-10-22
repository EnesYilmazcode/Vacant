// Storage is optional. Safari private mode and locked-down webviews can expose
// localStorage while throwing on every operation, so callers get the same
// answers they would have received from an empty store.
export function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A remembered preference is not worth breaking the app over.
  }
}

export function safeDel(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // An unavailable store already behaves as though the key were absent.
  }
}

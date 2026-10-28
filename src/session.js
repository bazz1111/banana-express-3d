const preferencesKey = 'banana-endless-preferences';

export function createSessionCourse(course, params = new URLSearchParams(), previousSeed) {
  const raw = params.get('seed');
  let seed = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(seed) || seed > 0xffffffff) {
    seed = Math.floor(Math.random() * 0x100000000);
    if (seed === previousSeed) seed = (seed + 1) >>> 0;
  }
  // Road geometry stays immutable and shared; the rules create their own mutable object states.
  return { ...course, seed };
}

export function readPreferences(storage) {
  try {
    const raw = JSON.parse((storage ?? globalThis.localStorage).getItem(preferencesKey) || '{}');
    return {
      quality: ['high', 'low'].includes(raw?.quality) ? raw.quality : null,
      sound: typeof raw?.sound === 'boolean' ? raw.sound : true,
    };
  } catch { return { quality: null, sound: true }; }
}

export function savePreferences(preferences, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(preferencesKey, JSON.stringify(preferences));
    return true;
  } catch { return false; }
}

// Word lists the copilot understands (en-AU, including a bit of Aussie slang). Pure data.

/** Nearby place categories. `query` is what we send to search; `label` is what we say back. */
export const CATEGORIES = Object.freeze([
  { id: 'fuel', query: 'petrol station', label: 'servo', words: ['servo', 'servos', "servo's", 'petrol station', 'petrol stations', 'petrol', 'gas station', 'service station', 'fuel station', 'fuel', 'unleaded', 'diesel', 'gas'] },
  { id: 'coffee', query: 'cafe', label: 'coffee', words: ['coffee shop', 'coffee', 'coffees', 'cafe', 'café', 'cafes', 'flat white', 'latte', 'cappuccino', 'long black', 'espresso', 'caffeine'] },
  { id: 'parking', query: 'parking', label: 'parking', words: ['parking', 'car park', 'carpark', 'car parks', 'parking spot', 'parking space', 'parking bay', 'somewhere to park', 'place to park', 'park the car'] },
  { id: 'food', query: "McDonald's", label: 'Maccas', words: ['maccas', "macca's", 'mcdonalds', "mcdonald's", 'mcdonald', 'macdonalds', 'mickey ds'] },
  { id: 'food', query: "Hungry Jack's", label: "Hungry Jack's", words: ['hungry jacks', "hungry jack's", 'hungry jack'] },
  { id: 'food', query: 'KFC', label: 'KFC', words: ['kfc'] },
  { id: 'food', query: 'Red Rooster', label: 'Red Rooster', words: ['red rooster'] },
  { id: 'food', query: 'restaurant', label: 'feed', words: ['food', 'something to eat', 'a feed', 'feed', 'restaurant', 'restaurants', 'takeaway', 'take away', 'lunch', 'dinner', 'breakfast', 'brekkie', 'brekky', 'tucker', 'snack'] },
  { id: 'toilets', query: 'public toilet', label: 'toilets', words: ['public toilets', 'public toilet', 'toilets', 'toilet', 'loo', 'loos', 'dunny', 'restroom', 'restrooms', 'bathroom', 'wee', 'pee'] },
  { id: 'ev', query: 'EV charging station', label: 'EV charger', words: ['ev chargers', 'ev charger', 'ev charging', 'ev station', 'charging station', 'charging stations', 'electric car charger', 'car charger', 'fast charger', 'supercharger', 'charger'] },
  { id: 'pharmacy', query: 'pharmacy', label: 'chemist', words: ['chemist', 'chemists', 'pharmacy', 'pharmacies'] },
  { id: 'bottle_shop', query: 'bottle shop', label: 'bottle-o', words: ['bottle-o', 'bottle o', 'bottleo', 'bottle shop', 'bottle shops', 'liquor store'] },
  { id: 'supermarket', query: 'Woolworths', label: 'Woolies', words: ['woolies', 'woolworths'] },
  { id: 'supermarket', query: 'Coles', label: 'Coles', words: ['coles'] },
  { id: 'supermarket', query: 'supermarket', label: 'supermarket', words: ['supermarket', 'supermarkets', 'grocery store', 'groceries'] },
  { id: 'atm', query: 'ATM', label: 'ATM', words: ['atm', 'atms', 'cash machine'] },
  { id: 'hospital', query: 'hospital', label: 'hospital', words: ['hospital', 'hospitals', 'emergency department'] },
  { id: 'mechanic', query: 'mechanic', label: 'mechanic', words: ['mechanic', 'mechanics', 'tyre shop', 'tire shop'] },
  { id: 'carwash', query: 'car wash', label: 'car wash', words: ['car wash', 'carwash'] },
]);

/** Spoken hazard words → config.HAZARD_TYPES id. */
export const HAZARD_WORDS = Object.freeze([
  { type: 'police', words: ['police', 'cops', 'cop', 'coppers', 'copper', 'booze bus', 'rbt', 'random breath test', 'breath test', 'highway patrol', 'cop car', 'police car', 'speed trap', 'police checkpoint', 'boys in blue'] },
  { type: 'camera', words: ['speed cameras', 'speed camera', 'mobile camera', 'red light camera', 'safety camera', 'camera van', 'speed van', 'cameras', 'camera', 'radar'] },
  { type: 'crash', words: ['crash', 'accident', 'collision', 'prang', 'smash', 'pile up', 'pile-up', 'rollover', 'fender bender'] },
  { type: 'roadworks', words: ['roadworks', 'road works', 'road work', 'roadwork', 'construction', 'lane closed', 'lane closure', 'line marking'] },
  { type: 'closure', words: ['road closed', 'road closure', 'closed road', 'road is closed', "road's closed", 'road blocked', 'blocked road', 'closure', 'detour'] },
  { type: 'traffic', words: ['traffic jam', 'heavy traffic', 'stopped traffic', 'slow traffic', 'bumper to bumper', 'banked up', 'gridlock', 'congestion', 'traffic', 'jam'] },
  { type: 'weather', words: ['water over the road', 'heavy rain', 'flooding', 'flooded', 'floods', 'flood', 'raining', 'rain', 'storm', 'hail', 'foggy', 'fog', 'weather', 'slippery', 'smoke', 'bushfire', 'strong wind'] },
  { type: 'hazard', words: ['something on the road', 'object on the road', 'broken down car', 'broken down', 'breakdown', 'oil spill', 'fallen tree', 'tree down', 'pothole', 'potholes', 'debris', 'kangaroo', 'roos', 'roo', 'animal', 'hazard'] },
]);

/** Paint colours for "paint my car red". Car paint is content, so literal colours are fine. */
export const COLOURS = Object.freeze({
  red: '#e53935', blue: '#1e88e5', 'navy': '#1a237e', green: '#43a047', yellow: '#fdd835', orange: '#fb8c00',
  purple: '#8e24aa', pink: '#ec407a', 'hot pink': '#ff1f8e', black: '#212121', white: '#fafafa', silver: '#b0bec5',
  grey: '#757575', gray: '#757575', gold: '#c9a227', teal: '#00897b', lime: '#c0ca33', brown: '#6d4c41',
});

export const MUSIC_APP_WORDS = Object.freeze([
  { app: 'youtube', words: ['youtube music', 'yt music', 'youtube'] },
  { app: 'apple', words: ['apple music', 'itunes', 'apple'] },
  { app: 'spotify', words: ['spotify'] },
]);

/** "play …" objects that mean "some music", not a search. */
export const GENERIC_MUSIC = Object.freeze([
  'music', 'some music', 'my music', 'tunes', 'some tunes', 'songs', 'some songs', 'a song', 'something',
  'something good', 'anything', 'my playlist', 'a playlist', 'my songs', 'bangers', 'some bangers', 'choons', 'some choons',
]);

const byLengthDesc = (a, b) => b.length - a.length;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build one regex that finds any of `words` on word boundaries (longest first). */
export function wordsRegex(words) {
  return new RegExp(`(?:^|[^a-z0-9'])(${[...words].sort(byLengthDesc).map(escapeRe).join('|')})(?=$|[^a-z0-9'])`, 'i');
}

const CATEGORY_INDEX = CATEGORIES.flatMap((c) => c.words.map((w) => ({ w, c }))).sort((a, b) => byLengthDesc(a.w, b.w));
const CATEGORY_RE = wordsRegex(CATEGORY_INDEX.map((e) => e.w));
const HAZARD_INDEX = HAZARD_WORDS.flatMap((h) => h.words.map((w) => ({ w, type: h.type })));

/** Category whose word appears in `phrase` (longest match), or null. */
export function findCategory(phrase) {
  const m = CATEGORY_RE.exec(String(phrase ?? '').toLowerCase());
  if (!m) return null;
  const hit = CATEGORY_INDEX.find((e) => e.w === m[1].toLowerCase());
  return hit ? hit.c : null;
}

/** Category when `phrase` IS a category word (ignoring articles), else null. */
export function exactCategory(phrase) {
  const p = String(phrase ?? '').toLowerCase().replace(/^(?:a|an|the|some|any)\s+/, '').trim();
  const hit = CATEGORY_INDEX.find((e) => e.w === p);
  return hit ? hit.c : null;
}

/** Hazard type mentioned in `phrase` (earliest, then longest), or null. "police station" is not police. */
export function findHazard(phrase) {
  const text = ` ${String(phrase ?? '').toLowerCase()} `;
  let best = null;
  for (const { w, type } of HAZARD_INDEX) {
    const re = new RegExp(`[^a-z0-9']${escapeRe(w)}(?=[^a-z0-9'])`);
    const m = re.exec(text);
    if (!m) continue;
    if (type === 'police' && /^\s*stations?\b/.test(text.slice(m.index + 1 + w.length))) continue;
    if (!best || m.index < best.index || (m.index === best.index && w.length > best.w.length)) best = { index: m.index, w, type };
  }
  return best ? best.type : null;
}

/** Music app named in `phrase`, or null. */
export function findMusicApp(phrase) {
  const p = String(phrase ?? '').toLowerCase();
  for (const { app, words } of MUSIC_APP_WORDS) if (wordsRegex(words).test(p)) return app;
  return null;
}

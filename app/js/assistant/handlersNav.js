// Copilot handlers for driving: destinations, nearby places, ETA, avoid, hazards, where am I.
// Each handler is (slots, env) → Reply | Promise<Reply>. DOM-free.
import { reply, unavailable, failed, listWords, isPlace, firstRoute } from './reply.js';
import { etaReply, routeReply, nearbyReply, hazardReply, shortPlace, spokenDuration } from './phrases.js';
import { matchName } from './contacts.js';

const MAX_QUERY = 120;

function here(env) {
  const p = env.state().position;
  return p && Number.isFinite(p.lng) && Number.isFinite(p.lat) ? [p.lng, p.lat] : null;
}

function distanceText(env, from, place) {
  if (!from) return '';
  const m = env.deps.geo.haversine(from, [place.lng, place.lat]);
  return Number.isFinite(m) ? env.deps.geo.formatDistance(m, env.units()).text : '';
}

function previewRoute(env) {
  const s = env.state();
  if (s.mode !== 'preview' || !Array.isArray(s.routes)) return null;
  return s.routes[s.selectedRoute ?? 0] ?? s.routes[0] ?? null;
}

export async function navigate(slots, env) {
  const query = String(slots.query ?? '').trim().slice(0, MAX_QUERY);
  if (!query) return reply('Where to? Say "take me to" and a place.');
  try {
    if (env.has('routeTo')) {
      const place = await env.call('routeTo', query);
      const name = isPlace(place) ? place.name : env.state().destination?.name ?? query;
      return reply(routeReply(name, previewRoute(env), { ask: slots.ask }), { tone: 'good' });
    }
    if (!env.has('search') || !env.has('planRoute')) return unavailable('Search');
    const found = await env.call('search', query, { near: env.deps.getNear(), limit: 5 });
    const place = Array.isArray(found) ? found.find(isPlace) : null;
    if (!place) return reply(`I couldn't find ${query}. Try adding the suburb.`, { tone: 'warn' });
    const routes = await env.call('planRoute', place);
    return reply(routeReply(place.name, firstRoute(routes), { ask: slots.ask }), { tone: 'good' });
  } catch (err) {
    return failed(err, `I couldn't plan a route to ${query}.`);
  }
}

export async function goSaved(slot, env) {
  const action = slot === 'home' ? 'goHome' : 'goWork';
  const name = slot === 'home' ? 'Home' : 'Work';
  if (!env.has(action)) return reply(`I don't know where ${slot} is yet. Search for it, then save it as ${name}.`);
  try {
    return reply(routeReply(name, firstRoute(await env.call(action))), { tone: 'good' });
  } catch (err) {
    return failed(err, `I couldn't plan the route ${slot === 'home' ? 'home' : 'to work'}.`);
  }
}

async function friendLocation(query, env) {
  if (!env.has('listFriends')) return null;
  const friends = await env.call('listFriends');
  const friend = matchName(Array.isArray(friends) ? friends : [], query);
  if (!friend) return null;
  const loc = friend.theirLocation;
  if (!loc || !Number.isFinite(loc.lng) || !Number.isFinite(loc.lat)) return reply(`${friend.name} isn't sharing their location with you.`);
  const d = distanceText(env, here(env), loc);
  return reply(d ? `${friend.name} is ${d} away.` : `${friend.name} is on the map.`);
}

export async function findNearby(slots, env) {
  const generic = slots.category === 'place';
  const query = String(slots.query ?? '').trim().slice(0, MAX_QUERY);
  if (!query) return reply('What should I look for?');
  try {
    if (generic) {
      const friend = await friendLocation(query, env);
      if (friend) return friend;
    }
    if (!env.has('search')) return unavailable('Search');
    const near = env.deps.getNear();
    const found = await env.call('search', query, { near, limit: 8 });
    const places = Array.isArray(found) ? found.filter(isPlace) : [];
    if (!places.length) return reply(`I couldn't find ${generic ? query : `any ${slots.label}`} nearby. Try the search bar.`, { tone: 'warn' });
    const from = here(env) ?? near;
    const dist = (p) => (from ? env.deps.geo.haversine(from, [p.lng, p.lat]) : 0);
    const best = generic || !from ? places[0] : [...places].sort((a, b) => dist(a) - dist(b))[0];
    const base = { label: slots.label, generic, place: best, distanceText: distanceText(env, from, best) };
    if (!env.has('planRoute')) return reply(nearbyReply({ ...base, routed: false }));
    try {
      await env.call('planRoute', best);
    } catch (err) {
      console.warn('[copilot] planRoute failed', err);
      return reply(`${nearbyReply({ ...base, routed: false })} I couldn't get a route there.`, { tone: 'warn' });
    }
    return reply(nearbyReply({ ...base, routed: true }), { tone: 'good' });
  } catch (err) {
    return failed(err, `I couldn't search for ${generic ? query : slots.label} right now.`);
  }
}

export async function eta(slots, env) {
  const status = env.has('navStatus') ? await env.call('navStatus') : null;
  const units = env.units();
  if (status && Number.isFinite(status.durationRemaining)) {
    const dist = Number.isFinite(status.distanceRemaining) ? env.deps.geo.formatDistance(status.distanceRemaining, units).text : '';
    return reply(etaReply(status, { ask: slots.ask, distanceText: dist, timeZone: env.deps.timeZone }));
  }
  const route = previewRoute(env);
  if (route && Number.isFinite(route.duration)) {
    const dist = Number.isFinite(route.distance) ? `, ${env.deps.geo.formatDistance(route.distance, units).text}` : '';
    return reply(`This route takes ${spokenDuration(route.duration)}${dist}. Say "go" to start.`);
  }
  return reply("You're not navigating right now. Tell me where to go.");
}

export async function stopNav(_slots, env) {
  const { mode } = env.state();
  if (mode === 'navigate') {
    if (!env.has('stopNavigation')) return unavailable('Navigation');
    await env.call('stopNavigation');
    return reply('Navigation stopped.');
  }
  if (mode === 'preview') {
    env.deps.closeSheet?.();
    return reply('Route cancelled.');
  }
  return reply("There's no route to stop.");
}

export async function startNav(_slots, env) {
  const s = env.state();
  if (s.mode === 'navigate') return reply("You're already on your way.");
  const route = previewRoute(env);
  if (!route || !isPlace(s.destination)) return reply('Pick a destination first. Say "take me to" and a place.');
  if (!env.has('startNavigation')) return unavailable('Navigation');
  await env.call('startNavigation', route, s.destination);
  return reply(`Let's go. ${spokenDuration(route.duration)} to ${s.destination.name}.`, { speak: false, tone: 'good' });
}

const AVOID_SETTINGS = [
  ['tolls', 'avoidTolls'],
  ['freeways', 'avoidMotorways'],
  ['ferries', 'avoidFerries'],
];

function avoidTraffic(env) {
  if (env.state().settings?.tomtomKey) return reply('Routes already use live traffic, and I pick the quickest one.');
  return reply("I don't have live traffic right now, so routes use typical speeds.");
}

export async function avoid(slots, env) {
  const changes = AVOID_SETTINGS.filter(([k]) => typeof slots[k] === 'boolean');
  if (!changes.length) return slots.traffic ? avoidTraffic(env) : reply('Say "avoid tolls", "avoid freeways" or "avoid ferries".');
  if (!env.has('setSetting')) return unavailable('Settings');
  for (const [k, key] of changes) await env.call('setSetting', key, slots[k]);
  const on = changes.filter(([k]) => slots[k]).map(([k]) => k);
  const off = changes.filter(([k]) => !slots[k]).map(([k]) => k);
  const what = [on.length ? `Avoiding ${listWords(on)}` : '', off.length ? `${on.length ? 'using' : 'Using'} ${listWords(off)} again` : ''].filter(Boolean).join(', ');
  const s = env.state();
  if (s.mode === 'preview' && isPlace(s.destination) && env.has('planRoute')) {
    try {
      await env.call('planRoute', s.destination);
      return reply(`${what}. Route updated.`, { tone: 'good' });
    } catch (err) {
      return failed(err, `${what}, but I couldn't update the route.`);
    }
  }
  if (s.mode === 'navigate') return reply(`${what}. That applies from your next route.`);
  return reply(`${what} from now on.`);
}

export async function reportHazard(slots, env) {
  const types = env.deps.config.HAZARD_TYPES;
  const type = types.find((t) => t.id === slots.type) ?? types.find((t) => t.id === 'hazard');
  if (!env.has('reportHazard')) return unavailable('Hazard reports');
  const pos = here(env);
  try {
    await env.call('reportHazard', type.id, pos ? { lngLat: pos } : {});
    return reply(hazardReply(type.label), { tone: 'good' });
  } catch (err) {
    return failed(err, `I couldn't report that. Tap the hazard button instead.`);
  }
}

export async function whereAmI(_slots, env) {
  const pos = here(env);
  if (!pos) return reply("I don't know where you are yet. Check location is turned on.", { tone: 'warn' });
  if (!env.has('reverseGeocode')) return unavailable('Address lookup');
  try {
    const place = await env.call('reverseGeocode', pos);
    return isPlace(place) || typeof place?.name === 'string' ? reply(`You're near ${shortPlace(place)}.`) : reply("I couldn't work out the street. You're the blue car on the map.");
  } catch (err) {
    return failed(err, "I couldn't look up where you are right now.");
  }
}

// Car module: the driver's car on the map (3D layer, or the flat 2D marker as a fallback),
// its flame-pop timer, the Garage, and the friends' car marker helper for the social module.
import { normaliseLook, createFlameTimer, popCount, sameLook } from './flames.js';
import { createMarker2D } from './marker2d.js';
import { createCarMarker } from './friends.js';
import { openGarage } from './garage.js';

const CELEBRATE_POPS = 3;
const DEFAULT_MANUAL_POPS = 2;

export async function init(ctx) {
  const { store, bus, ui, actions, mapView } = ctx;
  let look = normaliseLook(store.get().car);
  let car = null; // { kind, setLook, pop, destroy }
  let generation = 0;

  const timer = createFlameTimer(look, () => car?.pop());

  function mount2D() {
    try {
      car = createMarker2D(ctx, look);
    } catch (err) {
      console.error('[car] 2D car marker failed', err);
      car = null;
    }
  }

  async function mountCar() {
    generation += 1;
    const mine = generation;
    car?.destroy();
    car = null;
    if (store.get().settings.car3d !== false) {
      try {
        const { createCar3D } = await import('./car3d.js');
        const made = await createCar3D(ctx, look, {
          onFail: (err) => {
            console.warn('[car] 3D car stopped; showing the flat car', err);
            if (car === made) {
              made.destroy();
              car = null;
              mount2D();
            }
          },
        });
        if (mine !== generation) {
          made.destroy();
          return;
        }
        car = made;
        return;
      } catch (err) {
        console.warn('[car] 3D car unavailable; showing the flat car', err);
        if (mine !== generation) return;
      }
    }
    mount2D();
  }

  function setCarLook(patch) {
    if (!patch || typeof patch !== 'object') return;
    store.set((s) => {
      const next = normaliseLook({ ...normaliseLook(s.car), ...patch });
      return sameLook(next, s.car) ? null : { car: next };
    });
  }

  function popFlames(count) {
    const n = Number.isFinite(count) && count > 0 ? count : popCount(look.pat) || DEFAULT_MANUAL_POPS;
    timer.burst(n);
  }

  store.select((s) => s.car, (raw) => {
    const next = normaliseLook(raw);
    if (sameLook(next, look)) return;
    look = next;
    car?.setLook(look);
    timer.update(look);
    bus.emit('car:changed', { ...look });
  });
  store.select((s) => s.settings.car3d, () => mapView.ready.then(mountCar));

  const showGarage = () => openGarage(ctx, { setCarLook, revMapCar: () => popFlames(CELEBRATE_POPS) });
  actions.register('openGarage', showGarage);
  actions.register('setCarLook', setCarLook);
  actions.register('popFlames', () => popFlames());
  actions.register('createCarMarker', (opts) => createCarMarker(ctx, opts ?? {}));

  ui.addDockItem({ id: 'garage', icon: 'car', label: 'Garage', order: 20, onClick: showGarage });

  bus.on('map:landed', () => popFlames(CELEBRATE_POPS));
  bus.on('nav:start', () => popFlames(CELEBRATE_POPS));

  // Don't hold up the other modules while the map (and three.js) load.
  mapView.ready.then(mountCar).then(() => timer.start()).catch((err) => console.error('[car] could not place the car', err));
}

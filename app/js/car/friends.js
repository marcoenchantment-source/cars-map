// Friends' cars: billboard markers with the side-view car (facing left or right by heading),
// a name label and flame pops on the friend's own timer. Looks come from remote data, so
// every input is validated here (normaliseLook, sanitiseName, validLngLat).
import { normaliseLook, sanitiseName, createFlameTimer, facesLeft, validLngLat, LABEL_MAX } from './flames.js';
import { createSideCar } from './car2d.js';

const FRIEND_DEFAULT = Object.freeze({ name: 'Friend', color: '#8e44ad', rim: 'five', pat: 'off', int: 3, body: 'coupe' });
let bobSeed = 0;

/**
 * @param {{map: object}} ctx
 * @param {{look?: object, name?: string, lngLat?: [number,number], bearing?: number}} opts
 * @returns {{setPosition(lngLat, bearing?):void, setLook(look):void, pop():void, remove():void}}
 */
export function createCarMarker(ctx, { look, name, lngLat, bearing } = {}) {
  const { map } = ctx;
  let current = normaliseLook(look, FRIEND_DEFAULT);
  bobSeed = (bobSeed + 1) % 7;

  const root = document.createElement('div');
  root.className = 'car-friend';
  const car = createSideCar(current, { size: 70, bob: true, bobDelay: bobSeed * 1.1 });
  const carWrap = document.createElement('div');
  carWrap.className = 'car-friend-car';
  carWrap.append(car.el);
  const label = document.createElement('span');
  label.className = 'car-friend-name';
  root.append(carWrap, label);

  function setName(raw) {
    const text = sanitiseName(raw ?? '', LABEL_MAX) || sanitiseName(current.name, LABEL_MAX) || 'Friend';
    label.textContent = text;
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', `${text}'s car`);
  }
  let nameOverride = typeof name === 'string' ? name : null;
  setName(nameOverride);

  const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' });
  let added = false;
  let removed = false;

  function setPosition(next, nextBearing) {
    if (removed) return;
    const pos = validLngLat(next);
    if (!pos) return;
    marker.setLngLat(pos);
    if (Number.isFinite(nextBearing)) root.classList.toggle('is-left', facesLeft(nextBearing));
    if (!added) {
      marker.addTo(map);
      added = true;
    }
  }

  const timer = createFlameTimer(current, () => car.pop());
  timer.start();
  setPosition(lngLat, bearing);

  return Object.freeze({
    setPosition,
    setLook(next) {
      if (removed) return;
      current = normaliseLook(next, current);
      car.setLook(current);
      timer.update(current);
      if (nameOverride == null) setName(null);
    },
    setName(next) {
      nameOverride = typeof next === 'string' ? next : null;
      setName(nameOverride);
    },
    pop() {
      if (!removed) car.pop();
    },
    remove() {
      if (removed) return;
      removed = true;
      timer.stop();
      marker.remove();
      car.destroy();
    },
  });
}

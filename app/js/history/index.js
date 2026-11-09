// History module: records real drives, draws every road driven, and the Logbook sheet.
import { createTripStore } from './tripStore.js';
import { startRecorder } from './recorder.js';
import { createDrivenLayer } from './drivenLayer.js';
import { createLogbook } from './logbook.js';

export async function init(ctx) {
  const tripStore = createTripStore(ctx.storage);
  startRecorder(ctx, tripStore);

  // The logbook works even if the map layer cannot be added (e.g. style failed to load).
  let drivenLayer = null;
  const logbook = createLogbook(ctx, tripStore, {
    highlight: (id) => drivenLayer?.highlight(id),
  });
  ctx.ui.addDockItem({ id: 'logbook', icon: 'history', label: 'Logbook', order: 50, onClick: () => logbook.open() });
  ctx.actions.register('openTrips', () => logbook.open());

  createDrivenLayer(ctx, tripStore)
    .then((layer) => {
      drivenLayer = layer;
    })
    .catch((err) => console.error('[history] driven-roads layer failed', err));
}

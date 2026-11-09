// Instruction text (en-AU) and the spoken twin with road abbreviations expanded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStep, expandName, speakable, compassDirection, ordinal } from '../app/js/routing/instructions.js';
import { roadLabel, formatVia, summaryFromSteps, pickName } from '../app/js/routing/normalize.js';
import { destinationsText } from '../app/js/routing/osrm.js';

const say = (step, opts) => describeStep(step, opts).instruction;

test('depart / turn / continue', () => {
  assert.equal(say({ type: 'depart', heading: 2, road: 'Hay Street' }), 'Head north on Hay Street');
  assert.equal(say({ type: 'depart', heading: 225 }), 'Head south-west');
  assert.equal(say({ type: 'depart' }), 'Start driving');
  assert.equal(say({ type: 'turn', modifier: 'left', road: 'Hay Street' }), 'Turn left onto Hay Street');
  assert.equal(say({ type: 'turn', modifier: 'slight right', road: 'Hay Street' }), 'Turn slightly right onto Hay Street');
  assert.equal(say({ type: 'turn', modifier: 'sharp left' }), 'Turn sharp left');
  assert.equal(say({ type: 'turn', modifier: 'right', towards: 'Joondalup' }), 'Turn right towards Joondalup');
  assert.equal(say({ type: 'new-name', modifier: 'straight', road: 'Kwinana Freeway' }), 'Continue onto Kwinana Freeway');
  assert.equal(say({ type: 'continue', modifier: 'straight' }), 'Continue straight');
  assert.equal(say({ type: 'continue', modifier: 'slight left', road: 'Mounts Bay Road' }), 'Keep left onto Mounts Bay Road');
  assert.equal(say({ type: 'continue', modifier: 'right', road: 'Leach Highway' }), 'Turn right onto Leach Highway');
});

test('freeway manoeuvres', () => {
  assert.equal(say({ type: 'fork', modifier: 'slight right', towards: 'Mitchell Freeway' }), 'Keep right towards Mitchell Freeway');
  assert.equal(say({ type: 'fork', modifier: 'slight left' }), 'Keep left at the fork');
  assert.equal(say({ type: 'off-ramp', modifier: 'slight left', towards: 'Joondalup' }), 'Take the exit on the left towards Joondalup');
  assert.equal(say({ type: 'off-ramp', exit: 12, towards: 'Fremantle' }), 'Take exit 12 towards Fremantle');
  assert.equal(say({ type: 'off-ramp' }), 'Take the exit');
  assert.equal(say({ type: 'on-ramp', modifier: 'straight', road: 'Kwinana Freeway' }), 'Take the ramp onto Kwinana Freeway');
  assert.equal(say({ type: 'merge', modifier: 'slight right', road: 'Kwinana Freeway' }), 'Merge onto Kwinana Freeway');
  assert.equal(say({ type: 'merge', modifier: 'slight left' }), 'Merge left');
  assert.equal(say({ type: 'end-of-road', modifier: 'right', road: 'Queen Victoria Street' }), 'At the end of the road, turn right onto Queen Victoria Street');
});

test('roundabouts, U-turns, ferries and arrival', () => {
  assert.equal(say({ type: 'roundabout', exit: 2, road: 'Canning Highway' }), 'At the roundabout, take the 2nd exit onto Canning Highway');
  assert.equal(say({ type: 'rotary', exit: 1, road: 'Mounts Bay Road', rotaryName: 'Point Lewis Rotary' }), 'Enter Point Lewis Rotary and take the 1st exit onto Mounts Bay Road');
  assert.equal(say({ type: 'roundabout', modifier: 'left', road: 'Parry Street' }), 'At the roundabout, turn left onto Parry Street');
  assert.equal(say({ type: 'roundabout' }), 'Enter the roundabout');
  assert.equal(say({ type: 'exit-roundabout', road: 'High Street' }), 'Exit the roundabout onto High Street');
  assert.equal(say({ type: 'uturn', modifier: 'uturn' }), 'Make a U-turn');
  assert.equal(say({ type: 'turn', modifier: 'uturn', road: 'Hay Street' }), 'Make a U-turn onto Hay Street');
  assert.equal(say({ type: 'notification', mode: 'ferry', road: 'Rottnest Ferry' }), 'Board the ferry (Rottnest Ferry)');
  assert.equal(say({ type: 'arrive', modifier: 'left' }, { destinationName: 'Fremantle Markets' }), 'You have arrived at Fremantle Markets, on your left');
  assert.equal(say({ type: 'arrive', road: 'Essex Street' }), 'You have arrived at Essex Street');
  assert.equal(say({ type: 'arrive' }), 'You have arrived');
  assert.equal(say({ type: 'mystery', road: 'Hay Street' }), 'Continue onto Hay Street');
});

test('road abbreviations expand for speech', () => {
  assert.equal(expandName('St Georges Tce'), 'Saint Georges Terrace');
  assert.equal(expandName('Hay St'), 'Hay Street');
  assert.equal(expandName('Great Eastern Hwy'), 'Great Eastern Highway');
  assert.equal(expandName('Mitchell Fwy'), 'Mitchell Freeway');
  assert.equal(expandName('Riverside Dr'), 'Riverside Drive');
  assert.equal(expandName('Marine Pde'), 'Marine Parade');
  assert.equal(expandName('Kings Park Rd'), 'Kings Park Road');
  assert.equal(expandName('Ocean Reef Bvd'), 'Ocean Reef Boulevard');
  assert.equal(expandName('Joondalup Blvd.'), 'Joondalup Boulevard');
  assert.equal(expandName('Wellington Cres'), 'Wellington Crescent');
  assert.equal(expandName('Cobb Pl'), 'Cobb Place');
  assert.equal(expandName('Ord Ct'), 'Ord Court');
  assert.equal(expandName('Lakes Cct'), 'Lakes Circuit');
  assert.equal(expandName('Lime Gr'), 'Lime Grove');
  assert.equal(expandName('City Beach Hts'), 'City Beach Heights');
  assert.equal(expandName('Ninth Ave'), 'Ninth Avenue');
  assert.equal(expandName('Mt Lawley'), 'Mount Lawley');
  assert.equal(expandName('St Kilda Rd / Hay St'), 'Saint Kilda Road / Hay Street');
  assert.equal(expandName('Hay Street'), 'Hay Street');
  assert.equal(expandName('1st Ave'), '1st Avenue');
  assert.equal(expandName(''), '');
});

test('spoken text uses expanded names, display keeps them as signed', () => {
  const t = describeStep({ type: 'turn', modifier: 'left', road: 'St Georges Tce' });
  assert.equal(t.instruction, 'Turn left onto St Georges Tce');
  assert.equal(t.spoken, 'Turn left onto Saint Georges Terrace');
  const r = describeStep({ type: 'off-ramp', exit: 3, towards: 'Mt Lawley' });
  assert.equal(r.spoken, 'Take exit 3 towards Mount Lawley');
  assert.equal(describeStep({ type: 'arrive' }, { destinationName: 'St Johns Pl' }).spoken, 'You have arrived at Saint Johns Place');
});

test('speakable expands whole sentences', () => {
  assert.equal(speakable('Turn left onto St Georges Tce then Hay St'), 'Turn left onto Saint Georges Terrace then Hay Street');
  assert.equal(speakable('St Kilda Rd ahead'), 'Saint Kilda Road ahead');
  assert.equal(speakable(''), '');
});

test('compass and ordinals', () => {
  assert.equal(compassDirection(0), 'north');
  assert.equal(compassDirection(44), 'north-east');
  assert.equal(compassDirection(359), 'north');
  assert.equal(compassDirection(-90), 'west');
  assert.equal(compassDirection(NaN), '');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
});

test('road labels, via summaries and destinations', () => {
  assert.equal(roadLabel('Hay Street', '53'), 'Hay Street');
  assert.equal(roadLabel('', '7; 1'), 'Route 7');
  assert.equal(roadLabel('', 'M1'), 'Route M1');
  assert.equal(roadLabel('', ''), '');
  assert.equal(pickName(['53', 'Beaufort Street']), 'Beaufort Street');
  assert.equal(pickName(['2']), 'Route 2');
  assert.equal(formatVia(['Kwinana Freeway', ' Leach Highway', 'Kwinana Freeway']), 'via Kwinana Freeway and Leach Highway');
  assert.equal(formatVia(['']), '');
  assert.equal(destinationsText('1, 7: Fremantle'), 'Fremantle');
  assert.equal(destinationsText('2'), 'Route 2');
  assert.equal(destinationsText('Mitchell Freeway: Joondalup, Wanneroo, Yanchep'), 'Joondalup, Wanneroo');
  assert.equal(destinationsText(undefined), '');
  const steps = [
    { type: 'depart', road: '', distance: 10 },
    { type: 'turn', road: 'Short St', distance: 100 },
    { type: 'merge', road: 'Mitchell Freeway', distance: 5000 },
    { type: 'turn', road: 'Leach Highway', distance: 3000 },
    { type: 'arrive', road: 'Essex Street', distance: 0 },
  ];
  assert.equal(summaryFromSteps(steps), 'via Mitchell Freeway and Leach Highway');
});

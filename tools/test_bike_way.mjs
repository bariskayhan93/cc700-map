// Bike rule (24 Nov, owner): one rule for the far map and the way-back graph. NRW: firm tracks are allowed (LFoG § 2,
// LNatSchG § 57); ways a rider would not take are cut (driveways, private, motorways, trails).
import assert from 'node:assert/strict';
import {bikeWay, bikeWayPolicy} from '../js/recovery_graph.js';
const ok = n => console.log('PASS ' + n);
const forest = [{highway: 'track', tracktype: 'grade2', surface: 'compacted'}, {highway: 'track', tracktype: 'grade3', surface: 'compacted', motor_vehicle: 'agricultural'},
  {highway: 'track', tracktype: 'grade2', surface: 'pebblestone'}, {highway: 'track', tracktype: 'grade2', surface: 'fine_gravel'}];
for (const t of forest) assert.equal(bikeWay(t), 'ride', JSON.stringify(t));
ok('the 21 Nov forest tracks are ways to ride');
for (const [t, want] of [
  [{highway: 'residential'}, 'ride'], [{highway: 'service'}, 'ride'], [{highway: 'cycleway'}, 'ride'], [{highway: 'primary'}, 'ride'],
  [{highway: 'trunk'}, 'ride'], [{highway: 'trunk', motorroad: 'yes'}, null], [{highway: 'motorway'}, null], [{highway: 'motorway_link'}, null],
  [{highway: 'service', service: 'driveway'}, null], [{highway: 'service', service: 'parking_aisle'}, null],
  [{highway: 'residential', access: 'private'}, null], [{highway: 'track', access: 'agricultural', bicycle: 'yes'}, 'ride'],
  [{highway: 'residential', access: 'destination'}, 'ride'], [{highway: 'residential', bicycle: 'no'}, null], [{highway: 'secondary', bicycle: 'use_sidepath'}, null],
  [{highway: 'footway'}, null], [{highway: 'footway', bicycle: 'yes'}, 'ride'], [{highway: 'path', surface: 'compacted'}, 'exit'],
  [{highway: 'path', bicycle: 'designated'}, 'ride'], [{highway: 'path', bicycle: 'yes', 'mtb:scale': '3'}, null],
  [{highway: 'track', tracktype: 'grade4'}, 'exit'], [{highway: 'track'}, 'exit'], [{highway: 'path'}, 'exit'], [{highway: 'bridleway'}, 'exit'],
  [{highway: 'track', tracktype: 'grade2', smoothness: 'horrible'}, null], [{highway: 'path', informal: 'yes'}, null], [{highway: 'steps'}, null],
  [{highway: 'construction'}, null], [{highway: 'pedestrian', area: 'yes'}, null], [{highway: 'cycleway', bicycle: 'dismount'}, null]]) assert.equal(bikeWay(t), want, JSON.stringify(t));
ok('allowed, cut and exit classes');
assert.deepEqual(bikeWayPolicy({highway: 'track', tracktype: 'grade2'}), {forward: true, backward: true});
assert.equal(bikeWayPolicy({highway: 'track'}).exit, true);
assert.deepEqual(bikeWayPolicy({highway: 'residential', oneway: 'yes'}), {forward: true, backward: false});
assert.equal(bikeWayPolicy({highway: 'service', service: 'driveway'}).reason, 'not-for-riding');
ok('graph policy: firm track both ways, untagged track exit only, one-way kept, driveway out');

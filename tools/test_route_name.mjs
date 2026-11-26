// node tools/test_route_name.mjs: the menu name falls back to the file name when the GPX name is generic.
import assert from 'node:assert/strict';
import { routeName } from '../js/route.js';

assert.equal(routeName('Route', 'Test_900m_N.gpx'), 'Test 900m N');
assert.equal(routeName('route', 'Route 400m North.gpx'), 'Route 400m North');
assert.equal(routeName('Track', 'Route_2200m_N.gpx'), 'Route 2200m N');
assert.equal(routeName('', 'a/b/Test_Route_N5.gpx'), 'Test Route N5');
assert.equal(routeName('GPX route', 'x.GPX'), 'x');
assert.equal(routeName('Rheinrunde', 'Test_900m_N.gpx'), 'Rheinrunde');   // own name stays
assert.equal(routeName('Route', ''), 'Route');                            // no file name: keep the GPX name
assert.equal(routeName('Route'), 'Route');
console.log('route name: 8 OK');

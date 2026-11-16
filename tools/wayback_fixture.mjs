// Synthetic street graphs and routes for the way-back tests.
// Local metres near latitude 51, longitude 7. Edges are in both directions unless stated.
import {hav} from '../js/geo.js';

const K = Math.cos(51 * Math.PI / 180);
export const p = (x, y) => [51 + y / 111320, 7 + x / (111320 * K)];

// list: [[x, y], ...]; links: [[i, j]] (both ways) or [[i, j, 'one']] (i to j only).
function makeGraph(list, links) {
  const nodes = list.map(([x, y], id) => ({id, point: p(x, y)}));
  const edges = [];
  const add = (i, j) => edges.push({from: i, to: j, meters: hav(nodes[i].point, nodes[j].point)});
  for (const [i, j, one] of links) { add(i, j); if (one !== 'one') add(j, i); }
  return {nodes, edges};
}

export function gridFixture() {
  const list = [
    [-300, 0], [0, 0], [220, 0], [300, 0],   // 0-3 route nodes
    [0, 50], [0, 100], [0, 150], [0, 200],   // 4-7 street x=0
    [100, 200], [220, 200], [220, 100],      // 8-10 top and right streets
    [-100, 100],                             // 11 one-way start
    [0, 1800],                               // 12 long street end
  ];
  const links = [
    [0, 1], [1, 2], [2, 3],
    [1, 4], [4, 5], [5, 6], [6, 7],
    [7, 8], [8, 9],
    [9, 10], [10, 2],
    [11, 5, 'one'],
    [12, 7],
  ];
  const graph = makeGraph(list, links);
  const route = [{point: p(-300, 0), progress: 0}, {point: p(300, 0), progress: 60000}];
  return {graph, route, p};
}

// Route west to east along y = 0, north 420 m, back west along y = 420. The street x = 0 joins the passes.
export function loopFixture() {
  const list = [[-300, 0], [0, 0], [2000, 0], [2000, 420], [0, 420], [-300, 420]];   // 0-5 route nodes
  const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
  let prev = 1;   // (0,0)
  for (let y = 50; y <= 400; y += 50) {
    list.push([0, y]);
    const id = list.length - 1;
    links.push([prev, id]);
    prev = id;
  }
  links.push([prev, 4]);   // (0,400) to (0,420)
  const graph = makeGraph(list, links);
  const route = [
    {point: p(-300, 0), progress: 0},
    {point: p(2000, 0), progress: 230000},
    {point: p(2000, 420), progress: 272000},
    {point: p(-300, 420), progress: 502000},
  ];
  return {graph, route, p};
}

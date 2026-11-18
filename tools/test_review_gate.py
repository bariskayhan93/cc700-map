"""Host tests of the review gate helpers (tools/review_gate.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_gate as g  # noqa: E402


class ReviewGateTest(unittest.TestCase):
    def test_a_coordinate_pair_is_found(self):
        pair = '-48.87654' + ', ' + '-123.39321'   # open ocean; built here so this file holds no pair (G1)
        self.assertEqual(g.coord_pairs(f'const p = [{pair}];'), [pair])

    def test_values_that_are_not_coordinates_are_not_found(self):
        self.assertEqual(g.coord_pairs('0.12345, 0.54321 and 1.5, 2.5 and 400.12345, 12.12345'), [])

    def test_deepest_path_adds_the_frames(self):
        nodes = {'a': 10, 'b': 20, 'c': 5, 'd': 40}
        edges = {'a': {'b', 'c'}, 'b': {'d'}, 'c': set()}
        self.assertEqual(g.deepest(nodes, edges, 'a'), (70, ['a', 'b', 'd']))

    def test_recursion_is_refused(self):
        with self.assertRaises(ValueError):
            g.deepest({'a': 1, 'b': 1}, {'a': {'b'}, 'b': {'a'}}, 'a')


if __name__ == '__main__':
    unittest.main()

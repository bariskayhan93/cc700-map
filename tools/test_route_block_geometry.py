import unittest
from route_block_audit import entry_geometry
class BlockGeometry(unittest.TestCase):
 def test_encoded_label_text_is_not_geographic_geometry(self):
  entry=(7,12|32,100,200,[(0x64616f52,0x656d614e)])
  self.assertEqual(entry_geometry(entry),[])
 def test_geometric_entry_includes_first_point_and_path(self):
  self.assertEqual(entry_geometry((7,4|32,100,200,[(101,201)])),[(100,200),(101,201)])
if __name__=='__main__':unittest.main()

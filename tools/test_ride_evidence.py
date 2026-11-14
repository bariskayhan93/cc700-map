import unittest
from ride_evidence import carve_logs, unique_lines
class LogRecovery(unittest.TestCase):
 def test_literal_escaped_lines_retain_separate_timestamps_and_offsets(self):
  a=b'[I]:20261114 17:00:00\\tYawFlag:0, PIndex:2\\r\\n';b=b'[I]:20261114 17:00:01\\tYawFlag:1, PIndex:3\\r\\n'
  rows=carve_logs(b'junk\0'+a+b,'20261114')
  self.assertEqual([r['time'] for r in rows],['17:00:00','17:00:01'])
  self.assertEqual([r['offset'] for r in rows],[5,5+len(a)])
  self.assertNotIn('17:00:01',rows[0]['line'])
 def test_truncated_binary_tail_is_not_accepted_as_complete_heap_sample(self):
  raw=b'[I]:20261114 17:00:00\\tfree_heap_size = 1395472/48324/99!\x06\0\x001892\\r\\n'
  self.assertEqual(carve_logs(raw,'20261114'),[])
 def test_duplicate_complete_lines_have_provenance_but_no_duplicate_event(self):
  row=b'[I]:20261114 17:00:00\tYawFlag:0, PIndex:2\r\n'
  data=row+b'\0'*20+row
  recovered=carve_logs(data,'20261114')
  self.assertEqual(len(recovered),2);self.assertEqual(len(unique_lines(recovered)),1)
  self.assertEqual(carve_logs(data,'20261113'),[])
 def test_interleaved_prefix_retains_inner_complete_line(self):
  data=b'[I]:20261114 17:00:00\\tpartial[I]:20261114 17:00:01\\tcomplete\\r\\n'
  self.assertEqual([r['time'] for r in carve_logs(data,'20261114')],['17:00:01'])
if __name__=='__main__':unittest.main()

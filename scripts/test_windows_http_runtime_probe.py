"""Receipt validation only: importing the workload or opening sockets is unnecessary."""
import importlib.util, json, pathlib, unittest
spec = importlib.util.spec_from_file_location('matrix', pathlib.Path(__file__).with_name('run-windows-http-runtime-probe.py'))
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)

class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.value = dict(schemaVersion=1, kind='WINDOWS_HTTP_RUNTIME_PROBE', status='passed', category='COMPLETE', runtime='v24.19.0', platform='win32', architecture='x64', admitted=1000, completed=1000, errors=0, serverClosed=True, socketsClosed=True)
    def raw(self, value):
        return (json.dumps(value, separators=(',', ':')) + '\n').encode('ascii')
    def test_valid_receipt_and_abnormal_empty_exit(self):
        self.assertEqual(matrix.receipt(self.raw(self.value), 0, 'v24.19.0'), self.value)
        self.assertIsNone(matrix.receipt(b'', 3221226505, 'v24.15.0'))
        with self.assertRaises(ValueError): matrix.receipt(b'', 0, 'v24.19.0')
    def test_no_false_pass_or_foreign_identity(self):
        for change in ({'completed': 999}, {'admitted': True}, {'errors': 1}, {'socketsClosed': False}, {'runtime': 'v24.15.0'}, {'private': 'data'}, {'category': 'OTHER'}, {'completed': 20001}):
            with self.assertRaises(ValueError): matrix.receipt(self.raw({**self.value, **change}), 0, 'v24.19.0')
        with self.assertRaises(ValueError): matrix.receipt(self.raw(self.value), 1, 'v24.19.0')
    def test_scalar_duplicate_and_trailing_data_rejected(self):
        for raw in (b'null', b'[]', self.raw(self.value) + b'junk', self.raw(self.value).replace(b'{', b'{"schemaVersion":1,', 1)):
            with self.assertRaises(ValueError): matrix.receipt(raw, 0, 'v24.19.0')

if __name__ == '__main__': unittest.main()

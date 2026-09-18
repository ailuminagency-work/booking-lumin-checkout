"""Explicit two-runtime local diagnostic; importing performs no workload."""
import hashlib, importlib.util, json, os, pathlib, sys, tempfile, uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
BINARIES = (
    (r'C:\Program Files\nodejs\node.exe', '3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5'),
    (r'C:\Users\fligh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe', '3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237'),
)

def receipt(raw, code, version):
    if not raw:
        if code == 0:
            raise ValueError('EMPTY_SUCCESS')
        return None
    value = json.loads(raw)
    expected = {'schemaVersion': 1, 'kind': 'WINDOWS_HTTP_RUNTIME_PROBE', 'runtime': version, 'platform': 'win32', 'architecture': 'x64'}
    keys = set(expected) | {'status', 'category', 'admitted', 'completed', 'errors', 'serverClosed', 'socketsClosed'}
    categories = {'CONFIGURATION_FAILED', 'WATCHDOG_EXPIRED', 'REQUEST_FAILED', 'INSUFFICIENT_COMPLETION', 'COMPLETE', 'RUNTIME_FAILED', 'CLEANUP_UNOBSERVED'}
    if type(value) is not dict or set(value) != keys:
        raise ValueError('RECEIPT_SCHEMA')
    if any(type(value[key]) is not type(want) or value[key] != want for key, want in expected.items()):
        raise ValueError('RECEIPT_IDENTITY')
    if value['status'] not in ('passed', 'failed') or value['category'] not in categories:
        raise ValueError('RECEIPT_ENUM')
    if any(type(value[key]) is not int or not 0 <= value[key] <= 20000 for key in ('admitted', 'completed', 'errors')):
        raise ValueError('RECEIPT_COUNT')
    if any(type(value[key]) is not bool for key in ('serverClosed', 'socketsClosed')):
        raise ValueError('RECEIPT_CLEANUP')
    if value['completed'] > value['admitted']:
        raise ValueError('RECEIPT_COUNT')
    if value['status'] == 'passed' and not (code == 0 and value['category'] == 'COMPLETE' and value['errors'] == 0 and 1000 <= value['completed'] == value['admitted'] and value['serverClosed'] and value['socketsClosed']):
        raise ValueError('FALSE_PASS')
    if code == 0 and value['status'] != 'passed':
        raise ValueError('FALSE_EXIT')
    if raw != (json.dumps(value, separators=(',', ':')) + '\n').encode('ascii'):
        raise ValueError('RECEIPT_ENCODING')
    return value

def main():
    if os.name != 'nt' or os.environ.get('WINDOWS_HTTP_MATRIX_APPROVED') != '1':
        print('{"status":"rejected","category":"CONFIGURATION"}')
        return 1
    spec = importlib.util.spec_from_file_location('custody', ROOT / 'scripts/run-text-draft-tests.py')
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    source = ROOT / 'scripts/windows-http-runtime-probe.mjs'
    digest = hashlib.sha256(base.bounded_read(source, 65536)).hexdigest()
    for binary, expected in BINARIES:
        with open(binary, 'rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest().upper() != expected:
                raise RuntimeError('BINARY_IDENTITY')
    run_id = str(uuid.uuid4())
    private = pathlib.Path(tempfile.gettempdir()) / ('lumin-http-runtime-matrix-' + run_id)
    private.mkdir(mode=0o700, exist_ok=False)
    base.canonical(private, True)
    env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
    env['WINDOWS_HTTP_RUNTIME_PROBE_APPROVED'] = '1'
    evidence, observations = {}, []
    try:
        for index, (binary, binary_hash) in enumerate(BINARIES, 1):
            if hashlib.sha256(base.bounded_read(source, 65536)).hexdigest() != digest:
                raise RuntimeError('SOURCE_CHANGED')
            try:
                code, out, err, completed = base.run_private([binary, str(source)], ROOT, env, private, index, 30, 2048)
            except base.Failure as error:
                if getattr(error, 'artifacts', None) is not None:
                    evidence.update(error.artifacts)
                    base.verify_evidence(private, evidence)
                raise
            evidence.update(completed)
            base.verify_evidence(private, evidence)
            raw = base.bounded_read(out, 2048)
            # Keep raw output private: only a parsed, bounded JSON object can be reported.
            value = receipt(raw, code, ('v24.15.0', 'v24.19.0')[index - 1])
            observations.append({'binarySha256': binary_hash, 'exitCode': code, 'stdoutBytes': len(raw), 'stderrBytes': err.stat().st_size, 'receipt': value})
        if hashlib.sha256(base.bounded_read(source, 65536)).hexdigest() != digest:
            raise RuntimeError('SOURCE_CHANGED')
        base.verify_evidence(private, evidence)
        print(json.dumps({'kind': 'WINDOWS_HTTP_RUNTIME_MATRIX', 'runId': run_id, 'sourceSha256': digest, 'observations': observations}, separators=(',', ':')))
        return 0  # Matrix completion is not a test pass; callers must inspect each child exit.
    except BaseException:
        print(json.dumps({'kind': 'WINDOWS_HTTP_RUNTIME_MATRIX', 'runId': run_id, 'status': 'failed'}, separators=(',', ':')))
        return 1

if __name__ == '__main__':
    try:
        exit_code = main()
    except BaseException:
        print('{"kind":"WINDOWS_HTTP_RUNTIME_MATRIX","status":"failed","category":"SETUP"}')
        exit_code = 1
    sys.exit(exit_code)

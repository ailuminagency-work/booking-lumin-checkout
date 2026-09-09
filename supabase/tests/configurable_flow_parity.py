"""Pure SQL/contract fixture parity. No persistent rows, local DB only."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'packages/workflow/test/fixtures/configurable-publication-v2.json'
if os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1') or not os.environ.get('PGDATABASE'):
    raise SystemExit('Set explicit loopback PGHOST and disposable PGDATABASE')
PSQL = os.environ.get('PSQL') or shutil.which('psql')
if not PSQL:
    raise SystemExit('Set PSQL executable')
f = json.loads(FIXTURE.read_text(encoding='utf-8'))
assert f['contractVersion'] == 2
print('Fixture SHA256', hashlib.sha256(FIXTURE.read_bytes()).hexdigest())

def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"

def call(sql):
    result = subprocess.run([PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, encoding='utf-8', capture_output=True, check=True)
    return json.loads(result.stdout.strip())

def normalize(catalog, authoring):
    return call('select lumin.normalize_configurable_publication(' + literal(catalog) + ',' + literal(authoring) + ');')

n = normalize(f['catalog'], f['authoring'])
assert n['authoring'] == f['authoring']
questions = {q['id']: q for q in n['snapshot']['service']['questions']}
assert {k: q['prompt'] for k,q in questions.items()} == f['effective']['prompts']
assert questions['mode']['choices'][1]['label'] == f['effective']['extraLabel']
assert [questions['count']['minQty'], questions['count']['maxQty']] == f['effective']['countBounds']
assert questions['count']['required'] is False  # Step strengthens optional floor.
checks = 1

def answer_case(snapshot, case):
    global checks
    sql = """begin; create function pg_temp.attempt(s jsonb,a jsonb) returns jsonb language plpgsql as $$ begin return jsonb_build_object('normalized',lumin.validate_configurable_answers(s,a)); exception when others then return jsonb_build_object('error',sqlerrm); end $$; select pg_temp.attempt(""" + literal(snapshot) + ',' + literal(case['answers']) + '); rollback;'
    got = call(sql)
    wanted = {key:case[key] for key in ('normalized','error') if key in case}
    assert got == wanted, (case['name'], got, wanted)
    checks += 1

for case in f['cases']:
    answer_case(n['snapshot'], case)
a = copy.deepcopy(f['authoring'])
a['config']['steps'][2]['visibleWhen'] = {'field':'tags','op':'includes','value':'b'}
for case in f['includesCases']:
    answer_case(normalize(f['catalog'], a)['snapshot'], case)
c = copy.deepcopy(f['catalog'])
c['questions'][1]['choices'] = [{'id':x,'label':x} for x in f['unicodeChoiceOrder']['catalog']]
snap = normalize(c, f['authoring'])['snapshot']
answer_case(snap, {'name':'Unicode catalog ordinal', 'answers':{'mode':{'choiceIds':['basic']},'tags':{'choiceIds':f['unicodeChoiceOrder']['input']}}, 'normalized':{'mode':{'choiceIds':['basic']},'tags':{'choiceIds':f['unicodeChoiceOrder']['normalized']}}})
for boundary in f['utf16Boundaries']:
    for valid, key in ((True,'validRepeat'),(False,'invalidRepeat')):
        a = copy.deepcopy(f['authoring'])
        text = boundary['character'] * boundary[key]
        if boundary['target']=='prompt': a['questionOverrides']['mode']['prompt'] = text
        else: a['questionOverrides']['mode']['choiceLabels']['extra'] = text
        try:
            normalize(f['catalog'], a)
        except subprocess.CalledProcessError as error:
            assert not valid and 'INVALID_CONFIG' in error.stderr, error.stderr
        else:
            assert valid, boundary
        checks += 1
# Additional bounds/dependency attacks, beyond fixture cases.
for mutate, error in [
    (lambda a:a['config']['steps'][0].update(visibleWhen={'field':'tags','op':'includes','value':'a'}),'REQUIRED_FLOOR'),
    (lambda a:a['config']['steps'][2]['visibleWhen'].update(field='count'),'INVALID_DEPENDENCY'),
    (lambda a:a['questionOverrides']['count'].update(minQty=0),'INVALID_OVERRIDE'),
    (lambda a:a['questionOverrides'].update({'__proto__':{}}),'INVALID_CONFIG'),
    (lambda a:a.update(unknown=True),'INVALID_CONFIG'),
    (lambda a:a['config']['steps'][2]['visibleWhen'].update(value=1),'INVALID_CONFIG'),
]:
    a = copy.deepcopy(f['authoring']); mutate(a)
    try: normalize(f['catalog'], a)
    except subprocess.CalledProcessError as e: assert error in e.stderr, e.stderr
    else: raise AssertionError(error)
    checks += 1
# JSON numeric lexical forms must match parsed JS numbers.
raw = literal(f['catalog']).replace('"durationMinutes": 60', '"durationMinutes": 60.0').replace('"minQty": 1', '"minQty": 1.0')
assert call('select lumin.normalize_configurable_publication(' + raw + ',' + literal(f['authoring']) + ');') == n
checks += 1
print(f'CONFIGURABLE SQL PARITY PASS: {checks} cases')

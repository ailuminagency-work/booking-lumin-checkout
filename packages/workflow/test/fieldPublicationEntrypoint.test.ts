import { expect, it } from 'vitest';
import { parseFieldPublicationV1, snapshotFieldPublicationV1 } from '../src/index';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function source() {
  return {
    tenantId, flowId, versionId, expectedParentRevision: 7,
    expectedFieldDraftRevision: 3,
    source: { tenantId, flowId, receipt: {
      fieldDraftVersion: 3, parentAuthoringVersion: 2, draftRevision: 3,
      savedParentRevision: 7, currentParentRevision: 7, runtimePublishable: false,
      definition: { schemaVersion: 3, fields: [{
        key: 'choice', kind: 'dropdown', required: true, prompt: ' Choose ',
        choices: [{ id: 'second', label: ' Same ' }, { id: 'first', label: ' Same ' }],
      }] },
    } },
  };
}

it('publishes only a detached unconfirmed request through the package entrypoint', () => {
  const input = source();
  const publication = snapshotFieldPublicationV1(input);
  expect(publication).toMatchObject({
    fieldPublicationVersion: 1, tenantId, flowId, versionId,
    parentAuthoringVersion: 2, sourceParentRevision: 7,
    sourceFieldDraftRevision: 3, submissionMode: 'unconfirmed_request',
  });
  expect(Object.keys(publication).sort()).toEqual([
    'definition', 'fieldPublicationVersion', 'flowId', 'parentAuthoringVersion',
    'sourceFieldDraftRevision', 'sourceParentRevision', 'submissionMode',
    'tenantId', 'versionId',
  ]);
  expect(Object.isFrozen(publication.definition.fields[0])).toBe(true);
  input.source.receipt.definition.fields[0]!.choices[0]!.label = 'Changed';
  expect(publication.definition.fields[0]).toMatchObject({
    choices: [{ id: 'second', label: ' Same ' }, { id: 'first', label: ' Same ' }],
  });
  expect(parseFieldPublicationV1(publication)).toEqual(publication);
});

it('keeps stale or cross-tenant receipts outside the public snapshot boundary', () => {
  const stale = source();
  stale.source.receipt.currentParentRevision = 8;
  expect(() => snapshotFieldPublicationV1(stale)).toThrow('INVALID_FIELD_PUBLICATION_SNAPSHOT_V1_CONTRACT');

  const foreign = source();
  foreign.source.tenantId = versionId;
  expect(() => snapshotFieldPublicationV1(foreign)).toThrow('INVALID_FIELD_PUBLICATION_SNAPSHOT_V1_CONTRACT');
});

it('rejects booking authority added to the public publication envelope', () => {
  const publication = snapshotFieldPublicationV1(source());
  expect(() => parseFieldPublicationV1({ ...publication, submissionMode: 'confirmed_booking' }))
    .toThrow('INVALID_FIELD_PUBLICATION_V1_CONTRACT');
  expect(() => parseFieldPublicationV1({ ...publication, runtimePublishable: true }))
    .toThrow('INVALID_FIELD_PUBLICATION_V1_CONTRACT');
});

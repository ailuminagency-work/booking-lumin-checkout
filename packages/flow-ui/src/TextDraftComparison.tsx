import { compareTextFields } from '../../workflow/src/textFieldComparison';

type Entry = ReturnType<typeof compareTextFields>[number];
function Version({ field, index }: { field: Entry['local']; index: number | undefined }) {
  if (!field || index === undefined) return <p>Not in this version.</p>;
  return <div>
    <p>Question {index + 1}</p>
    {field.prompt === undefined ? <p>Label not provided.</p> : <p>Label: <span style={{ whiteSpace: 'pre-wrap' }}>{field.prompt}</span></p>}
    <dl>
      <dt>Answer required</dt><dd>{field.required ? 'Yes' : 'No'}</dd>
      <dt>Minimum characters</dt><dd>{field.minLength}</dd>
      <dt>Maximum characters</dt><dd>{field.maxLength}</dd>
    </dl>
  </div>;
}

/** Read-only comparison of supplied snapshots. No reconciliation or persistence. */
export function TextDraftComparison({ localDefinition, savedDefinition }: { localDefinition: unknown; savedDefinition: unknown }) {
  let entries: ReturnType<typeof compareTextFields>;
  try { entries = compareTextFields(localDefinition, savedDefinition); }
  catch { return <section aria-label="Question comparison"><p role="alert">Question comparison is unavailable.</p></section>; }
  return <section aria-label="Question comparison">
    <h2>Question comparison</h2>
    <p>The saved version is the fetched snapshot. It may have changed since it was fetched. This comparison does not merge or save changes.</p>
    <table>
      <caption>Text question differences</caption>
      <thead><tr><th scope="col">Difference</th><th scope="col">Your edits</th><th scope="col">Saved version</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.key}>
        <th scope="row">{entry.status === 'added' ? 'Added in your edits' : entry.status === 'removed' ? 'Removed in your edits' : entry.status === 'changed' ? 'Question settings changed' : 'Question settings unchanged'}{entry.reordered && <p>Question order changed.</p>}</th>
        <td><Version field={entry.local} index={entry.localIndex} /></td>
        <td><Version field={entry.saved} index={entry.savedIndex} /></td>
      </tr>)}</tbody>
    </table>
    {entries.length === 0 && <p>Neither version has text questions.</p>}
  </section>;
}

import { parseTextFieldDocument, type TextField } from './fieldAnswers';
export interface TextFieldComparisonEntry {
  readonly key: string;
  readonly local?: TextField;
  readonly saved?: TextField;
  readonly localIndex?: number;
  readonly savedIndex?: number;
  readonly status: 'added' | 'removed' | 'changed' | 'unchanged';
  readonly reordered: boolean;
}
/** Local-only fields are added; saved-only fields are removed. Entries follow local
 * order, then removed fields in saved order. Index movement is independent from
 * metadata changes, including movement caused by another field's insertion/removal.
 * This is a read-only comparison, never a merge, revision or authorization decision.
 */
export function compareTextFields(local: unknown, saved: unknown): readonly TextFieldComparisonEntry[] {
  const left = parseTextFieldDocument(local).fields;
  const right = parseTextFieldDocument(saved).fields;
  const savedByKey = new Map(right.map((field,index)=>[field.key,{field,index}]));
  const localKeys = new Set(left.map(field=>field.key));
  const entries: TextFieldComparisonEntry[] = left.map((field,index) => {
    const other = savedByKey.get(field.key);
    if (!other) return Object.freeze({key:field.key,local:field,localIndex:index,status:'added' as const,reordered:false});
    const previous = other.field;
    const same = field.kind === previous.kind && field.required === previous.required && field.minLength === previous.minLength && field.maxLength === previous.maxLength
      && Object.hasOwn(field,'prompt') === Object.hasOwn(previous,'prompt') && field.prompt === previous.prompt;
    return Object.freeze({key:field.key,local:field,saved:previous,localIndex:index,savedIndex:other.index,status:same?'unchanged' as const:'changed' as const,reordered:index!==other.index});
  });
  right.forEach((field,index)=>{
    if(!localKeys.has(field.key))entries.push(Object.freeze({key:field.key,saved:field,savedIndex:index,status:'removed' as const,reordered:false}));
  });
  return Object.freeze(entries);
}

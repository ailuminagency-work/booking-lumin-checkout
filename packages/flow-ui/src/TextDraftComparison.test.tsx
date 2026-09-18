// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TextDraftComparison } from './TextDraftComparison';
const field = (key: string, extra = {}) => ({ key, kind: 'text', required: false, minLength: 0, maxLength: 50, ...extra });
const document = (...fields: unknown[]) => ({ schemaVersion: 1, fields });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows added, removed and changed settings using positions without internal keys', () => {
 const { container } = render(<TextDraftComparison localDefinition={document(field('stable_key', { prompt: 'New label', required: true, minLength: 2, maxLength: 20 }), field('added_key'))} savedDefinition={document(field('stable_key', { prompt: 'Old label' }), field('removed_key'))} />);
 expect(screen.getByRole('columnheader', { name: 'Your edits' })).toBeTruthy(); expect(screen.getByRole('columnheader', { name: 'Saved version' })).toBeTruthy();
 expect(screen.getByText('Question settings changed')).toBeTruthy(); expect(screen.getByText('Added in your edits')).toBeTruthy(); expect(screen.getByText('Removed in your edits')).toBeTruthy();
 for (const key of ['stable_key', 'added_key', 'removed_key']) expect(container.textContent).not.toContain(key);
 const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell');
 expect(cells[0]!.textContent).toContain('Answer requiredYesMinimum characters2Maximum characters20');
 expect(cells[1]!.textContent).toContain('Answer requiredNoMinimum characters0Maximum characters50');
});
it('keeps duplicate labels associated by stable key and shows order-only changes', () => {
 const a = field('a', { prompt: 'Same label', maxLength: 11 }), b = field('b', { prompt: 'Same label', maxLength: 22 });
 render(<TextDraftComparison localDefinition={document(b, a)} savedDefinition={document(a, b)} />);
 expect(screen.getAllByText('Question settings unchanged')).toHaveLength(2); expect(screen.getAllByText('Question order changed.')).toHaveLength(2);
 const first = within(screen.getAllByRole('row')[1]!).getAllByRole('cell');
 expect(first[0]!.textContent).toContain('Question 1'); expect(first[1]!.textContent).toContain('Question 2');
 expect(first[0]!.textContent).toContain('Maximum characters22'); expect(first[1]!.textContent).toContain('Maximum characters22');
});
it('preserves exact whitespace and Unicode labels and distinguishes missing labels', () => {
 const prompt = '  Label \u{1f30d} e\u0301  ';
 render(<TextDraftComparison localDefinition={document(field('a', { prompt }))} savedDefinition={document(field('a'))} />);
 const span = screen.getByText((_, node) => node?.tagName === 'SPAN' && node.textContent === prompt);
 expect(span.textContent).toBe(prompt); expect(span.style.whiteSpace).toBe('pre-wrap'); expect(screen.getByText('Label not provided.')).toBeTruthy();
});
it('escapes markup, exposes no form controls and performs no fetch', () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const label = '<img src=x onerror=alert(1)>';
 const view = render(<TextDraftComparison localDefinition={document(field('a', { prompt: label }))} savedDefinition={document(field('a', { prompt: label }))} />);
 expect(view.container.querySelector('img,script,input,button,select,textarea,form')).toBeNull(); expect(screen.getAllByText(label)).toHaveLength(2); expect(fetch).not.toHaveBeenCalled();
 expect(screen.getByText(/fetched snapshot/)).toBeTruthy();
});
it.each([null, { schemaVersion: 1, fields: [field('a'), field('a')] }, { schemaVersion: 1, fields: [field('a', { extra: true })] }])('fails closed without showing a partial comparison for invalid input', invalid => {
 render(<TextDraftComparison localDefinition={invalid} savedDefinition={document(field('a'))} />);
 expect(screen.getByRole('alert').textContent).toBe('Question comparison is unavailable.'); expect(screen.queryByRole('table')).toBeNull();
});
it('does not execute hostile getters and removes previous content on invalid replacement', () => {
 const getter = vi.fn(() => []), invalid = Object.defineProperty({ schemaVersion: 1 }, 'fields', { enumerable: true, get: getter });
 const view = render(<TextDraftComparison localDefinition={document(field('a', { prompt: 'Prior label' }))} savedDefinition={document()} />);
 view.rerender(<TextDraftComparison localDefinition={document()} savedDefinition={invalid} />);
 expect(getter).not.toHaveBeenCalled(); expect(screen.queryByText('Prior label')).toBeNull(); expect(screen.getByRole('alert')).toBeTruthy();
});

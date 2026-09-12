import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ModeRequestHistory } from './ModeRequestHistory';
import { createModeOwnerClient } from '../../../../packages/flow-ui/src/modeOwnerClient';
const tenant = '11111111-1111-4111-8111-111111111111', time = '2026-09-10T12:00:00.123456Z';
const initial = { schemaVersion: 1 as const, requests: [{ bookingId: tenant, reference: 'LMN-TEST', state: 'completed' as const, slotStart: time, createdAt: time }], nextCursor: { createdAt: time, bookingId: tenant } };
afterEach(cleanup);
it('keeps exact microsecond cursor and current completed state; failed read retains page', async () => { const fetcher = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response('lost')); const client = createModeOwnerClient('http://127.0.0.1:8787', fetcher); render(<ModeRequestHistory client={client} token="synthetic-owner-credential" tenant={tenant} initial={initial}/>); expect(screen.getByText(/completed/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Next requests' })); await screen.findByRole('alert'); expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).beforeCreatedAt).toBe(time); expect(screen.getByText(/LMN-TEST/)).toBeTruthy(); expect(screen.queryByText('No requests found.')).toBeNull(); });

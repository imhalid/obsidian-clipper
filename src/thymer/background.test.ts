import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushThymerQueue, saveToThymer } from './background';
import { ThymerToolError, ThymerUnreachableError } from './client';

// vi.mock is hoisted above the imports, so the state it uses must be hoisted too
const { storage, alarms, save } = vi.hoisted(() => ({
	storage: {} as Record<string, unknown>,
	alarms: new Set<string>(),
	save: vi.fn(),
}));

vi.mock('../utils/browser-polyfill', () => ({
	default: {
		storage: {
			local: {
				get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
				set: async (values: Record<string, unknown>) => { Object.assign(storage, values); },
			},
		},
		alarms: {
			create: (name: string) => { alarms.add(name); },
			clear: async (name: string) => alarms.delete(name),
			onAlarm: { addListener: () => {} },
		},
	},
}));

vi.mock('./save', () => ({
	ThymerSaver: class {
		save = save;
	},
}));

const clip = (title: string) => ({
	title, collection: 'Clips', workspace: '', behavior: 'create' as const,
	properties: [], content: title, url: `https://e.com/${title}`, open: true,
});

beforeEach(() => {
	for (const key of Object.keys(storage)) {
		delete storage[key];
	}
	alarms.clear();
	save.mockReset();
});

describe('saveToThymer', () => {
	test('keeps a clip while Thymer is closed and saves it once Thymer answers', async () => {
		save.mockRejectedValue(new ThymerUnreachableError());
		const offline = await saveToThymer(clip('first'));
		expect(offline).toEqual({ success: false, queued: true, error: expect.any(String) });
		expect(storage.thymerQueue).toHaveLength(1);
		expect(alarms.has('thymerQueueRetry')).toBe(true);

		save.mockResolvedValue({ workspace: 'W', recordGuid: 'R', appendedToExisting: false, warnings: [] });
		const online = await saveToThymer(clip('second'));
		expect(online.success).toBe(true);
		// The queued clip went in first, without opening it in Thymer
		expect(save.mock.calls.map(([saved]) => [saved.title, saved.open])).toEqual([
			['first', true], ['first', false], ['second', true],
		]);
		expect(storage.thymerQueue).toEqual([]);
		expect(alarms.has('thymerQueueRetry')).toBe(false);
	});

	test('does not queue a clip that Thymer refused', async () => {
		save.mockRejectedValue(new ThymerToolError('create_record', 'Collection not found'));
		const response = await saveToThymer(clip('bad'));
		expect(response).toEqual({ success: false, queued: false, error: 'create_record: Collection not found' });
		expect(storage.thymerQueue).toBeUndefined();
	});

	test('drops a queued clip that Thymer refuses, keeps the rest', async () => {
		storage.thymerQueue = [clip('refused'), clip('kept')];
		save
			.mockRejectedValueOnce(new ThymerToolError('create_record', 'bad value'))
			.mockRejectedValueOnce(new ThymerUnreachableError());
		await flushThymerQueue();
		expect((storage.thymerQueue as { title: string }[]).map(queued => queued.title)).toEqual(['kept']);
	});
});

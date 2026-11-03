import { beforeEach, describe, expect, test, vi } from 'vitest';
import { refreshThymerDirectory } from './directory';

const { storage } = vi.hoisted(() => ({ storage: {} as Record<string, unknown> }));

vi.mock('../utils/browser-polyfill', () => ({
	default: {
		storage: {
			local: {
				get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
				set: async (values: Record<string, unknown>) => { Object.assign(storage, values); },
			},
		},
	},
}));

const WORKSPACES = [
	{ guid: 'W1', name: 'almasada', is_focused: true, mcp_access: 'readwrite' },
	{ guid: 'W2', name: 'Off', is_focused: false, mcp_access: 'off' },
];
const COLLECTIONS = [
	{ name: 'Notes', type: 'collection' },
	{ name: 'Journal', type: 'collection' },
	{ name: 'Toolbox', type: 'global_plugin' },
	{ name: 'Bookmarks', type: 'collection' },
];

/** A bridge that answers each tool with the given result. */
function bridge(results: Record<string, unknown>) {
	return vi.fn(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		const result = body.method === 'tools/call'
			? { content: [{ type: 'text', text: JSON.stringify(results[body.params.name]) }] }
			: {};
		return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
			headers: { 'Mcp-Session-Id': 'S' },
		});
	});
}

beforeEach(() => {
	for (const key of Object.keys(storage)) {
		delete storage[key];
	}
	vi.unstubAllGlobals();
});

describe('refreshThymerDirectory', () => {
	test('reads the workspaces and their collections, and keeps them', async () => {
		vi.stubGlobal('fetch', bridge({ list_workspaces: { workspaces: WORKSPACES }, list_collections: { collections: COLLECTIONS } }));
		const directory = await refreshThymerDirectory();
		expect(directory.connected).toBe(true);
		expect(directory.workspaces.map(ws => [ws.name, ws.access])).toEqual([['almasada', 'readwrite'], ['Off', 'off']]);
		// No journal or global plugins, sorted; a workspace closed to MCP is not asked
		expect(directory.collections).toEqual({ W1: ['Bookmarks', 'Notes'] });
		expect(storage.thymerDirectory).toMatchObject({ connected: false, collections: { W1: ['Bookmarks', 'Notes'] } });
	});

	test('answers with the kept lists while Thymer is closed', async () => {
		vi.stubGlobal('fetch', bridge({ list_workspaces: { workspaces: WORKSPACES }, list_collections: { collections: COLLECTIONS } }));
		const online = await refreshThymerDirectory();

		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		const offline = await refreshThymerDirectory();
		expect(offline).toEqual({ ...online, connected: false });
	});

	test('has empty lists when Thymer never answered', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		expect(await refreshThymerDirectory()).toEqual({ connected: false, updatedAt: null, workspaces: [], collections: {} });
	});
});

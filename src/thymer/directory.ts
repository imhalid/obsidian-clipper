// The workspaces and collections open in Thymer, for the workspace and collection
// fields. They are read from the bridge each time they are asked for, and the last
// answer is kept in local storage so the fields still have them while Thymer is closed.

import browser from '../utils/browser-polyfill';
import { ThymerClient, ThymerUnreachableError } from './client';

const DIRECTORY_KEY = 'thymerDirectory';

export interface ThymerWorkspace {
	guid: string;
	name: string;
	focused: boolean;
	/** "readwrite", "readonly" or "off", as set in Thymer's MCP settings */
	access: string;
}

export interface ThymerDirectory {
	/** The bridge answered this time */
	connected: boolean;
	/** When the lists were last read from Thymer (ms), null if never */
	updatedAt: number | null;
	workspaces: ThymerWorkspace[];
	/** Collection names by workspace guid */
	collections: Record<string, string[]>;
}

const EMPTY: ThymerDirectory = { connected: false, updatedAt: null, workspaces: [], collections: {} };

const client = new ThymerClient(undefined, 5000);

export async function getCachedThymerDirectory(): Promise<ThymerDirectory> {
	const stored = await browser.storage.local.get(DIRECTORY_KEY);
	return { ...EMPTY, ...(stored[DIRECTORY_KEY] as Partial<ThymerDirectory> | undefined), connected: false };
}

/** Read the lists from Thymer; when it does not answer, return the kept ones. */
export async function refreshThymerDirectory(): Promise<ThymerDirectory> {
	const cached = await getCachedThymerDirectory();
	try {
		const { workspaces } = await client.call<{
			workspaces: { guid: string; name: string; is_focused: boolean; mcp_access: string }[];
		}>('list_workspaces', {});
		const directory: ThymerDirectory = {
			connected: true,
			updatedAt: Date.now(),
			workspaces: workspaces.map(ws => ({ guid: ws.guid, name: ws.name, focused: ws.is_focused, access: ws.mcp_access })),
			collections: {},
		};
		for (const workspace of directory.workspaces) {
			if (workspace.access === 'off') {
				continue;
			}
			try {
				const { collections } = await client.call<{ collections: { name: string; type: string }[] }>(
					'list_collections', { workspace: workspace.guid });
				directory.collections[workspace.guid] = collections
					// Global plugins hold no records, and a journal takes none from outside
					.filter(collection => collection.type === 'collection' && !/^journal$/i.test(collection.name))
					.map(collection => collection.name)
					.sort((a, b) => a.localeCompare(b));
			} catch (error) {
				if (error instanceof ThymerUnreachableError) {
					throw error;
				}
				directory.collections[workspace.guid] = cached.collections[workspace.guid] || [];
			}
		}
		await browser.storage.local.set({ [DIRECTORY_KEY]: { ...directory, connected: false } });
		return directory;
	} catch (error) {
		if (!(error instanceof ThymerUnreachableError)) {
			console.warn('[Thymer] Could not read workspaces and collections:', error);
		}
		return cached;
	}
}

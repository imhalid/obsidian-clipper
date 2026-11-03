// Saves a clip into Thymer through the desktop app's MCP bridge.
//
// Obsidian's notions map onto Thymer like this:
// - vault    -> workspace (name or guid; empty means the workspace focused in Thymer)
// - path     -> collection (created with the Clips fields when it does not exist)
// - note     -> record, its frontmatter -> the record's properties
// - daily    -> today's journal page

import dayjs from 'dayjs';
import { Template } from '../types/types';
import { ThymerClient, ThymerToolError } from './client';
import { HIGHLIGHT_START, Segment, hasHighlightMarks, toThymerMarkdown, underlineHighlights } from './markdown';

export const DEFAULT_COLLECTION = 'Clips';

export interface ThymerClipProperty {
	name: string;
	value: string;
	/** The clipper's property type: text, multitext, number, checkbox, date or datetime */
	type: string;
}

export interface ThymerClip {
	title: string;
	collection: string;
	workspace: string;
	behavior: Template['behavior'];
	properties: ThymerClipProperty[];
	content: string;
	url: string;
	/** Picture for the record's banner, usually the page's og:image */
	image?: string;
	/** Show the record in Thymer once it is saved */
	open: boolean;
}

export interface ThymerSaveResult {
	workspace: string;
	recordGuid: string;
	/** The page had been clipped before: the new clip went under the existing record */
	appendedToExisting: boolean;
	/** Things that did not make it (a property value Thymer refused, the banner, ...) */
	warnings: string[];
}

interface CollectionField {
	id: string;
	label: string;
	type: string;
	many?: boolean;
}

// The fields a new Clips collection gets, and the template properties that fill them
const CLIP_FIELDS: { label: string; type: string; icon: string; many?: boolean; aliases: string[] }[] = [
	{ label: 'URL', type: 'url', icon: 'ti-link', aliases: ['url', 'source', 'link'] },
	{ label: 'Site', type: 'text', icon: 'ti-world', aliases: ['site', 'domain'] },
	{ label: 'Author', type: 'text', icon: 'ti-user', many: true, aliases: ['author', 'authors'] },
	{ label: 'Published', type: 'datetime', icon: 'ti-calendar', aliases: ['published', 'date'] },
	{ label: 'Description', type: 'text', icon: 'ti-align-left', aliases: ['description', 'summary'] },
	{ label: 'Tags', type: 'text', icon: 'ti-tags', many: true, aliases: ['tags', 'tag'] },
];

// Template properties Thymer keeps on every record by itself
const BUILT_IN_PROPERTIES = ['title', 'created'];

const MAX_BANNER_BYTES = 10 * 1024 * 1024;

function splitList(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.map(String).map(item => item.trim()).filter(Boolean);
			}
		} catch {
			// not JSON, split it below
		}
	}
	return trimmed.split(/,(?![^\[]*\]\])/).map(item => item.trim()).filter(Boolean);
}

function fieldValue(field: CollectionField, property: ThymerClipProperty): string | number | string[] | null {
	const value = property.value.trim();
	if (!value) {
		return null;
	}
	if (field.many || property.type === 'multitext') {
		const items = splitList(value);
		return field.many ? items : items.join(', ');
	}
	if (field.type === 'number') {
		const number = parseFloat(value.replace(/[^\d.-]/g, ''));
		return isNaN(number) ? null : number;
	}
	if (field.type === 'datetime') {
		const date = dayjs(value);
		if (!date.isValid()) {
			return value;
		}
		const hasTime = property.type === 'datetime' && /\d{1,2}:\d{2}/.test(value);
		return date.format(hasTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
	}
	return value;
}

function newFieldFor(property: ThymerClipProperty): { type: string; many: boolean } {
	switch (property.type) {
		case 'number': return { type: 'number', many: false };
		case 'date':
		case 'datetime': return { type: 'datetime', many: false };
		case 'multitext': return { type: 'text', many: true };
		default: return { type: 'text', many: false };
	}
}

export class ThymerSaver {
	private warnings: string[] = [];

	constructor(private client: ThymerClient = new ThymerClient()) {}

	async save(clip: ThymerClip): Promise<ThymerSaveResult> {
		this.warnings = [];
		const workspace = await this.resolveWorkspace(clip.workspace);
		const markdown = toThymerMarkdown(clip.content);

		let recordGuid: string;
		let appendedToExisting = false;

		if (clip.behavior === 'append-daily' || clip.behavior === 'prepend-daily') {
			const journal = await this.client.call<{ guid: string }>('get_journal_page', { workspace, format: 'markdown' });
			recordGuid = journal.guid;
			await this.insert(workspace, recordGuid, markdown, clip.behavior === 'prepend-daily');
		} else {
			const collection = clip.collection.trim() || DEFAULT_COLLECTION;
			const fields = await this.ensureCollection(workspace, collection);
			const properties = await this.buildProperties(workspace, collection, fields, clip.properties);
			const title = clip.title.trim() || clip.url;

			let existing: string | null = null;
			if (clip.behavior === 'create') {
				existing = await this.findByUrl(workspace, collection, fields, clip.url);
			} else {
				existing = await this.findByTitle(workspace, collection, title);
			}

			if (existing) {
				recordGuid = existing;
				if (clip.behavior === 'overwrite') {
					await this.clearRecord(workspace, recordGuid);
					await this.insert(workspace, recordGuid, markdown, false);
				} else {
					const prepend = clip.behavior === 'prepend-specific';
					const separated = prepend ? `${markdown}\n---` : `---\n${markdown}`;
					await this.insert(workspace, recordGuid, separated, prepend);
					appendedToExisting = clip.behavior === 'create';
				}
				await this.setProperties(workspace, recordGuid, properties);
			} else {
				recordGuid = await this.createRecord(workspace, collection, title, properties);
				await this.insert(workspace, recordGuid, markdown, false);
				if (clip.image) {
					await this.setBanner(workspace, recordGuid, clip.image);
				}
			}
		}

		if (clip.open) {
			await this.client.call('navigate_to_record', { workspace, record: recordGuid })
				.catch(error => this.warn(`Could not open the record in Thymer: ${error.message}`));
		}

		return { workspace, recordGuid, appendedToExisting, warnings: this.warnings };
	}

	private warn(message: string): void {
		console.warn('[Thymer]', message);
		this.warnings.push(message);
	}

	private async resolveWorkspace(nameOrGuid: string): Promise<string> {
		const { workspaces, active_workspace_guid } = await this.client.call<{
			workspaces: { guid: string; name: string; is_focused: boolean; mcp_access: string }[];
			active_workspace_guid: string | null;
		}>('list_workspaces', {});
		const wanted = nameOrGuid.trim().toLowerCase();
		const workspace = wanted
			? workspaces.find(ws => ws.guid.toLowerCase() === wanted || ws.name.toLowerCase() === wanted)
			: workspaces.find(ws => ws.guid === active_workspace_guid) || workspaces.find(ws => ws.is_focused) || workspaces[0];
		if (!workspace) {
			throw new ThymerToolError('list_workspaces', wanted
				? `No workspace called "${nameOrGuid}" is open in Thymer`
				: 'No workspace is open in Thymer');
		}
		if (workspace.mcp_access !== 'readwrite') {
			throw new ThymerToolError('list_workspaces',
				`MCP access to "${workspace.name}" is "${workspace.mcp_access}"; set it to read & write in Thymer's MCP settings`);
		}
		return workspace.guid;
	}

	private async getFields(workspace: string, collection: string): Promise<CollectionField[]> {
		// The config has each field's "many"; get_collection_schema leaves it out
		const { config } = await this.client.call<{ config: { fields?: (CollectionField & { active?: boolean })[] } }>(
			'get_collection_config_json', { workspace, collection });
		return (config.fields || []).filter(field => field.active !== false);
	}

	/** Find the collection, or create it with the Clips fields. Returns its fields. */
	private async ensureCollection(workspace: string, name: string): Promise<CollectionField[]> {
		const { collections } = await this.client.call<{ collections: { guid: string; name: string }[] }>(
			'list_collections', { workspace });
		const found = collections.find(collection => collection.name.toLowerCase() === name.toLowerCase());
		if (found) {
			return this.getFields(workspace, found.guid);
		}
		await this.client.call('create_collection', {
			workspace,
			name,
			icon: 'ti-scissors',
			description: 'Pages saved from the web',
		});
		for (const field of CLIP_FIELDS) {
			await this.client.call('add_property_to_collection', {
				workspace, collection: name, label: field.label, type: field.type, icon: field.icon, many: !!field.many,
			});
		}
		return this.getFields(workspace, name);
	}

	/**
	 * Match the template's properties to the collection's fields by label, or by the
	 * Clips aliases ("source" fills URL). A property with no field gets a new one, the
	 * way Obsidian takes any frontmatter key.
	 */
	private async buildProperties(
		workspace: string, collection: string, fields: CollectionField[], properties: ThymerClipProperty[],
	): Promise<Record<string, unknown>> {
		const values: Record<string, unknown> = {};
		for (const property of properties) {
			const name = property.name.trim();
			if (!name || BUILT_IN_PROPERTIES.includes(name.toLowerCase()) || !String(property.value ?? '').trim()) {
				continue;
			}
			const lower = name.toLowerCase();
			const alias = CLIP_FIELDS.find(field => field.aliases.includes(lower));
			let field = fields.find(f => f.label.toLowerCase() === lower)
				|| (alias && fields.find(f => f.label.toLowerCase() === alias.label.toLowerCase()));
			if (!field) {
				const { type, many } = newFieldFor(property);
				try {
					await this.client.call('add_property_to_collection', { workspace, collection, label: name, type, many });
					field = { id: name, label: name, type, many };
					fields.push(field);
				} catch (error) {
					this.warn(`Could not add a "${name}" field to ${collection}: ${(error as Error).message}`);
					continue;
				}
			}
			const value = fieldValue(field, { ...property, value: String(property.value) });
			if (value !== null && !(Array.isArray(value) && value.length === 0)) {
				values[field.label] = value;
			}
		}
		return values;
	}

	private async createRecord(workspace: string, collection: string, title: string, properties: Record<string, unknown>): Promise<string> {
		const remaining = { ...properties };
		// Thymer refuses the whole record when one value does not parse; drop that one and retry
		for (;;) {
			try {
				const result = await this.client.call<{ guid: string }>('create_record', {
					workspace, collection, title, properties: remaining,
				});
				return result.guid;
			} catch (error) {
				const refused = (error as Error).message.match(/\(property "([^"]+)"\)/)?.[1];
				if (!(error instanceof ThymerToolError) || !refused || !(refused in remaining)) {
					throw error;
				}
				this.warn(`${refused} was left out: ${error.message}`);
				delete remaining[refused];
			}
		}
	}

	private async setProperties(workspace: string, record: string, properties: Record<string, unknown>): Promise<void> {
		for (const [property, value] of Object.entries(properties)) {
			await this.client.call('update_record_property', { workspace, record, property, value })
				.catch(error => this.warn(`${property} was not updated: ${error.message}`));
		}
	}

	private async findByUrl(workspace: string, collection: string, fields: CollectionField[], url: string): Promise<string | null> {
		const urlField = fields.find(field => field.type === 'url');
		if (!url || !urlField) {
			return null;
		}
		// An "eq" filter compares the stored value, which is ["url", "<link>"], so it never
		// matches a plain string; "contains" finds candidates, and the exact link is checked here
		const { records } = await this.client.call<{ records: { guid: string }[] }>('query_records', {
			workspace, collection, filters: { [urlField.label]: { op: 'contains', value: url } }, limit: 20,
		});
		for (const record of records) {
			const { properties } = await this.client.call<{ properties: Record<string, { id: string; value?: unknown[] | null }> }>(
				'get_record_properties', { workspace, record: record.guid });
			const stored = Object.values(properties).find(property => property.id === urlField.id)?.value;
			if (Array.isArray(stored) && stored.slice(1).includes(url)) {
				return record.guid;
			}
		}
		return null;
	}

	private async findByTitle(workspace: string, collection: string, title: string): Promise<string | null> {
		const { records } = await this.client.call<{ records: { guid: string; name: string }[] }>('query_records', {
			workspace, collection, query: title, limit: 50,
		});
		return records.find(record => record.name.trim().toLowerCase() === title.toLowerCase())?.guid || null;
	}

	private async clearRecord(workspace: string, record: string): Promise<void> {
		const items = await this.client.call<{ items?: { guid: string; parent_guid: string | null }[] } | { guid: string; parent_guid: string | null }[]>(
			'get_line_items', { workspace, record });
		const list = Array.isArray(items) ? items : items.items || [];
		for (const item of list.filter(item => !item.parent_guid || item.parent_guid === record)) {
			await this.client.call('trash_line_item', { workspace, line_item: item.guid });
		}
	}

	/**
	 * insert_markdown always adds after the last line, so prepending goes through a
	 * placeholder line: a new line item without "after" lands first, the content goes
	 * after it, and the placeholder is removed.
	 */
	private async insert(workspace: string, record: string, markdown: string, prepend: boolean): Promise<void> {
		if (!markdown.trim()) {
			return;
		}
		if (!prepend) {
			await this.client.call('insert_markdown', { workspace, record, markdown });
		} else {
			const placeholder = await this.client.call<{ guid: string }>('create_line_item', { workspace, record, type: 'text' });
			try {
				await this.client.call('insert_markdown', { workspace, record, markdown, after: placeholder.guid });
			} finally {
				await this.client.call('trash_line_item', { workspace, line_item: placeholder.guid });
			}
		}
		if (markdown.includes(HIGHLIGHT_START)) {
			await this.underline(workspace, record);
		}
	}

	/** Turn the highlight marks the Markdown left in the record's lines into underlined text. */
	private async underline(workspace: string, record: string): Promise<void> {
		const { items } = await this.client.call<{ items: { guid: string; segments?: Segment[] }[] }>(
			'get_line_items', { workspace, record });
		let failed = 0;
		for (const item of items) {
			if (!item.segments || !hasHighlightMarks(item.segments)) {
				continue;
			}
			await this.client.call('update_line_item', {
				workspace, line_item: item.guid, segments: underlineHighlights(item.segments),
			}).catch(() => failed++);
		}
		if (failed) {
			this.warn(`${failed} highlighted line(s) could not be underlined`);
		}
	}

	private async setBanner(workspace: string, record: string, imageUrl: string): Promise<void> {
		try {
			const response = await fetch(imageUrl);
			const type = (response.headers.get('Content-Type') || '').split(';')[0].trim();
			if (!response.ok || !type.startsWith('image/')) {
				throw new Error(`not an image (${response.status} ${type || 'no type'})`);
			}
			const data = await response.blob();
			if (data.size > MAX_BANNER_BYTES) {
				throw new Error('larger than 10 MB');
			}
			const extension = type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*/, '') || 'img';
			const blobGuid = await this.client.uploadBlob(workspace, `banner.${extension}`, type, data);
			await this.client.call('set_record_banner', { workspace, record, blob_guid: blobGuid });
		} catch (error) {
			this.warn(`The banner was not set: ${(error as Error).message}`);
		}
	}
}

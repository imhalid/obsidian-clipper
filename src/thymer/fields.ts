// Fills the workspace and collection fields of the popup and the template settings
// from Thymer, and shows whether Thymer's MCP bridge answers.

import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import type { ThymerDirectory, ThymerWorkspace } from './directory';
import { setPickerOptions } from './picker';

let pending: Promise<ThymerDirectory> | null = null;

/** Ask the background for the lists; it reads them from Thymer, or from storage when Thymer is closed. */
export function loadThymerDirectory(refresh = false): Promise<ThymerDirectory> {
	if (refresh || !pending) {
		pending = (browser.runtime.sendMessage({ action: 'getThymerDirectory' }) as Promise<ThymerDirectory>)
			.catch(() => ({ connected: false, updatedAt: null, workspaces: [], collections: {} }));
	}
	return pending;
}

/** The workspace a vault field's value points to: by name or guid, else the one focused in Thymer. */
export function findWorkspace(directory: ThymerDirectory, nameOrGuid: string): ThymerWorkspace | undefined {
	const wanted = nameOrGuid.trim().toLowerCase();
	return wanted
		? directory.workspaces.find(ws => ws.name.toLowerCase() === wanted || ws.guid.toLowerCase() === wanted)
		: directory.workspaces.find(ws => ws.focused) || directory.workspaces[0];
}

/** Names for a workspace dropdown: the ones Thymer lets us write to, then any typed in the settings. */
export function workspaceNames(directory: ThymerDirectory, vaults: string[]): string[] {
	const names = directory.workspaces.filter(ws => ws.access === 'readwrite').map(ws => ws.name);
	for (const vault of vaults) {
		if (!names.some(name => name.toLowerCase() === vault.toLowerCase())) {
			names.push(vault);
		}
	}
	return names;
}

/**
 * Offer the workspace's collections in a dropdown under a collection field. It stays a
 * text field: a name that is not in the list makes a new collection when clipping.
 */
export function suggestCollections(input: HTMLInputElement, directory: ThymerDirectory, workspace: string): void {
	const found = findWorkspace(directory, workspace);
	setPickerOptions(input, (found && directory.collections[found.guid]) || []);
}

export function describeThymerStatus(directory: ThymerDirectory): string {
	if (directory.connected) {
		return getMessage('thymerStatusConnected', findWorkspace(directory, '')?.name || '');
	}
	return directory.updatedAt
		? getMessage('thymerStatusOffline', new Date(directory.updatedAt).toLocaleString())
		: getMessage('thymerStatusNever');
}

/** The template editor's workspace dropdown and collection field. */
export async function fillTemplateFields(vaultSelect: HTMLSelectElement, pathInput: HTMLInputElement, selected: string): Promise<void> {
	const directory = await loadThymerDirectory();
	for (const name of workspaceNames(directory, [])) {
		if (!Array.from(vaultSelect.options).some(option => option.value.toLowerCase() === name.toLowerCase())) {
			const option = document.createElement('option');
			option.value = name;
			option.textContent = name;
			vaultSelect.appendChild(option);
		}
	}
	vaultSelect.value = selected;
	suggestCollections(pathInput, directory, vaultSelect.value);
	vaultSelect.oninput = () => suggestCollections(pathInput, directory, vaultSelect.value);
}

/** The settings page's Thymer row: whether the bridge answers, and a button to read the lists again. */
export function initThymerSettings(): void {
	const status = document.getElementById('thymer-settings-status');
	const show = (directory: ThymerDirectory) => {
		if (status) {
			showThymerStatus(status, directory, true);
		}
	};
	loadThymerDirectory().then(show);
	document.getElementById('thymer-refresh-btn')?.addEventListener('click', () => {
		loadThymerDirectory(true).then(show);
	});
}

/** Show the bridge's state on an element: a class for the dot and the text as its tooltip. */
export function showThymerStatus(element: HTMLElement, directory: ThymerDirectory, asText = false): void {
	element.classList.toggle('is-connected', directory.connected);
	element.classList.toggle('is-offline', !directory.connected);
	const text = describeThymerStatus(directory);
	element.setAttribute('aria-label', text);
	element.title = text;
	if (asText) {
		const label = element.querySelector('.thymer-status-text');
		if (label) {
			label.textContent = text;
		}
	}
}

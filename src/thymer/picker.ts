// A dropdown of names under a text field, for the collection fields. Unlike a
// <datalist> it shows every collection when the field gets focus (not just the ones
// matching its text), opens upwards when there is no room below, and offers to make
// a new collection out of a name that is not in the list.

import { getMessage } from '../utils/i18n';

interface Picker {
	options: string[];
	menu: HTMLElement;
	active: number;
}

const pickers = new WeakMap<HTMLInputElement, Picker>();

const CHECK = 'M20 6 9 17l-5-5';
const PLUS = 'M12 5v14M5 12h14';
const CHEVRON = 'm6 9 6 6 6-6';

function icon(path: string): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	line.setAttribute('d', path);
	svg.appendChild(line);
	return svg;
}

/** What the menu lists for the field's text: everything when the text is one of the names. */
function entries(picker: Picker, text: string): { name: string; isNew: boolean }[] {
	const typed = text.trim();
	const lower = typed.toLowerCase();
	const exact = picker.options.some(name => name.toLowerCase() === lower);
	const shown = !typed || exact ? picker.options : picker.options.filter(name => name.toLowerCase().includes(lower));
	const list = shown.map(name => ({ name, isNew: false }));
	if (typed && !exact) {
		list.push({ name: typed, isNew: true });
	}
	return list;
}

function render(input: HTMLInputElement, picker: Picker): void {
	const { menu } = picker;
	menu.textContent = '';
	const list = entries(picker, input.value);
	picker.active = Math.min(picker.active, list.length - 1);
	if (list.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'thymer-picker-empty';
		empty.textContent = getMessage('thymerNoCollections');
		menu.appendChild(empty);
	}
	list.forEach((entry, index) => {
		const item = document.createElement('div');
		item.className = 'thymer-picker-item';
		item.setAttribute('role', 'option');
		item.classList.toggle('is-active', index === picker.active);
		item.classList.toggle('is-new', entry.isNew);
		const selected = !entry.isNew && entry.name.toLowerCase() === input.value.trim().toLowerCase();
		item.setAttribute('aria-selected', String(selected));
		const mark = document.createElement('span');
		mark.className = 'thymer-picker-mark';
		if (entry.isNew || selected) {
			mark.appendChild(icon(entry.isNew ? PLUS : CHECK));
		}
		const label = document.createElement('span');
		label.className = 'thymer-picker-label';
		label.textContent = entry.isNew ? getMessage('thymerNewCollection', entry.name) : entry.name;
		item.append(mark, label);
		// mousedown, so the field does not lose focus (and close the menu) first
		item.addEventListener('mousedown', event => {
			event.preventDefault();
			choose(input, picker, entry.name);
		});
		item.addEventListener('mousemove', () => {
			if (picker.active !== index) {
				picker.active = index;
				render(input, picker);
			}
		});
		menu.appendChild(item);
	});
	menu.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
}

function open(input: HTMLInputElement, picker: Picker): void {
	const list = entries(picker, input.value);
	const current = list.findIndex(entry => entry.name.toLowerCase() === input.value.trim().toLowerCase());
	picker.active = Math.max(current, 0);
	render(input, picker);
	picker.menu.hidden = false;
	// Upwards when the field is near the bottom, as in the popup's footer
	const field = input.getBoundingClientRect();
	const below = window.innerHeight - field.bottom;
	picker.menu.classList.toggle('opens-up', below < picker.menu.offsetHeight + 8 && field.top > below);
}

function close(picker: Picker): void {
	picker.menu.hidden = true;
}

function choose(input: HTMLInputElement, picker: Picker, name: string): void {
	input.value = name;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	close(picker);
}

function attach(input: HTMLInputElement): Picker {
	const wrapper = document.createElement('div');
	wrapper.className = 'thymer-picker';
	input.replaceWith(wrapper);
	wrapper.appendChild(input);
	input.setAttribute('autocomplete', 'off');
	input.setAttribute('role', 'combobox');

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'thymer-picker-toggle clickable-icon';
	toggle.tabIndex = -1;
	toggle.appendChild(icon(CHEVRON));

	const menu = document.createElement('div');
	menu.className = 'thymer-picker-menu';
	menu.setAttribute('role', 'listbox');
	menu.hidden = true;
	wrapper.append(toggle, menu);

	const picker: Picker = { options: [], menu, active: 0 };
	input.addEventListener('focus', () => open(input, picker));
	input.addEventListener('blur', () => close(picker));
	input.addEventListener('input', () => {
		if (!menu.hidden) {
			picker.active = 0;
			render(input, picker);
		}
	});
	input.addEventListener('keydown', event => {
		const list = entries(picker, input.value);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (menu.hidden) {
				open(input, picker);
				return;
			}
			const step = event.key === 'ArrowDown' ? 1 : -1;
			picker.active = (picker.active + step + list.length) % Math.max(list.length, 1);
			render(input, picker);
		} else if (event.key === 'Enter' && !menu.hidden && list[picker.active]) {
			event.preventDefault();
			choose(input, picker, list[picker.active].name);
		} else if (event.key === 'Escape' && !menu.hidden) {
			event.preventDefault();
			event.stopPropagation();
			close(picker);
		}
	});
	toggle.addEventListener('mousedown', event => {
		event.preventDefault();
		if (menu.hidden) {
			input.focus();
			open(input, picker);
		} else {
			close(picker);
		}
	});
	return picker;
}

/** Give the field a dropdown of these names (or update the names it already has). */
export function setPickerOptions(input: HTMLInputElement, options: string[]): void {
	let picker = pickers.get(input);
	if (!picker) {
		picker = attach(input);
		pickers.set(input, picker);
	}
	picker.options = options;
	if (!picker.menu.hidden) {
		render(input, picker);
	}
}

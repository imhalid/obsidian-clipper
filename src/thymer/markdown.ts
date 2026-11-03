// Turns the Markdown the clipper produces (Obsidian-flavoured, from Defuddle) into
// the Markdown that Thymer's import understands.
//
// Thymer's import reads one line item per line: headings, lists, tasks, `>` quote
// lines, fenced code, `---`, `:::note` / `:::warning` / `:::quote` containers, and
// inline bold, italic, code, links and `[[guid]]` refs. Everything else stays as
// literal text, so it is rewritten here:
//
// - callouts (`> [!note] Title`) and multi-line quotes become `:::` containers
// - images become links (Thymer can't make image lines from Markdown)
// - `==highlight==` becomes bold, `~~strike~~` loses its markers
// - `$math$` becomes inline code, `$$` blocks become code blocks
// - footnote markers become superscript numbers
// - `[[Name]]` wikilinks become plain text (Thymer only resolves guids)
// - `#word` in the text is escaped so it doesn't become a Thymer hashtag
// - blank lines are dropped: in Thymer each would be an empty line item

const FENCE = /^\s*(`{3,}|~{3,})/;
const MATH_BLOCK = /^\s*\$\$\s*$/;
const QUOTE_LINE = /^ {0,3}>/;
const CALLOUT_HEAD = /^\[!([\w-]+)\][+-]?\s*(.*)$/;
const HR = /^\s*([*_-])(\s*\1){2,}\s*$/;
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]:\s*(.*)$/;
// Thymer resolves `[[...]]` only when it ends in a guid
const GUID = /^(?:.*\|\s*)?[0-9A-Z]{10,}$/;

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const CALLOUT_STYLES: Record<string, string> = {
	warning: 'warning', caution: 'warning', attention: 'warning', danger: 'warning',
	error: 'warning', bug: 'warning', failure: 'warning', fail: 'warning', missing: 'warning', important: 'warning',
	quote: 'quote', cite: 'quote',
};

function superscript(label: string): string {
	return /^\d+$/.test(label)
		? [...label].map(digit => SUPERSCRIPT_DIGITS[Number(digit)]).join('')
		: `[${label}]`;
}

function isEmbedUrl(url: string): boolean {
	return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//.test(url)
		|| /(?:twitter\.com|x\.com)\/[^/]+\/status\//.test(url);
}

/**
 * Thymer ends a link's target at the first ")", so `[x](https://e.org/a_\(b\) "t")`
 * would lose half of it. Rewrite every target with its parentheses percent-encoded
 * and without the title.
 */
function cleanLinkTargets(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf('](', i);
		if (start === -1) {
			break;
		}
		let j = start + 2;
		let depth = 0;
		let target = '';
		while (j < text.length) {
			const char = text[j];
			if (char === '\\' && (text[j + 1] === '(' || text[j + 1] === ')')) {
				target += text[j + 1] === '(' ? '%28' : '%29';
				j += 2;
				continue;
			}
			if (char === '(') {
				depth++;
				target += '%28';
			} else if (char === ')') {
				if (depth === 0) {
					break;
				}
				depth--;
				target += '%29';
			} else {
				target += char;
			}
			j++;
		}
		if (j >= text.length) {
			// No closing parenthesis: not a link
			out += text.slice(i, start + 2);
			i = start + 2;
			continue;
		}
		const url = target.trim().match(/^<([^>]*)>|^(\S+)/);
		out += text.slice(i, start) + '](' + (url ? url[1] ?? url[2] : target) + ')';
		i = j + 1;
	}
	return out + text.slice(i);
}

/** Rewrite the inline syntax of one line; code spans and math are left alone. */
export function convertInline(text: string): string {
	const kept: string[] = [];
	const keep = (value: string) => `\u0000${kept.push(value) - 1}\u0000`;

	let line = text
		.replace(/(`+)[\s\S]*?\1/g, span => keep(span))
		// Pandoc's rule: no space inside the dollars, and no digit right after the closing one,
		// so prices ("$5 and $10") are not taken for math
		.replace(/\$\$([^$\n]+?)\$\$/g, (_, tex) => keep(`\`${tex.trim()}\``))
		.replace(/(^|[^\\$])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, before, tex) => before + keep(`\`${tex}\``));

	line = cleanLinkTargets(line)
		.replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(([^)]+)\)/g, (_, alt, href) => `[${alt.trim() || 'Link'}](${href})`)
		.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
			isEmbedUrl(src) ? `<${src}>` : `[${alt.trim() || 'Image'}](${src})`)
		.replace(/==(?=\S)(.+?)(?<=\S)==/g, '**$1**')
		.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
		.replace(/\[\^([^\]]+)\]/g, (_, label) => superscript(label))
		.replace(/\[\[([^\]]+)\]\]/g, (link, inner) => {
			if (GUID.test(inner.trim())) {
				return link;
			}
			const [target, alias] = inner.split('|');
			return (alias || target.split('#')[0]).trim();
		})
		// Not after "[": Thymer shows a link's title raw, backslash included
		.replace(/(^|[\s({"'“‘])#(?=[\p{L}\p{N}_])/gu, '$1\\#');

	return line.replace(/\u0000(\d+)\u0000/g, (_, index) => kept[Number(index)]);
}

function convertLine(line: string): string {
	if (HR.test(line)) {
		return '---';
	}
	const footnote = line.match(FOOTNOTE_DEF);
	if (footnote) {
		return `${superscript(footnote[1])} ${convertInline(footnote[2])}`;
	}
	return convertInline(line);
}

function convertQuote(quoted: string[]): string[] {
	const head = quoted[0].trim().match(CALLOUT_HEAD);
	if (head) {
		const type = head[1].toLowerCase();
		const title = head[2].trim();
		const body = convertBlocks(quoted.slice(1));
		const titleLine = title && title.toLowerCase() !== type ? [`**${convertInline(title)}**`] : [];
		return [`:::${CALLOUT_STYLES[type] || 'note'}`, ...titleLine, ...body, ':::'];
	}
	const body = convertBlocks(quoted);
	if (body.length === 1 && !quoted.some(line => QUOTE_LINE.test(line))) {
		return [`> ${body[0]}`];
	}
	return [':::quote', ...body, ':::'];
}

function convertBlocks(lines: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		const fence = line.match(FENCE);
		if (fence) {
			const marker = fence[1];
			const close = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
			out.push(line);
			i++;
			while (i < lines.length && !close.test(lines[i])) {
				out.push(lines[i++]);
			}
			out.push(marker);
			i++;
			continue;
		}

		if (MATH_BLOCK.test(line)) {
			out.push('```');
			i++;
			while (i < lines.length && !MATH_BLOCK.test(lines[i])) {
				out.push(lines[i++]);
			}
			out.push('```');
			i++;
			continue;
		}

		if (QUOTE_LINE.test(line)) {
			const quoted: string[] = [];
			while (i < lines.length && QUOTE_LINE.test(lines[i])) {
				quoted.push(lines[i++].replace(/^ {0,3}> ?/, ''));
			}
			out.push(...convertQuote(quoted));
			continue;
		}

		if (line.trim() !== '') {
			out.push(convertLine(line));
		}
		i++;
	}
	return out;
}

export function toThymerMarkdown(markdown: string): string {
	return convertBlocks(markdown.replace(/\r\n?/g, '\n').split('\n')).join('\n');
}

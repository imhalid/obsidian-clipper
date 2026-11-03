import { describe, expect, test } from 'vitest';
import { HIGHLIGHT_END, HIGHLIGHT_START, convertInline, hasHighlightMarks, toThymerMarkdown, underlineHighlights } from './markdown';

const S = HIGHLIGHT_START;
const E = HIGHLIGHT_END;

describe('underlineHighlights', () => {
	test('underlines the marked text and drops the marks', () => {
		expect(underlineHighlights([{ type: 'text', text: `before ${S}marked${E} after` }])).toEqual([
			{ type: 'text', text: 'before ' }, { type: 'underline', text: 'marked' }, { type: 'text', text: ' after' },
		]);
	});

	test('a highlight may run over bold text and around links and code', () => {
		const link = { type: 'linkobj', text: { link: 'https://e.com', title: 'e' } };
		expect(underlineHighlights([
			{ type: 'text', text: `${S}one ` }, { type: 'bold', text: 'two' }, { type: 'text', text: ' ' },
			link, { type: 'code', text: 'x' }, { type: 'text', text: `${E} rest` },
		])).toEqual([
			{ type: 'underline', text: 'one two ' }, link, { type: 'code', text: 'x' }, { type: 'text', text: ' rest' },
		]);
	});

	test('finds the lines that hold marks', () => {
		expect(hasHighlightMarks([{ type: 'text', text: `a ${S}b${E}` }])).toBe(true);
		expect(hasHighlightMarks([{ type: 'text', text: 'plain' }, { type: 'linkobj', text: {} }])).toBe(false);
	});
});

describe('toThymerMarkdown', () => {
	test('keeps what Thymer reads and drops blank lines', () => {
		const md = '# Title\n\nSome **bold** and *italic* text.\n\n- one\n  - two\n\n1. first\n\n- [ ] task';
		expect(toThymerMarkdown(md)).toBe('# Title\nSome **bold** and *italic* text.\n- one\n  - two\n1. first\n- [ ] task');
	});

	test('leaves code blocks alone, blank lines and all', () => {
		const md = '```js\nconst a = "==x==";\n\n// #tag $x$\n```\nafter';
		expect(toThymerMarkdown(md)).toBe('```js\nconst a = "==x==";\n\n// #tag $x$\n```\nafter');
	});

	test('turns callouts into containers', () => {
		const md = '> [!warning] Careful now\n> Body line\n> - item';
		expect(toThymerMarkdown(md)).toBe(':::warning\n**Careful now**\nBody line\n- item\n:::');
	});

	test('drops a callout title that only repeats its type', () => {
		expect(toThymerMarkdown('> [!note] Note\n> text')).toBe(':::note\ntext\n:::');
		expect(toThymerMarkdown('> [!tip]- Tip\n> text')).toBe(':::note\ntext\n:::');
	});

	test('keeps one-line quotes as quote lines and wraps longer ones', () => {
		expect(toThymerMarkdown('> just this')).toBe('> just this');
		expect(toThymerMarkdown('> first\n>\n> second')).toBe(':::quote\nfirst\nsecond\n:::');
		expect(toThymerMarkdown('> outer\n> > inner')).toBe(':::quote\nouter\n> inner\n:::');
	});

	test('turns $$ blocks into code blocks', () => {
		expect(toThymerMarkdown('$$\nE = mc^2\n$$')).toBe('```\nE = mc^2\n```');
	});

	test('rewrites footnote definitions', () => {
		expect(toThymerMarkdown('Text[^1].\n\n[^1]: The source.')).toBe('Text¹.\n¹ The source.');
	});

	test('normalises horizontal rules', () => {
		expect(toThymerMarkdown('* * *')).toBe('---');
	});
});

describe('convertInline', () => {
	test('images become links, embeds become bare links', () => {
		expect(convertInline('![A cat](https://e.com/cat.jpg "Cat")')).toBe('[A cat](https://e.com/cat.jpg)');
		expect(convertInline('![](https://e.com/cat.jpg)')).toBe('[Image](https://e.com/cat.jpg)');
		expect(convertInline('![](https://www.youtube.com/watch?v=abc)')).toBe('<https://www.youtube.com/watch?v=abc>');
		expect(convertInline('[![logo](https://e.com/l.png)](https://e.com)')).toBe('[logo](https://e.com)');
	});

	test('link targets lose titles and keep their parentheses', () => {
		expect(convertInline('*[Thymus](https://en.wikipedia.org/wiki/Thymus_\\(plant\\) "Thymus (plant)")*'))
			.toBe('*[Thymus](https://en.wikipedia.org/wiki/Thymus_%28plant%29)*');
		expect(convertInline('[a](https://e.com/x_(y)) and [b](<https://e.com/b c>)'))
			.toBe('[a](https://e.com/x_%28y%29) and [b](https://e.com/b c)');
		expect(convertInline('a](b without close')).toBe('a](b without close');
	});

	test('highlights, strikethrough, footnotes and wikilinks', () => {
		expect(convertInline('a ==marked== b')).toBe(`a ${HIGHLIGHT_START}marked${HIGHLIGHT_END} b`);
		expect(convertInline('a ~~gone~~ b')).toBe('a gone b');
		expect(convertInline('see[^12] and[^note]')).toBe('see¹² and[note]');
		expect(convertInline('by [[Jane Doe]] and [[Page#Part|alias]]')).toBe('by Jane Doe and alias');
		expect(convertInline('ref [[1A2B3C4D5E6F]]')).toBe('ref [[1A2B3C4D5E6F]]');
	});

	test('math becomes code, prices do not', () => {
		expect(convertInline('so $x^2$ grows')).toBe('so `x^2` grows');
		expect(convertInline('costs $5 and $10')).toBe('costs $5 and $10');
		expect(convertInline('inline $$a+b$$ here')).toBe('inline `a+b` here');
	});

	test('escapes hashtags in text but not in code, links or C#', () => {
		expect(convertInline('#tag and (#two) in C# and `#code`')).toBe('\\#tag and (\\#two) in C# and `#code`');
		expect(convertInline('[go](https://e.com/#part)')).toBe('[go](https://e.com/#part)');
		expect(convertInline('## Heading')).toBe('## Heading');
	});
});

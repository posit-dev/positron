/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import * as marked from '../../../../../base/common/marked/marked.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { MarkedFootnoteExtension } from '../../../markdown/common/markedFootnoteExtension.js';
import { TokenMarkdownRenderer } from '../../browser/markdownRenderer.js';
import { NotebookLink } from '../../browser/notebookCells/NotebookLink.js';

type AnyElement = React.ReactElement<any>;

/**
 * Tests for footnote rendering behavior in TokenMarkdownRenderer.
 * Validates deduplicate-definitions (first-wins), unique ref anchor IDs, and
 * footnote section structure.
 */
describe('TokenMarkdownRenderer - Footnotes', () => {

	function tokenize(src: string): marked.TokensList {
		return new marked.Marked()
			.use(MarkedFootnoteExtension.extension())
			.lexer(src);
	}

	function renderTokens(src: string): AnyElement[] {
		const tokens = tokenize(src);
		const renderer = new TokenMarkdownRenderer(
			stubInterface<IExtensionService>({}),
			stubInterface<ILanguageService>({}),
		);
		return renderer.render(tokens as (marked.MarkedToken | MarkedFootnoteExtension.FootnoteToken)[]) as AnyElement[];
	}

	/**
	 * Recursively finds all React elements matching a predicate.
	 */
	function findElements(
		elements: React.ReactNode[],
		predicate: (el: AnyElement) => boolean,
	): AnyElement[] {
		const results: AnyElement[] = [];
		for (const node of elements) {
			if (Array.isArray(node)) {
				results.push(...findElements(node, predicate));
				continue;
			}
			if (!React.isValidElement(node)) {
				continue;
			}
			const el = node as AnyElement;
			if (predicate(el)) {
				results.push(el);
			}
			const children = el.props.children;
			if (Array.isArray(children)) {
				results.push(...findElements(children, predicate));
			} else if (React.isValidElement(children)) {
				results.push(...findElements([children], predicate));
			}
		}
		return results;
	}

	function getChildren(el: AnyElement): React.ReactNode[] {
		const children = el.props.children;
		return Array.isArray(children) ? children : [children];
	}

	function findChildAnchor(sup: AnyElement): AnyElement {
		const anchor = getChildren(sup).find(
			(c: React.ReactNode) => React.isValidElement(c) &&
				((c as AnyElement).type === 'a' || (c as AnyElement).type === NotebookLink)
		);
		if (!anchor) {
			throw new Error('footnote ref has no anchor child');
		}
		return anchor as AnyElement;
	}

	it('renders a footnotes section at the end', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: A note.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
	});

	it('does not render a footnotes section when there are no footnotes', () => {
		const elements = renderTokens('Just plain text.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(0);
	});

	it('deduplicates definitions by ID (first-wins)', () => {
		const elements = renderTokens('[^1]: First.\n\n[^1]: Second.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);

		// The <ol> should have only 1 <li>, not 2.
		const lis = findElements([sections[0]], el => el.type === 'li');
		expect(lis, 'duplicate definition should be deduplicated').toHaveLength(1);
		expect(lis[0].props.id).toBe('fn-1');
	});

	it('multiple refs to same footnote get unique anchor IDs', () => {
		const elements = renderTokens('A[^1] B[^1]\n\n[^1]: Shared.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);

		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		expect(anchor0.props.id).toBe('fnref-1');
		expect(anchor1.props.id).toBe('fnref-1-2');
		// Both should link to the same definition
		expect(anchor0.props.href).toBe('#fn-1');
		expect(anchor1.props.href).toBe('#fn-1');
	});

	it('footnote numbers are sequential based on definition order', () => {
		const elements = renderTokens('A[^b] B[^a]\n\n[^b]: Beta.\n\n[^a]: Alpha.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);

		// [^b] is defined first, so gets number 1. [^a] gets number 2.
		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		expect(anchor0.props.children).toBe(1);
		expect(anchor1.props.children).toBe(2);
	});

	it('backref links point to the first reference anchor', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: Note.');
		const backrefs = findElements(elements, el => el.props.className === 'footnote-backref');
		expect(backrefs).toHaveLength(1);
		expect(backrefs[0].props.href).toBe('#fnref-1');
	});

	it('unreferenced definitions do not render backref links', () => {
		const elements = renderTokens('[^1]: Orphan definition with no reference.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
		const backrefs = findElements([sections[0]], el => el.props.className === 'footnote-backref');
		expect(backrefs).toHaveLength(0);
	});

	it('special characters in footnote IDs are sanitized for DOM attributes', () => {
		const elements = renderTokens('Text[^a b]\n\n[^a b]: Note with spaces.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(1);
		const anchor = findChildAnchor(refs[0]);
		// Space should be replaced with hyphen
		expect(anchor.props.id).toBe('fnref-a-b');
		expect(anchor.props.href).toBe('#fn-a-b');
	});

	it('colliding sanitized IDs get unique suffixes', () => {
		// "a b" sanitizes to "a-b", and "a-b" is already "a-b" -- collision.
		const elements = renderTokens('X[^a b] Y[^a-b]\n\n[^a b]: First.\n\n[^a-b]: Second.');
		const lis = findElements(elements, el => el.type === 'li');
		expect(lis).toHaveLength(2);
		// First definition gets "a-b", second gets "a-b-2"
		expect(lis[0].props.id).toBe('fn-a-b');
		expect(lis[1].props.id).toBe('fn-a-b-2');
		// Refs should link to their respective definitions
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);
		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		expect(anchor0.props.href).toBe('#fn-a-b');
		expect(anchor1.props.href).toBe('#fn-a-b-2');
	});

	it('footnote refs nested in headings and lists are handled', () => {
		const input = [
			'## Heading[^1]',
			'',
			'- List item[^2]',
			'',
			'[^1]: From heading.',
			'',
			'[^2]: From list.',
		].join('\n');
		const elements = renderTokens(input);
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
	});

	it('footnote refs nested in table cells are handled', () => {
		const input = [
			'| Col |',
			'| --- |',
			'| Data[^1] |',
			'',
			'[^1]: Table note.',
		].join('\n');
		const elements = renderTokens(input);
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(1);
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
	});

	it('backref is placed inside the last paragraph of a footnote definition', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: Simple note.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
		// The backref should be inside the <p>, not a sibling after it.
		const paragraphs = findElements([sections[0]], el => el.type === 'p');
		expect(paragraphs).toHaveLength(1);
		const backrefInParagraph = findElements([paragraphs[0]], el => el.props.className === 'footnote-backref');
		expect(backrefInParagraph, 'backref should be inside the paragraph').toHaveLength(1);
	});

	it('backref is a sibling when last token is not a paragraph', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: intro\n  * item one\n  * item two');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
		// Last token is a list, so backref should be a sibling, not inside the list.
		const backrefs = findElements([sections[0]], el => el.props.className === 'footnote-backref');
		expect(backrefs).toHaveLength(1);
		// The backref should NOT be inside the <ul>
		const lists = findElements([sections[0]], el => el.type === 'ul');
		expect(lists).toHaveLength(1);
		const backrefInList = findElements([lists[0]], el => el.props.className === 'footnote-backref');
		expect(backrefInList, 'backref should not be inside the list').toHaveLength(0);
	});

	it('block content in definitions renders correctly', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: intro\n  * item one\n  * item two');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(1);
		const lists = findElements([sections[0]], el => el.type === 'ul');
		expect(lists, 'footnote with list content should render a ul').toHaveLength(1);
	});

	it('[^id]:\\n  body with empty first line and indented continuation is accepted', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]:\n  deferred continuation.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections, 'empty-first-line def with indented continuation should tokenize').toHaveLength(1);
		const lis = findElements([sections[0]], el => el.type === 'li');
		expect(lis).toHaveLength(1);
	});

	it('[^id]:text without a separator is rejected (falls through to plain text)', () => {
		// Pair the bare form with a real ref so any section that does appear would
		// be from this definition, not side-effects of the ref alone.
		const elements = renderTokens('Text[^1]\n\n[^1]:no-separator body.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections, '[^id]:text should not tokenize as a definition').toHaveLength(0);
	});

	it('[^id]: alone with no body or continuation is rejected', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]:');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections, 'bare [^id]: should not tokenize as a definition').toHaveLength(0);
	});

	it('ref to an undefined footnote still renders without a footnote section', () => {
		const elements = renderTokens('Text[^missing] and more text.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(1);

		const anchor = findChildAnchor(refs[0]);
		// With no matching definition, the raw id is used as the ref label and
		// the href points at the (nonexistent) footnote anchor.
		expect(anchor.props.children).toBe('missing');
		expect(anchor.props.href).toBe('#fn-missing');
		expect(anchor.props.id).toBe('fnref-missing');

		// No section should be emitted when there are no definitions.
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		expect(sections).toHaveLength(0);
	});

	it('undefined ref with colliding sanitized ID does not conflict with defined footnote', () => {
		// [^a-b] is defined but [^a b] is only referenced (undefined def).
		// Both sanitize to "a-b", so the ref to [^a b] should get a unique ID.
		const elements = renderTokens('X[^a b] Y[^a-b]\n\n[^a-b]: Defined.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);
		const anchor0 = findChildAnchor(refs[0]); // ref to [^a b] (undefined)
		const anchor1 = findChildAnchor(refs[1]); // ref to [^a-b] (defined)
		// The two refs must have different IDs
		expect(anchor0.props.id).not.toBe(anchor1.props.id);
	});

	it('footnote ref anchors use NotebookLink', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: Note.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(1);
		const anchor = findChildAnchor(refs[0]);
		expect(anchor.type, 'footnote ref should use NotebookLink').toBe(NotebookLink);
	});

	it('footnote backref anchors use NotebookLink', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: Note.');
		const backrefs = findElements(elements, el => el.props.className === 'footnote-backref');
		expect(backrefs).toHaveLength(1);
		expect(backrefs[0].type, 'backref should use NotebookLink').toBe(NotebookLink);
	});

	it('footnote ref has doc-noteref role and aria-label with footnote number', () => {
		const elements = renderTokens('Text[^a] More[^b]\n\n[^a]: First.\n\n[^b]: Second.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		expect(refs).toHaveLength(2);
		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		expect(anchor0.props.role).toBe('doc-noteref');
		expect(anchor1.props.role).toBe('doc-noteref');
		expect(anchor0.props['aria-label']).toBe('Footnote 1');
		expect(anchor1.props['aria-label']).toBe('Footnote 2');
	});

	it('footnote backref has doc-backlink role and aria-label with footnote number', () => {
		const elements = renderTokens('Text[^a] More[^b]\n\n[^a]: First.\n\n[^b]: Second.');
		const backrefs = findElements(elements, el => el.props.className === 'footnote-backref');
		expect(backrefs).toHaveLength(2);
		expect(backrefs[0].props.role).toBe('doc-backlink');
		expect(backrefs[1].props.role).toBe('doc-backlink');
		expect(backrefs[0].props['aria-label']).toBe('Back to content 1');
		expect(backrefs[1].props['aria-label']).toBe('Back to content 2');
	});

	// Renders the full markdown document from the issue and asserts every
	// reference resolves to the correct definition anchor. Click-to-scroll
	// behavior is intentionally out of scope for a unit test.
	describe('footnote rendering test document (#13116)', () => {
		const testDocument = [
			'# Footnote Rendering Test',
			'',
			'This is a sentence with a footnote reference.[^1]',
			'',
			'Some text in between to ensure spacing and layout is preserved.',
			'',
			'Another paragraph with a second reference.[^long]',
			'',
			'More content here, including **bold text**, `inline code`, and a list:',
			'',
			'- Item one',
			'- Item two with another footnote reference[^1]',
			'',
			'Even more text to separate the references from the definitions.',
			'',
			'---',
			'',
			'## Section Break',
			'',
			'This section exists to ensure footnotes still link correctly across longer distances.',
			'',
			'Here is one more reference to test scrolling behavior.[^long]',
			'',
			'---',
			'',
			'## Footnotes',
			'',
			'[^1]: This is a short footnote.',
			'',
			'[^long]: This is a longer footnote used multiple times to verify that:',
			'    - clicking any reference scrolls correctly',
			'    - the correct footnote is highlighted or targeted',
			'    - repeated references resolve to the same footnote',
		].join('\n');

		// What #13116 cares about is referential integrity, not the exact id
		// spelling: a cosmetic id rename should not fail these. The checks below
		// assert relationships; the canary keeps one literal assertion so an
		// unintended change to the id format is still noticed.
		it('reference hrefs follow the documented spelling (canary)', () => {
			const elements = renderTokens(testDocument);
			const refs = findElements(elements, el => el.props.className === 'footnote-ref');
			const anchors = refs.map(findChildAnchor);
			// Document order: [^1], [^long], [^1] (in list), [^long] (after section break).
			expect(anchors.map(a => a.props.href)).toEqual(['#fn-1', '#fn-long', '#fn-1', '#fn-long']);
		});

		it('every reference href targets an existing definition id', () => {
			const elements = renderTokens(testDocument);
			const refs = findElements(elements, el => el.props.className === 'footnote-ref');
			const anchors = refs.map(findChildAnchor);
			const sections = findElements(elements, el => el.props.className === 'footnotes');
			expect(sections).toHaveLength(1);
			// The id filter keeps only the definition <li>s (e.g. id "fn-1"); content
			// <li>s from a footnote body's own list have no id and must be excluded.
			const definitionIds = findElements([sections[0]], el => el.type === 'li' && typeof el.props.id === 'string')
				.map(li => li.props.id);

			// Every ref must resolve: its "#fn-x" href points at a definition that exists.
			for (const anchor of anchors) {
				expect(definitionIds).toContain(anchor.props.href.replace('#', ''));
			}
		});

		it('repeated references share an href but get distinct anchor ids', () => {
			const elements = renderTokens(testDocument);
			const refs = findElements(elements, el => el.props.className === 'footnote-ref');
			const anchors = refs.map(findChildAnchor);

			// Group refs by the footnote number they display; repeats of the same
			// footnote land in the same group (here [^1] twice and [^long] twice).
			const groups = new Map<number, AnyElement[]>();
			for (const anchor of anchors) {
				const number = anchor.props.children as number;
				const group = groups.get(number) ?? [];
				group.push(anchor);
				groups.set(number, group);
			}
			// At least one footnote is referenced more than once (otherwise the
			// share/distinct checks below would pass vacuously).
			expect([...groups.values()].some(group => group.length > 1)).toBe(true);

			for (const group of groups.values()) {
				// Same destination definition ...
				expect(new Set(group.map(a => a.props.href)).size).toBe(1);
				// ... but each occurrence needs a unique anchor id for its backref to target.
				expect(new Set(group.map(a => a.props.id)).size).toBe(group.length);
			}
		});

		it('each definition backref points at the first reference to that footnote', () => {
			const elements = renderTokens(testDocument);
			const refs = findElements(elements, el => el.props.className === 'footnote-ref');
			const anchors = refs.map(findChildAnchor);
			const backrefs = findElements(elements, el => el.props.className === 'footnote-backref');

			// First ref anchor id seen for each footnote number, in first-seen order
			// (which matches the order the definitions render in).
			const firstRefId = new Map<number, string>();
			for (const anchor of anchors) {
				const number = anchor.props.children as number;
				if (!firstRefId.has(number)) {
					firstRefId.set(number, anchor.props.id);
				}
			}

			// One backref per definition, each pointing back at that footnote's first ref.
			expect(backrefs.map(b => b.props.href)).toEqual(
				[...firstRefId.values()].map(id => `#${id}`)
			);
		});

		it('the long footnote definition renders its block list content', () => {
			const elements = renderTokens(testDocument);
			const sections = findElements(elements, el => el.props.className === 'footnotes');
			expect(sections).toHaveLength(1);
			const lists = findElements([sections[0]], el => el.type === 'ul');
			expect(lists).toHaveLength(1);
			const items = findElements([lists[0]], el => el.type === 'li');
			expect(items).toHaveLength(3);
		});
	});
});

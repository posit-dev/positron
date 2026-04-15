/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import React from 'react';
import * as marked from '../../../../../base/common/marked/marked.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { MarkedFootnoteExtension } from '../../../markdown/common/markedFootnoteExtension.js';
import { TokenMarkdownRenderer } from '../../browser/markdownRenderer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';

type AnyElement = React.ReactElement<any>;

/**
 * Tests for footnote rendering behavior in TokenMarkdownRenderer.
 * Validates deduplicate-definitions (first-wins), unique ref anchor IDs, and
 * footnote section structure.
 */
suite('Positron Notebook - TokenMarkdownRenderer Footnotes', () => {

	createTestContainer().build();

	function tokenize(src: string): marked.TokensList {
		return new marked.Marked()
			.use(MarkedFootnoteExtension.extension())
			.lexer(src);
	}

	// Footnote rendering does not use extension or language services,
	// so we pass stubs that will never be called.
	const extensionService: IExtensionService = Object.create(null);
	const languageService: ILanguageService = Object.create(null);

	function renderTokens(src: string): AnyElement[] {
		const tokens = tokenize(src);
		const renderer = new TokenMarkdownRenderer(extensionService, languageService);
		return renderer.render(tokens as (marked.Token | MarkedFootnoteExtension.FootnoteToken)[]) as AnyElement[];
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

	function findChildAnchor(sup: AnyElement): AnyElement | undefined {
		return getChildren(sup).find(
			(c: React.ReactNode) => React.isValidElement(c) && (c as AnyElement).type === 'a'
		) as AnyElement | undefined;
	}

	test('renders a footnotes section at the end', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: A note.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);
	});

	test('does not render a footnotes section when there are no footnotes', () => {
		const elements = renderTokens('Just plain text.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 0);
	});

	test('deduplicates definitions by ID (first-wins)', () => {
		const elements = renderTokens('[^1]: First.\n\n[^1]: Second.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);

		// The <ol> should have only 1 <li>, not 2.
		const lis = findElements([sections[0]], el => el.type === 'li');
		assert.strictEqual(lis.length, 1, 'duplicate definition should be deduplicated');
		assert.strictEqual(lis[0].props.id, 'fn-1');
	});

	test('multiple refs to same footnote get unique anchor IDs', () => {
		const elements = renderTokens('A[^1] B[^1]\n\n[^1]: Shared.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 2);

		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		assert.ok(anchor0);
		assert.ok(anchor1);
		assert.strictEqual(anchor0.props.id, 'fnref-1');
		assert.strictEqual(anchor1.props.id, 'fnref-1-2');
		// Both should link to the same definition
		assert.strictEqual(anchor0.props.href, '#fn-1');
		assert.strictEqual(anchor1.props.href, '#fn-1');
	});

	test('footnote numbers are sequential based on definition order', () => {
		const elements = renderTokens('A[^b] B[^a]\n\n[^b]: Beta.\n\n[^a]: Alpha.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 2);

		// [^b] is defined first, so gets number 1. [^a] gets number 2.
		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		assert.ok(anchor0);
		assert.ok(anchor1);
		assert.strictEqual(anchor0.props.children, 1);
		assert.strictEqual(anchor1.props.children, 2);
	});

	test('backref links point to the first reference anchor', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: Note.');
		const backrefs = findElements(elements, el => el.props.className === 'footnote-backref');
		assert.strictEqual(backrefs.length, 1);
		assert.strictEqual(backrefs[0].props.href, '#fnref-1');
	});

	test('unreferenced definitions do not render backref links', () => {
		const elements = renderTokens('[^1]: Orphan definition with no reference.');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);
		const backrefs = findElements([sections[0]], el => el.props.className === 'footnote-backref');
		assert.strictEqual(backrefs.length, 0);
	});

	test('special characters in footnote IDs are sanitized for DOM attributes', () => {
		const elements = renderTokens('Text[^a b]\n\n[^a b]: Note with spaces.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 1);
		const anchor = findChildAnchor(refs[0]);
		assert.ok(anchor);
		// Space should be replaced with hyphen
		assert.strictEqual(anchor.props.id, 'fnref-a-b');
		assert.strictEqual(anchor.props.href, '#fn-a-b');
	});

	test('colliding sanitized IDs get unique suffixes', () => {
		// "a b" sanitizes to "a-b", and "a-b" is already "a-b" -- collision.
		const elements = renderTokens('X[^a b] Y[^a-b]\n\n[^a b]: First.\n\n[^a-b]: Second.');
		const lis = findElements(elements, el => el.type === 'li');
		assert.strictEqual(lis.length, 2);
		// First definition gets "a-b", second gets "a-b-2"
		assert.strictEqual(lis[0].props.id, 'fn-a-b');
		assert.strictEqual(lis[1].props.id, 'fn-a-b-2');
		// Refs should link to their respective definitions
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 2);
		const anchor0 = findChildAnchor(refs[0]);
		const anchor1 = findChildAnchor(refs[1]);
		assert.ok(anchor0);
		assert.ok(anchor1);
		assert.strictEqual(anchor0.props.href, '#fn-a-b');
		assert.strictEqual(anchor1.props.href, '#fn-a-b-2');
	});

	test('footnote refs nested in headings and lists are handled', () => {
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
		assert.strictEqual(refs.length, 2);
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);
	});

	test('footnote refs nested in table cells are handled', () => {
		const input = [
			'| Col |',
			'| --- |',
			'| Data[^1] |',
			'',
			'[^1]: Table note.',
		].join('\n');
		const elements = renderTokens(input);
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 1);
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);
	});

	test('block content in definitions renders correctly', () => {
		const elements = renderTokens('Text[^1]\n\n[^1]: intro\n  * item one\n  * item two');
		const sections = findElements(elements, el => el.props.className === 'footnotes');
		assert.strictEqual(sections.length, 1);
		const lists = findElements([sections[0]], el => el.type === 'ul');
		assert.strictEqual(lists.length, 1, 'footnote with list content should render a ul');
	});

	test('undefined ref with colliding sanitized ID does not conflict with defined footnote', () => {
		// [^a-b] is defined but [^a b] is only referenced (undefined def).
		// Both sanitize to "a-b", so the ref to [^a b] should get a unique ID.
		const elements = renderTokens('X[^a b] Y[^a-b]\n\n[^a-b]: Defined.');
		const refs = findElements(elements, el => el.props.className === 'footnote-ref');
		assert.strictEqual(refs.length, 2);
		const anchor0 = findChildAnchor(refs[0]); // ref to [^a b] (undefined)
		const anchor1 = findChildAnchor(refs[1]); // ref to [^a-b] (defined)
		assert.ok(anchor0);
		assert.ok(anchor1);
		// The two refs must have different IDs
		assert.notStrictEqual(anchor0.props.id, anchor1.props.id);
	});
});

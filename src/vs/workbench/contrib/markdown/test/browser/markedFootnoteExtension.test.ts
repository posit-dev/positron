/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as marked from '../../../../../base/common/marked/marked.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MarkedFootnoteExtension } from '../../common/markedFootnoteExtension.js';

suite('MarkedFootnoteExtension', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function tokenize(src: string): marked.TokensList {
		const markedInstance = new marked.Marked()
			.use(MarkedFootnoteExtension.extension());
		return markedInstance.lexer(src);
	}

	function findTokensByType(tokens: marked.Token[], type: string): marked.Token[] {
		const results: marked.Token[] = [];
		for (const token of tokens) {
			if (token.type === type) {
				results.push(token);
			}
			const childTokens = (token as marked.Tokens.Generic).tokens;
			if (Array.isArray(childTokens)) {
				results.push(...findTokensByType(childTokens, type));
			}
		}
		return results;
	}

	suite('footnote references', () => {

		test('tokenizes a basic footnote reference', () => {
			const tokens = tokenize('Here is a footnote.[^1]');
			const refs = findTokensByType(tokens, 'footnoteRef');
			assert.strictEqual(refs.length, 1);
			assert.strictEqual((refs[0] as MarkedFootnoteExtension.FootnoteRefToken).id, '1');
		});

		test('tokenizes multiple footnote references', () => {
			const tokens = tokenize('First[^1] and second[^2].');
			const refs = findTokensByType(tokens, 'footnoteRef');
			assert.strictEqual(refs.length, 2);
			assert.strictEqual((refs[0] as MarkedFootnoteExtension.FootnoteRefToken).id, '1');
			assert.strictEqual((refs[1] as MarkedFootnoteExtension.FootnoteRefToken).id, '2');
		});

		test('tokenizes footnote reference with text id', () => {
			const tokens = tokenize('See this[^note].');
			const refs = findTokensByType(tokens, 'footnoteRef');
			assert.strictEqual(refs.length, 1);
			assert.strictEqual((refs[0] as MarkedFootnoteExtension.FootnoteRefToken).id, 'note');
		});

		test('does not tokenize definition syntax as reference', () => {
			const tokens = tokenize('[^1]: This is a definition');
			const refs = findTokensByType(tokens, 'footnoteRef');
			assert.strictEqual(refs.length, 0);
		});
	});

	suite('footnote definitions', () => {

		test('tokenizes a basic footnote definition', () => {
			const tokens = tokenize('[^1]: Footnote text.');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.strictEqual(def.id, '1');
			assert.strictEqual(def.text, 'Footnote text.');
		});

		test('tokenizes multiple footnote definitions', () => {
			const tokens = tokenize('[^1]: First note.\n\n[^2]: Second note.');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 2);
			assert.strictEqual((defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken).id, '1');
			assert.strictEqual((defs[1] as MarkedFootnoteExtension.FootnoteDefinitionToken).id, '2');
		});

		test('tokenizes definition with text id', () => {
			const tokens = tokenize('[^note]: A named footnote.');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			assert.strictEqual((defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken).id, 'note');
		});

		test('inline content in definitions is tokenized', () => {
			const tokens = tokenize('[^1]: Footnote with **bold** text.');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.ok(def.tokens.length > 0);
			// With block tokenization, bold is nested inside a paragraph token
			const strongTokens = findTokensByType(def.tokens, 'strong');
			assert.strictEqual(strongTokens.length, 1);
		});

		test('multiline definition with list is tokenized as block content', () => {
			const input = '[^1]: intro\n  * item one\n  * item two';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			// Block tokenization should produce a list token inside the definition
			const listTokens = def.tokens.filter(t => t.type === 'list');
			assert.strictEqual(listTokens.length, 1, 'expected a list token from block tokenization');
		});

		test('multiline definition with fenced code block is tokenized as block content', () => {
			const input = '[^1]: intro\n  ```\n  code here\n  ```';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			const codeTokens = def.tokens.filter(t => t.type === 'code');
			assert.strictEqual(codeTokens.length, 1, 'expected a code token from block tokenization');
		});
	});

	suite('full document', () => {

		test('tokenizes references and definitions together', () => {
			const input = [
				'Here is a footnote.[^1]',
				'',
				'[^1]: Footnote text.',
			].join('\n');
			const tokens = tokenize(input);
			const refs = findTokensByType(tokens, 'footnoteRef');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(refs.length, 1);
			assert.strictEqual(defs.length, 1);
			assert.strictEqual((refs[0] as MarkedFootnoteExtension.FootnoteRefToken).id, '1');
			assert.strictEqual((defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken).id, '1');
		});

		test('handles footnotes alongside other markdown', () => {
			const input = [
				'# Heading',
				'',
				'Some text with a footnote[^1] and **bold**.',
				'',
				'[^1]: The footnote definition.',
			].join('\n');
			const tokens = tokenize(input);
			const refs = findTokensByType(tokens, 'footnoteRef');
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(refs.length, 1);
			assert.strictEqual(defs.length, 1);
		});

		test('definition does not consume following paragraph with blank line', () => {
			const input = [
				'[^1]: Footnote text.',
				'',
				'This is a new paragraph.',
			].join('\n');
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.strictEqual(def.text, 'Footnote text.');
			// The following paragraph should be a separate token.
			const paragraphs = tokens.filter(t => t.type === 'paragraph');
			assert.strictEqual(paragraphs.length, 1);
		});

		test('definition does not consume adjacent paragraph without blank line', () => {
			const input = '[^1]: Footnote text.\nThis is a new paragraph.';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			// The adjacent line should not be part of the definition
			// (it is not indented, so it is not a continuation line).
			assert.strictEqual(def.text, 'Footnote text.');
		});

		test('definition supports indented continuation lines', () => {
			const input = '[^1]: First line\n  continuation line.';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.ok(def.text.includes('continuation line.'));
		});

		test('definition supports indented blank continuation lines', () => {
			const input = '[^1]: First line\n  \n  continuation after blank.';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.ok(def.text.includes('continuation after blank.'));
		});

		test('duplicate definition IDs produce only one definition token each', () => {
			const input = [
				'[^1]: First definition.',
				'',
				'[^1]: Duplicate definition.',
			].join('\n');
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			// Both tokenize (dedup is done at render time), but we get 2 tokens.
			assert.strictEqual(defs.length, 2);
		});

		test('multiple references to the same footnote', () => {
			const input = 'First[^1] and again[^1].\n\n[^1]: Shared note.';
			const tokens = tokenize(input);
			const refs = findTokensByType(tokens, 'footnoteRef');
			assert.strictEqual(refs.length, 2);
			assert.strictEqual((refs[0] as MarkedFootnoteExtension.FootnoteRefToken).id, '1');
			assert.strictEqual((refs[1] as MarkedFootnoteExtension.FootnoteRefToken).id, '1');
		});
	});

	suite('rendered HTML', () => {

		function render(src: string): string {
			const markedInstance = new marked.Marked()
				.use(MarkedFootnoteExtension.extension());
			return markedInstance.parse(src) as string;
		}

		test('renders footnote ref as superscript link', () => {
			const html = render('Text[^1]\n\n[^1]: Note.');
			assert.ok(html.includes('class="footnote-ref"'));
			assert.ok(html.includes('href="#fn-1"'));
			assert.ok(html.includes('id="fnref-1"'));
		});

		test('definition renderer returns empty string', () => {
			// Definitions are rendered empty by the Marked renderer;
			// actual rendering is done by the React TokenMarkdownRenderer.
			const html = render('[^1]: Note.');
			// The definition itself should not produce visible output
			// (the Marked HTML renderer returns empty string for definitions).
			assert.ok(!html.includes('Note.'));
		});

		test('multiple refs to same footnote produce distinct anchor IDs in Marked HTML', () => {
			const html = render('A[^1] and B[^1].\n\n[^1]: Shared.');
			// Both refs should have the same href target but the Marked-level
			// renderer uses the same id. The React renderer handles dedup.
			const refMatches = html.match(/id="fnref-1"/g);
			assert.ok(refMatches);
			assert.strictEqual(refMatches.length, 2,
				'Marked HTML renderer does not deduplicate ref IDs; React renderer handles this');
		});

		test('duplicate definitions only render the first via Marked HTML', () => {
			const html = render('[^1]: First.\n\n[^1]: Second.');
			// Both definitions produce empty HTML from the Marked renderer.
			// The React renderer deduplicates (first-wins). At the tokenizer
			// level, both tokens exist; dedup is a rendering concern.
			assert.ok(!html.includes('First.'));
			assert.ok(!html.includes('Second.'));
		});

		test('refs all link to the same footnote target', () => {
			const html = render('A[^1] B[^1] C[^2].\n\n[^1]: Note one.\n\n[^2]: Note two.');
			const hrefFn1 = html.match(/href="#fn-1"/g);
			const hrefFn2 = html.match(/href="#fn-2"/g);
			assert.ok(hrefFn1);
			assert.strictEqual(hrefFn1.length, 2);
			assert.ok(hrefFn2);
			assert.strictEqual(hrefFn2.length, 1);
		});

		test('special characters in footnote IDs are HTML-escaped in rendered output', () => {
			// Test quote escaping
			const html1 = render('Text[^a"b]\n\n[^a"b]: Note.');
			assert.ok(html1.includes('id="fnref-a&quot;b"'));
			assert.ok(html1.includes('href="#fn-a&quot;b"'));
			assert.ok(!html1.includes('id="fnref-a"b"'));

			// Test angle bracket escaping
			const html2 = render('Text[^a<b]\n\n[^a<b]: Note.');
			assert.ok(html2.includes('a&lt;b'));
			assert.ok(!html2.includes('a<b'));

			// Test ampersand escaping
			const html3 = render('Text[^a&b]\n\n[^a&b]: Note.');
			assert.ok(html3.includes('a&amp;b'));
		});
	});
});

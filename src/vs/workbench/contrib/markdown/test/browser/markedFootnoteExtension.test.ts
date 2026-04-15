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

		test('tokenizes footnote references with various IDs', () => {
			const cases: { input: string; expectedIds: string[] }[] = [
				{ input: 'Here is a footnote.[^1]', expectedIds: ['1'] },
				{ input: 'First[^1] and second[^2].', expectedIds: ['1', '2'] },
				{ input: 'See this[^note].', expectedIds: ['note'] },
			];
			for (const { input, expectedIds } of cases) {
				const refs = findTokensByType(tokenize(input), 'footnoteRef');
				assert.strictEqual(refs.length, expectedIds.length, `ref count for: ${input}`);
				for (let i = 0; i < expectedIds.length; i++) {
					assert.strictEqual(
						(refs[i] as MarkedFootnoteExtension.FootnoteRefToken).id,
						expectedIds[i],
						`ref id mismatch at index ${i} for: ${input}`,
					);
				}
			}
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

		test('empty first-line body with continuation lines', () => {
			const input = '[^1]:\n  continuation text.';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			assert.ok(def.text.includes('continuation text.'));
		});

		test('empty first-line body with list on continuation lines', () => {
			const input = '[^1]:\n  * item one\n  * item two';
			const tokens = tokenize(input);
			const defs = findTokensByType(tokens, 'footnoteDefinition');
			assert.strictEqual(defs.length, 1);
			const def = defs[0] as MarkedFootnoteExtension.FootnoteDefinitionToken;
			const listTokens = def.tokens.filter(t => t.type === 'list');
			assert.strictEqual(listTokens.length, 1, 'expected a list token from empty-first-line definition');
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

		test('duplicate definition IDs produce separate tokens (dedup at render time)', () => {
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

});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Chunk, StreamingTagLexer } from '../../../common/positron/streamingTagLexer.js';

/**
 * Helper that collects all chunks emitted by the lexer.
 */
function createCollector() {
	const chunks: Chunk<string>[] = [];
	const contentHandler = (chunk: Chunk<string>) => { chunks.push(chunk); };
	return { chunks, contentHandler };
}

describe('StreamingTagLexer', () => {
	describe('complete XML parsed in one chunk', () => {
		it('parses a single open and close tag', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TOOL'],
				contentHandler,
			});

			await lexer.process('<TOOL>hello</TOOL>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "TOOL",
				    "originalText": "<TOOL>",
				    "type": "tag",
				  },
				  {
				    "text": "hello",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "TOOL",
				    "originalText": "</TOOL>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('parses text before, between, and after tags', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['B'],
				contentHandler,
			});

			await lexer.process('before<B>inside</B>after');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "before",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "B",
				    "originalText": "<B>",
				    "type": "tag",
				  },
				  {
				    "text": "inside",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "B",
				    "originalText": "</B>",
				    "type": "tag",
				  },
				  {
				    "text": "after",
				    "type": "text",
				  },
				]
			`);
		});

		it('parses a tag with attributes', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['FILE'],
				contentHandler,
			});

			await lexer.process('<FILE path="foo.ts">content</FILE>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {
				      "path": "foo.ts",
				    },
				    "kind": "open",
				    "name": "FILE",
				    "originalText": "<FILE path="foo.ts">",
				    "type": "tag",
				  },
				  {
				    "text": "content",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "FILE",
				    "originalText": "</FILE>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('parses a tag with single-quoted attributes', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['FILE'],
				contentHandler,
			});

			await lexer.process('<FILE path=\'foo.ts\'>content</FILE>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {
				      "path": "foo.ts",
				    },
				    "kind": "open",
				    "name": "FILE",
				    "originalText": "<FILE path='foo.ts'>",
				    "type": "tag",
				  },
				  {
				    "text": "content",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "FILE",
				    "originalText": "</FILE>",
				    "type": "tag",
				  },
				]
			`);
		});
	});

	describe('streaming chunks that split mid-tag', () => {
		it('handles tag name split across chunks', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TOOL'],
				contentHandler,
			});

			await lexer.process('<TO');
			await lexer.process('OL>');
			await lexer.process('body');
			await lexer.process('</TO');
			await lexer.process('OL>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "TOOL",
				    "originalText": "<TOOL>",
				    "type": "tag",
				  },
				  {
				    "text": "body",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "TOOL",
				    "originalText": "</TOOL>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('handles angle bracket arriving alone', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['X'],
				contentHandler,
			});

			await lexer.process('a<');
			await lexer.process('X>b</');
			await lexer.process('X>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "a",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "X",
				    "originalText": "<X>",
				    "type": "tag",
				  },
				  {
				    "text": "b",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "X",
				    "originalText": "</X>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('handles character-by-character streaming', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['AB'],
				contentHandler,
			});

			const input = 'hi<AB>mid</AB>end';
			for (const char of input) {
				await lexer.process(char);
			}
			await lexer.flush();

			// Each single-char text chunk flushes individually since process()
			// flushes text at end of each call when in TEXT state.
			const tagChunks = chunks.filter(c => c.type === 'tag');
			const textContent = chunks
				.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
				.map(c => c.text)
				.join('');

			expect(tagChunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "AB",
				    "originalText": "<AB>",
				    "type": "tag",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "AB",
				    "originalText": "</AB>",
				    "type": "tag",
				  },
				]
			`);
			expect(textContent).toBe('himidend');
		});
	});

	describe('text outside known tags passed through', () => {
		it('passes unknown tags as plain text', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['KNOWN'],
				contentHandler,
			});

			await lexer.process('<UNKNOWN>text</UNKNOWN>');
			await lexer.flush();

			// The '<' causes a text flush boundary, so unrecognized tags
			// split at the '<' of the closing tag.
			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "<UNKNOWN>text",
				    "type": "text",
				  },
				  {
				    "text": "</UNKNOWN>",
				    "type": "text",
				  },
				]
			`);
		});

		it('passes HTML-like tags as text when not in tagNames', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TOOL'],
				contentHandler,
			});

			await lexer.process('Use <div> for layout');
			await lexer.flush();

			// The '<' causes a flush of preceding text, then the unknown
			// tag plus trailing text is emitted as a single text chunk.
			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "Use ",
				    "type": "text",
				  },
				  {
				    "text": "<div> for layout",
				    "type": "text",
				  },
				]
			`);
		});

		it('flushes incomplete potential tag as text', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TOOL'],
				contentHandler,
			});

			await lexer.process('start <TOO');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "start ",
				    "type": "text",
				  },
				  {
				    "text": "<TOO",
				    "type": "text",
				  },
				]
			`);
		});

		it('flushes a tag left mid-attribute-value as text', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TOOL'],
				contentHandler,
			});

			// Stream ends inside an unterminated attribute value (the
			// IN_ATTR_VALUE_DOUBLE_QUOTE state); the buffered tag start must be
			// emitted verbatim as text rather than dropped.
			await lexer.process('<TOOL attr="unclosed');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "<TOOL attr="unclosed",
				    "type": "text",
				  },
				]
			`);
		});
	});

	describe('nested tags', () => {
		it('handles nested recognized tags', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['OUTER', 'INNER'],
				contentHandler,
			});

			await lexer.process('<OUTER>before<INNER>deep</INNER>after</OUTER>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "OUTER",
				    "originalText": "<OUTER>",
				    "type": "tag",
				  },
				  {
				    "text": "before",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "INNER",
				    "originalText": "<INNER>",
				    "type": "tag",
				  },
				  {
				    "text": "deep",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "INNER",
				    "originalText": "</INNER>",
				    "type": "tag",
				  },
				  {
				    "text": "after",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "OUTER",
				    "originalText": "</OUTER>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('handles multiple sibling tags', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['A', 'B'],
				contentHandler,
			});

			await lexer.process('<A>first</A><B>second</B>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "A",
				    "originalText": "<A>",
				    "type": "tag",
				  },
				  {
				    "text": "first",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "A",
				    "originalText": "</A>",
				    "type": "tag",
				  },
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "B",
				    "originalText": "<B>",
				    "type": "tag",
				  },
				  {
				    "text": "second",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "B",
				    "originalText": "</B>",
				    "type": "tag",
				  },
				]
			`);
		});
	});

	describe('self-closing handling', () => {
		it('does not recognize self-closing syntax -- treats as text', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['BR'],
				contentHandler,
			});

			// The lexer does not support self-closing tags like <BR/>.
			// The '/' after the tag name is not a valid whitespace or '>'
			// so it falls back to text.
			await lexer.process('line1<BR/>line2');
			await lexer.flush();

			// The '<' flushes 'line1', then '/' after BR rejects the tag
			// so the rest is emitted as text.
			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "line1",
				    "type": "text",
				  },
				  {
				    "text": "<BR/>line2",
				    "type": "text",
				  },
				]
			`);
		});

		it('recognizes tag with space before closing bracket', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['TAG'],
				contentHandler,
			});

			await lexer.process('<TAG >content</TAG>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "TAG",
				    "originalText": "<TAG >",
				    "type": "tag",
				  },
				  {
				    "text": "content",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "TAG",
				    "originalText": "</TAG>",
				    "type": "tag",
				  },
				]
			`);
		});
	});

	describe('no-match reset (false-match regression)', () => {
		it('emits a tail-aligned mismatch as a single text chunk, not a fabricated tag', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['code'],
				contentHandler,
			});

			// '<xode>' shares the tail of 'code' but mismatches the first
			// char. It must be emitted as literal text, not a fabricated tag.
			await lexer.process('<xode>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "<xode>",
				    "type": "text",
				  },
				]
			`);
		});

		it('still recognizes the real tag (control)', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['code'],
				contentHandler,
			});

			await lexer.process('<code>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "code",
				    "originalText": "<code>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('passes a fully unmatched token as text (control)', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['code'],
				contentHandler,
			});

			await lexer.process('<zzzz>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "<zzzz>",
				    "type": "text",
				  },
				]
			`);
		});

		it('does not let a mid-name mismatch poison the next valid tag', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['code'],
				contentHandler,
			});

			// '<cxde>' matches 'c' then mismatches at 'x'. The reset must not
			// leave a stale tag-name index that corrupts the following '<code>'.
			await lexer.process('<cxde><code>ok</code>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "<cxde>",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "open",
				    "name": "code",
				    "originalText": "<code>",
				    "type": "tag",
				  },
				  {
				    "text": "ok",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "code",
				    "originalText": "</code>",
				    "type": "tag",
				  },
				]
			`);
		});

		it('does not let a mid-name mismatch poison the next valid close tag', async () => {
			const { chunks, contentHandler } = createCollector();
			const lexer = new StreamingTagLexer({
				tagNames: ['code'],
				contentHandler,
			});

			// Close-tag equivalent: '</cxde>' is text, then '</code>' is a
			// real close tag.
			await lexer.process('</cxde></code>');
			await lexer.flush();

			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "</cxde>",
				    "type": "text",
				  },
				  {
				    "attributes": {},
				    "kind": "close",
				    "name": "code",
				    "originalText": "</code>",
				    "type": "tag",
				  },
				]
			`);
		});
	});
});

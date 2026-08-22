/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	decodeSemanticTokens,
	encodeCellSemanticTokens,
	encodeSemanticTokens,
	IDecodedToken,
	UnionSemanticTokensLegend,
} from '../../common/quartoSemanticTokens.js';

/** A token, spelled out positionally, to keep the fixtures below readable. */
function token(line: number, startChar: number, length: number, tokenType: number, tokenModifiers = 0): IDecodedToken {
	return { line, startChar, length, tokenType, tokenModifiers };
}

describe('quartoSemanticTokens', () => {
	describe('decode and encode', () => {
		it('round-trips a stream through absolute positions', () => {
			// Two tokens on line 0, then one on line 2, so the fixture exercises
			// both a same-line delta and a line advance.
			const data = new Uint32Array([
				0, 4, 3, 1, 0,
				0, 6, 2, 2, 5,
				2, 1, 8, 3, 0,
			]);

			const decoded = decodeSemanticTokens(data);

			expect({
				decoded,
				reEncoded: Array.from(encodeSemanticTokens(decoded)),
			}).toEqual({
				decoded: [
					// The second token's startChar is 4 + 6, because a zero
					// deltaLine means deltaStartChar is relative to the token
					// before it rather than to the start of the line.
					token(0, 4, 3, 1, 0),
					token(0, 10, 2, 2, 5),
					token(2, 1, 8, 3, 0),
				],
				reEncoded: Array.from(data),
			});
		});

		it('resets deltaStartChar on a new line rather than carrying the column', () => {
			// The bug this pins: emitting `startChar - previousStartChar` on a
			// line advance. Here that would encode 2 - 9 and underflow.
			const encoded = encodeSemanticTokens([
				token(0, 9, 1, 0),
				token(1, 2, 1, 0),
			]);

			expect(Array.from(encoded)).toEqual([
				0, 9, 1, 0, 0,
				1, 2, 1, 0, 0,
			]);
		});

		it('encodes nothing for no tokens', () => {
			expect(Array.from(encodeSemanticTokens([]))).toEqual([]);
		});

		it('sorts before encoding, so an out-of-order server cannot underflow a delta', () => {
			// Deltas are unsigned. A provider that reports out of order would
			// otherwise encode a negative line delta as a huge positive one and
			// throw the rest of the document's colors far down the file.
			const encoded = encodeSemanticTokens([
				token(4, 0, 1, 0),
				token(1, 7, 1, 0),
				token(1, 2, 1, 0),
			]);

			expect(Array.from(encoded)).toEqual([
				1, 2, 1, 0, 0,
				0, 5, 1, 0, 0,
				3, 0, 1, 0, 0,
			]);
		});
	});

	describe('encodeCellSemanticTokens', () => {
		it('lifts each cell into source coordinates and joins them into one stream', () => {
			// Cell 1 holds source lines 4 to 6, cell 2 holds source lines 10 to 11,
			// so cell-relative line 0 is source line 3 and source line 9 when zero
			// indexed. The gap between the cells is prose and two fence lines.
			const encoded = encodeCellSemanticTokens([
				{
					span: { codeStartLine: 4, codeEndLine: 6 },
					tokens: [token(0, 0, 1, 0), token(2, 4, 3, 1)],
				},
				{
					span: { codeStartLine: 10, codeEndLine: 11 },
					tokens: [token(0, 2, 5, 2)],
				},
			]);

			expect(Array.from(encoded)).toEqual([
				// Source line 3, the first line of cell 1's code.
				3, 0, 1, 0, 0,
				// Two lines further down, still inside cell 1.
				2, 4, 3, 1, 0,
				// Cell 2's first line is source line 9, four lines below the
				// token before it. Getting this delta from the previous cell
				// rather than from the top of the document is the whole point.
				4, 2, 5, 2, 0,
			]);
		});

		it('drops tokens a server reported outside the cell it was asked about', () => {
			// Shifting these anyway would put them on the closing fence, in the
			// prose below it, or inside the next chunk, where they would overlap
			// that chunk's own tokens. Every other mapping across this boundary
			// rejects out-of-cell coordinates instead of clamping them.
			const encoded = encodeCellSemanticTokens([
				{
					// Two lines of code, so cell lines 0 and 1 and nothing else.
					span: { codeStartLine: 4, codeEndLine: 5 },
					tokens: [token(0, 0, 1, 0), token(2, 0, 1, 0), token(9, 0, 1, 0)],
				},
			]);

			expect(Array.from(encoded)).toEqual([3, 0, 1, 0, 0]);
		});

		it('drops every token of an empty chunk, whose span holds no lines', () => {
			// Consecutive fences give a span whose end is before its start, so
			// even cell line 0 is outside it and would land on the opening fence.
			const encoded = encodeCellSemanticTokens([
				{ span: { codeStartLine: 5, codeEndLine: 4 }, tokens: [token(0, 0, 1, 0)] },
			]);

			expect(Array.from(encoded)).toEqual([]);
		});

		it('skips cells that reported nothing', () => {
			const encoded = encodeCellSemanticTokens([
				{ span: { codeStartLine: 2, codeEndLine: 3 }, tokens: [] },
				{ span: { codeStartLine: 6, codeEndLine: 7 }, tokens: [token(1, 0, 2, 0)] },
			]);

			expect(Array.from(encoded)).toEqual([6, 0, 2, 0, 0]);
		});
	});

	describe('UnionSemanticTokensLegend', () => {
		const rLegend = { tokenTypes: ['variable', 'function'], tokenModifiers: ['declaration', 'readonly'] };
		const pythonLegend = { tokenTypes: ['function', 'class'], tokenModifiers: ['readonly', 'async'] };

		it('assigns indices in first-seen order across legends', () => {
			expect(new UnionSemanticTokensLegend([rLegend, pythonLegend]).legend).toEqual({
				// `function` and `readonly` appear in both legends and are
				// assigned once, at the index the first legend gave them.
				tokenTypes: ['variable', 'function', 'class'],
				tokenModifiers: ['declaration', 'readonly', 'async'],
			});
		});

		it('maps the same type name from two servers onto one union index', () => {
			const union = new UnionSemanticTokensLegend([rLegend, pythonLegend]);

			expect({
				fromR: union.remap(token(0, 0, 1, 1), rLegend),
				fromPython: union.remap(token(0, 0, 1, 0), pythonLegend),
			}).toEqual({
				// Index 1 in the R legend and index 0 in the Python legend are
				// both `function`, which is union index 1.
				fromR: token(0, 0, 1, 1),
				fromPython: token(0, 0, 1, 1),
			});
		});

		it('remaps modifier bits through the names they stand for', () => {
			const union = new UnionSemanticTokensLegend([rLegend, pythonLegend]);

			expect({
				// Python bits 0 and 1 are `readonly` and `async`, which are
				// union bits 1 and 2.
				bothPythonModifiers: union.remap(token(0, 0, 1, 0, 0b11), pythonLegend),
				// R bit 0 is `declaration`, which is union bit 0.
				rDeclaration: union.remap(token(0, 0, 1, 0, 0b01), rLegend),
			}).toEqual({
				bothPythonModifiers: token(0, 0, 1, 1, 0b110),
				rDeclaration: token(0, 0, 1, 0, 0b001),
			});
		});

		it('drops a token whose type is not in the union, and unknown modifier bits alone', () => {
			// A server that registered after the legend was built. Its names are
			// not in the legend the editor is holding, so there is no index that
			// would colour them correctly and the only honest answer is to leave
			// them out.
			const union = new UnionSemanticTokensLegend([rLegend]);

			expect({
				unknownType: union.remap(token(0, 0, 1, 1), pythonLegend),
				typeIndexPastEndOfLegend: union.remap(token(0, 0, 1, 7), rLegend),
				// `readonly` is in the union, `async` is not, so the token
				// survives carrying only the modifier that can be expressed.
				partiallyKnownModifiers: union.remap(token(0, 0, 1, 0, 0b11), pythonLegend),
			}).toEqual({
				unknownType: undefined,
				typeIndexPastEndOfLegend: undefined,
				// `function` is union index 1, carried over from the R legend.
				partiallyKnownModifiers: token(0, 0, 1, 1, 0b10),
			});
		});

		it('stops at 32 modifiers rather than letting a 33rd alias onto another', () => {
			// A token's modifiers are one 32-bit set and `1 << 32` is `1`, so a
			// 33rd name would come back out as the second one and colour text as
			// something it is not. The union spans every registered provider, so
			// the count can realistically get here.
			const many = Array.from({ length: 40 }, (_, index) => `mod${index}`);
			const union = new UnionSemanticTokensLegend([
				{ tokenTypes: ['variable'], tokenModifiers: many },
			]);

			expect({
				modifierCount: union.legend.tokenModifiers.length,
				lastKept: union.legend.tokenModifiers.at(-1),
				// Bit 31 is the last one that exists; the name at index 32 was
				// never given an index, so it is dropped rather than aliased.
				keptBit31: union.remap(token(0, 0, 1, 0, 1 << 31), { tokenTypes: ['variable'], tokenModifiers: many }),
			}).toEqual({
				modifierCount: 32,
				lastKept: 'mod31',
				keptBit31: token(0, 0, 1, 0, 1 << 31),
			});
		});

		it('is empty when no provider declared a legend', () => {
			// The cold start case: nothing has registered yet, so there is no
			// legend to offer and no token that could be expressed in it.
			const union = new UnionSemanticTokensLegend([]);

			expect({
				legend: union.legend,
				anyToken: union.remap(token(0, 0, 1, 0), rLegend),
			}).toEqual({
				legend: { tokenTypes: [], tokenModifiers: [] },
				anyToken: undefined,
			});
		});
	});
});

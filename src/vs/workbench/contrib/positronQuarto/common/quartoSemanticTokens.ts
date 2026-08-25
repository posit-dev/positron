/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SemanticTokensLegend } from '../../../../editor/common/languages.js';
import { cellZeroBasedLineToSource, ICellLineSpan } from './quartoCellPositionMapping.js';

/** How many numbers each token takes on the wire. */
export const FIELDS_PER_TOKEN = 5;

/**
 * How many modifier names a legend can hold, set by the wire format: a token's
 * modifiers are a single 32-bit set, so index 32 has no bit to occupy.
 *
 * Reachable here in a way it is not for a single language server, because the
 * union spans every registered provider: ten standard names, Pyrefly's six
 * custom ones, and whatever else is installed adds up.
 */
const MAX_TOKEN_MODIFIERS = 32;

/**
 * One semantic token at an absolute position, rather than as a delta from the
 * token before it.
 *
 * Positions are zero based, which is how the semantic tokens wire format counts
 * and one less than the editor's ranges elsewhere in this contribution.
 *
 * `tokenType` and `tokenModifiers` are indices into a legend, and which legend
 * decides what they mean: the same number is a different colour under a
 * different one. A token is only interpretable next to the legend it came from,
 * which is why `UnionSemanticTokensLegend.remap` takes both.
 */
export interface IDecodedToken {
	readonly line: number;
	readonly startChar: number;
	readonly length: number;
	/** Index into the legend's `tokenTypes`. */
	readonly tokenType: number;
	/** Bitset over the legend's `tokenModifiers`, one bit per index. */
	readonly tokenModifiers: number;
}

/**
 * The tokens of a single cell, in that cell's own coordinates.
 */
export interface ICellSemanticTokens {
	readonly span: ICellLineSpan;
	readonly tokens: readonly IDecodedToken[];
}

/**
 * Read a wire-format token stream into absolute positions.
 *
 * The wire format stores each token as a delta from the one before it. A
 * `deltaLine` of zero means `deltaStartChar` counts from the previous token's
 * column; anything else means it counts from the start of the line.
 */
export function decodeSemanticTokens(data: Uint32Array): IDecodedToken[] {
	const tokens: IDecodedToken[] = [];
	let line = 0;
	let startChar = 0;

	for (let offset = 0; offset + FIELDS_PER_TOKEN <= data.length; offset += FIELDS_PER_TOKEN) {
		const deltaLine = data[offset];
		const deltaStartChar = data[offset + 1];

		line += deltaLine;
		startChar = deltaLine === 0 ? startChar + deltaStartChar : deltaStartChar;

		tokens.push({
			line,
			startChar,
			length: data[offset + 2],
			tokenType: data[offset + 3],
			tokenModifiers: data[offset + 4],
		});
	}

	return tokens;
}

/**
 * Write absolute-position tokens back out as a delta-encoded stream.
 *
 * Sorts first. The deltas are unsigned, so a stream that goes backwards encodes
 * a negative delta as a very large positive one, which does not merely mislay
 * one token: every token after it inherits the error and the rest of the
 * document is coloured from positions far past its end. Language servers are
 * required to report in order and generally do, in which case this sort walks
 * already-sorted input and costs close to nothing, so the guard is worth having
 * rather than trusting every server we forward to.
 */
export function encodeSemanticTokens(tokens: readonly IDecodedToken[]): Uint32Array {
	// Copy before sorting. The caller's array is its own, and reordering it
	// under them would be a side effect of asking for an encoding.
	const sorted = tokens.slice().sort(
		(a, b) => a.line - b.line || a.startChar - b.startChar);

	const data = new Uint32Array(sorted.length * FIELDS_PER_TOKEN);
	let previousLine = 0;
	let previousStartChar = 0;

	for (let index = 0; index < sorted.length; index++) {
		const token = sorted[index];
		const deltaLine = token.line - previousLine;
		const offset = index * FIELDS_PER_TOKEN;

		data[offset] = deltaLine;
		data[offset + 1] = deltaLine === 0 ? token.startChar - previousStartChar : token.startChar;
		data[offset + 2] = token.length;
		data[offset + 3] = token.tokenType;
		data[offset + 4] = token.tokenModifiers;

		previousLine = token.line;
		previousStartChar = token.startChar;
	}

	return data;
}

/**
 * Lift every cell's tokens into source document coordinates and encode them as
 * the single stream the editor asked the Quarto document for.
 *
 * Only lines move. Columns are the same in both spaces, for the reason given in
 * `quartoCellPositionMapping`.
 */
export function encodeCellSemanticTokens(cells: readonly ICellSemanticTokens[]): Uint32Array {
	const lifted: IDecodedToken[] = [];
	for (const cell of cells) {
		// Everything else that crosses this boundary rejects coordinates outside
		// the cell rather than shifting them anyway, and so does this. A server
		// reporting a line past the end of the cell would otherwise land on the
		// closing fence, in the prose below it, or inside the next chunk, where
		// it would overlap that chunk's own tokens. An empty chunk has a span
		// that contains no lines, so nothing survives this for one.
		const lastLine = cell.span.codeEndLine - cell.span.codeStartLine;
		for (const token of cell.tokens) {
			if (token.line < 0 || token.line > lastLine) {
				continue;
			}
			lifted.push({ ...token, line: cellZeroBasedLineToSource(cell.span, token.line) });
		}
	}
	return encodeSemanticTokens(lifted);
}

/**
 * One legend covering every token name the cells' providers use, so that tokens
 * from servers that disagree about indices can share a stream.
 *
 * Each provider numbers its own legend, and the same number means different
 * things to two of them: a stream is meaningless without the legend it was
 * written against. The editor accepts one legend per provider, and this provider
 * answers for a document whose cells may hold several languages, so the indices
 * have to be translated into a legend that spans all of them.
 *
 * The union keeps every name it is given. The Quarto extension's virtual
 * document path instead remaps onto a fixed list and discards anything absent
 * from it, which today silently loses Pyrefly's `modifier` token type and all
 * six of its custom modifiers (`selfParameter`, `byteString`, `formatString`,
 * `rawString`, `stringPrefix`, `templateString`). Themes resolve the standard
 * names either way, and an unknown name simply goes uncoloured rather than
 * breaking, so keeping them costs nothing and preserving them is free detail.
 */
export class UnionSemanticTokensLegend {
	private readonly _tokenTypes = new Map<string, number>();
	private readonly _tokenModifiers = new Map<string, number>();

	readonly legend: SemanticTokensLegend;

	constructor(legends: readonly SemanticTokensLegend[]) {
		for (const legend of legends) {
			addNames(this._tokenTypes, legend.tokenTypes);
			addNames(this._tokenModifiers, legend.tokenModifiers, MAX_TOKEN_MODIFIERS);
		}
		this.legend = {
			tokenTypes: Array.from(this._tokenTypes.keys()),
			tokenModifiers: Array.from(this._tokenModifiers.keys()),
		};
	}

	/**
	 * Translate a token's indices out of the legend it was written against and
	 * into this one.
	 *
	 * Returns `undefined` when the token's type has no place here, which drops
	 * it. That happens when a provider registers after this legend was built,
	 * because the editor caches a provider's legend for the life of the provider
	 * and there is no index in the legend it is holding that would colour the
	 * new name correctly. Dropping shows the theme's plain text; inventing an
	 * index would show a colour that belongs to something else. A modifier in
	 * that position is dropped on its own instead, since the token still says
	 * something true without it.
	 */
	remap(token: IDecodedToken, sourceLegend: SemanticTokensLegend): IDecodedToken | undefined {
		const typeName = sourceLegend.tokenTypes[token.tokenType];
		if (typeName === undefined) {
			return undefined;
		}
		const tokenType = this._tokenTypes.get(typeName);
		if (tokenType === undefined) {
			return undefined;
		}

		let tokenModifiers = 0;
		const readableBits = Math.min(sourceLegend.tokenModifiers.length, MAX_TOKEN_MODIFIERS);
		for (let bit = 0; bit < readableBits; bit++) {
			if ((token.tokenModifiers & (1 << bit)) === 0) {
				continue;
			}
			const index = this._tokenModifiers.get(sourceLegend.tokenModifiers[bit]);
			if (index !== undefined) {
				tokenModifiers |= 1 << index;
			}
		}

		return { ...token, tokenType, tokenModifiers };
	}
}

/**
 * Number each name the first time it is seen, keeping earlier indices stable.
 *
 * `limit` caps how many names are taken. Names past it are left out, which drops
 * the modifiers that would have used them, and dropping is the only safe answer:
 * a token's modifiers are one 32-bit set, and `1 << 32` is `1` in JavaScript, so
 * a 33rd modifier would not be lost quietly but would come back out as the
 * second one and colour text as something it is not.
 */
function addNames(indices: Map<string, number>, names: readonly string[], limit = Infinity): void {
	for (const name of names) {
		if (indices.size >= limit) {
			return;
		}
		if (!indices.has(name)) {
			indices.set(name, indices.size);
		}
	}
}

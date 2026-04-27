/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Splits markdown text into translatable and non-translatable segments.
 *
 * Non-translatable segments (preserved verbatim):
 * - Fenced code blocks (``` ... ```)
 * - LaTeX environments (\begin{...}...\end{...})
 * - Block math ($$...$$)
 * - Inline code (`...`)
 * - Inline math ($...$)
 * - Markdown images (![alt](url))
 * - Markdown link URLs (the (url) part of [text](url))
 * - Bare URLs (http:// and https://)
 * - Heading prefixes (# through ######)
 * - List item markers (-, *, +, 1.)
 *
 * This avoids inline placeholders entirely, which translation APIs corrupt.
 */

export interface Segment {
	readonly text: string;
	readonly translatable: boolean;
}

// Multi-line patterns extracted first (before line splitting).
const BLOCK_PATTERNS: RegExp[] = [
	// Fenced code blocks (``` or ~~~, with optional language tag)
	/^(```|~~~)[^\n]*\n[\s\S]*?\n\1\s*$/gm,
	// LaTeX environments
	/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g,
	// Block math
	/\$\$[\s\S]+?\$\$/g,
];

// Inline patterns applied per-line after block extraction.
const INLINE_PATTERN = new RegExp(
	[
		/`[^`\n]+`/.source,
		/(?<![\\$])\$(?!\$)(?!\s)[^$\n]+?(?<!\s)\$/.source,
		/!\[[^\]]*\]\([^)]+\)/.source,
		/\]\([^)]+\)/.source,
		/https?:\/\/[^\s)\]>]+/.source,
	].join('|'),
	'g'
);

const HEADING_PREFIX = /^(#{1,6}\s)/;
const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)]) )/;

/**
 * Splits markdown source into an array of segments, each marked as
 * translatable or not. Reassembling all segment texts reproduces the
 * original source exactly.
 */
export function splitMarkdown(source: string): Segment[] {
	// Phase 1: Extract multi-line blocks as non-translatable
	const phase1 = extractBlocks(source);

	// Phase 2: For each translatable chunk, split into lines and handle
	// headings, list markers, and inline non-translatable spans
	const segments: Segment[] = [];
	for (const chunk of phase1) {
		if (!chunk.translatable) {
			segments.push(chunk);
		} else {
			splitLineByLine(chunk.text, segments);
		}
	}

	return segments;
}

function extractBlocks(source: string): Segment[] {
	const regions: { start: number; end: number }[] = [];

	for (const pattern of BLOCK_PATTERNS) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(source)) !== null) {
			regions.push({ start: match.index, end: match.index + match[0].length });
		}
	}

	if (regions.length === 0) {
		return [{ text: source, translatable: true }];
	}

	// Sort by start position and merge overlaps
	regions.sort((a, b) => a.start - b.start);
	const merged: { start: number; end: number }[] = [regions[0]];
	for (let i = 1; i < regions.length; i++) {
		const last = merged[merged.length - 1];
		if (regions[i].start <= last.end) {
			last.end = Math.max(last.end, regions[i].end);
		} else {
			merged.push(regions[i]);
		}
	}

	const segments: Segment[] = [];
	let pos = 0;
	for (const region of merged) {
		if (region.start > pos) {
			segments.push({ text: source.slice(pos, region.start), translatable: true });
		}
		segments.push({ text: source.slice(region.start, region.end), translatable: false });
		pos = region.end;
	}
	if (pos < source.length) {
		segments.push({ text: source.slice(pos), translatable: true });
	}

	return segments;
}

function splitLineByLine(text: string, segments: Segment[]): void {
	const lines = text.split('\n');

	for (let i = 0; i < lines.length; i++) {
		if (i > 0) {
			segments.push({ text: '\n', translatable: false });
		}
		splitSingleLine(lines[i], segments);
	}
}

function splitSingleLine(line: string, segments: Segment[]): void {
	let remaining = line;

	// Strip heading prefix
	const headingMatch = remaining.match(HEADING_PREFIX);
	if (headingMatch) {
		segments.push({ text: headingMatch[1], translatable: false });
		remaining = remaining.slice(headingMatch[1].length);
	}

	// Strip list marker
	const listMatch = remaining.match(LIST_MARKER);
	if (listMatch) {
		segments.push({ text: listMatch[1], translatable: false });
		remaining = remaining.slice(listMatch[1].length);
	}

	if (!remaining) {
		return;
	}

	// Split on inline non-translatable spans
	INLINE_PATTERN.lastIndex = 0;
	let lastEnd = 0;
	let match: RegExpExecArray | null;

	while ((match = INLINE_PATTERN.exec(remaining)) !== null) {
		if (match.index > lastEnd) {
			segments.push({ text: remaining.slice(lastEnd, match.index), translatable: true });
		}
		segments.push({ text: match[0], translatable: false });
		lastEnd = match.index + match[0].length;
	}

	if (lastEnd < remaining.length) {
		segments.push({ text: remaining.slice(lastEnd), translatable: true });
	}
}

/**
 * Reassembles segments back into a string.
 */
export function reassemble(segments: Segment[]): string {
	return segments.map(s => s.text).join('');
}

/**
 * Extracts only the translatable text from segments, joining with newlines
 * so that translation APIs receive a contiguous block of prose.
 * Returns the indices of translatable segments for reconstruction.
 */
export function extractTranslatable(segments: Segment[]): {
	text: string;
	indices: number[];
} {
	const indices: number[] = [];
	const texts: string[] = [];

	for (let i = 0; i < segments.length; i++) {
		if (segments[i].translatable && segments[i].text.trim()) {
			indices.push(i);
			texts.push(segments[i].text);
		}
	}

	return { text: texts.join('\n'), indices };
}

/**
 * Applies translated text back into the segments array, returning a new
 * segments array with translatable segments replaced.
 */
export function applyTranslated(
	segments: Segment[],
	translatedText: string,
	indices: number[],
): Segment[] {
	const translatedParts = translatedText.split('\n');
	const result = [...segments];

	for (let i = 0; i < indices.length && i < translatedParts.length; i++) {
		result[indices[i]] = { text: translatedParts[i], translatable: true };
	}

	return result;
}

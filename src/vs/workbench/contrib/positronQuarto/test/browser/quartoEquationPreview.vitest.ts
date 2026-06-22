/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Import the real KaTeX module so the rendering test exercises actual KaTeX
// output rather than a stub. The runtime loads KaTeX lazily via
// `importAMDNodeModule`, which has no module URI to resolve under vitest, so a
// direct import is the only way to drive the real renderer here.
// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module -- test needs the real katex module; AMD loader is unavailable in vitest
import katex from 'katex';
import { findDisplayMathBlocks, renderDisplayMath } from '../../browser/quartoEquationPreview.js';

/**
 * High-level tests of the equation-preview feature's detection/extraction. This
 * is the core of "render display equations that update as edited": it determines
 * which `$$ ... $$` blocks become inline previews, where each preview is placed
 * (the closing-`$$` line), and the LaTeX that gets rendered.
 */
describe('findDisplayMathBlocks', () => {
	function find(doc: string) {
		return findDisplayMathBlocks(doc.split('\n'));
	}

	it('detects a single-line display equation', () => {
		expect(find('Intro\n$$E = mc^2$$\nOutro')).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 2,
			    "latex": "E = mc^2",
			  },
			]
		`);
	});

	it('detects a multi-line display equation, placing the preview after the closing $$', () => {
		expect(find('$$\na^2 + b^2 = c^2\n$$')).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 3,
			    "latex": "a^2 + b^2 = c^2",
			  },
			]
		`);
	});

	it('ignores a trailing Quarto equation label on the closing line', () => {
		expect(find('$$\nx = y\n$$ {#eq-foo}')).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 3,
			    "latex": "x = y",
			  },
			]
		`);
	});

	it('ignores $$ inside fenced code blocks', () => {
		const doc = [
			'```python',
			'print("$$not math$$")',
			'```',
			'$$ real $$',
		].join('\n');
		expect(find(doc)).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 4,
			    "latex": "real",
			  },
			]
		`);
	});

	it('ignores inline $...$ math', () => {
		expect(find('The value $x$ is inline and $y = 2$ too.')).toMatchInlineSnapshot(`[]`);
	});

	it('detects multiple display equations in one document', () => {
		const doc = [
			'$$ a = 1 $$',
			'',
			'$$',
			'b = 2',
			'$$',
		].join('\n');
		expect(find(doc)).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 1,
			    "latex": "a = 1",
			  },
			  {
			    "closingLineNumber": 5,
			    "latex": "b = 2",
			  },
			]
		`);
	});

	it('does not treat YAML front matter delimiters as math', () => {
		const doc = [
			'---',
			'title: "Doc"',
			'format: html',
			'---',
			'$$ z = 0 $$',
		].join('\n');
		expect(find(doc)).toMatchInlineSnapshot(`
			[
			  {
			    "closingLineNumber": 5,
			    "latex": "z = 0",
			  },
			]
		`);
	});

	it('ignores empty equations and unterminated blocks', () => {
		expect(find('$$$$\n\n$$\nstill open')).toMatchInlineSnapshot(`[]`);
	});
});

/**
 * The detection tests above prove an equation is *found*; this proves a found
 * equation is actually *rendered*. It drives the same render path the view zone
 * uses (`renderDisplayMath`) with the real KaTeX module, so it fails if the
 * equation is detected but the rendering step produces no markup (e.g. the
 * container is left with the raw LaTeX text fallback instead of rendered math).
 */
describe('renderDisplayMath', () => {
	it('renders a detected display equation into KaTeX markup, not raw text', () => {
		const blocks = findDisplayMathBlocks(['$$', 'E = mc^2', '$$']);
		const latex = blocks[0].latex;

		const container = document.createElement('div');
		renderDisplayMath(container, katex, latex);

		// Rendered math produces element children (a `.katex` tree); the
		// "detected but not rendered" fallback would set raw text with no
		// element children.
		expect(container.childElementCount).toBeGreaterThan(0);
		expect(container.innerHTML).toContain('katex');
	});
});

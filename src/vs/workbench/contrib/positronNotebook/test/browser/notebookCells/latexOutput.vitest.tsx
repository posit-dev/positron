/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { LatexOutput } from '../../../browser/notebookCells/LatexOutput.js';

vi.mock('../../../../../../amdX.js', () => ({
	importAMDNodeModule: vi.fn().mockResolvedValue({
		renderToString: (latex: string, opts: { displayMode: boolean; throwOnError: boolean }) => {
			return `<span class="katex">${latex}</span>`;
		}
	}),
	resolveAmdNodeModulePath: vi.fn().mockReturnValue(''),
}));

vi.mock('../../../../markdown/browser/markedKatexSupport.js', () => ({
	MarkedKatexSupport: {
		ensureKatexStyles: vi.fn(),
		getSanitizerOptions: () => ({
			allowedTags: { override: [] },
			allowedAttributes: { override: [] },
		}),
	}
}));

describe('LatexOutput', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a container with the latex-output class', () => {
		const { container } = rtl.render(<LatexOutput content='E = mc^2' />);
		// eslint-disable-next-line no-restricted-syntax
		expect(container.querySelector('.positron-notebook-latex-output')).toBeInTheDocument();
	});

	it('renders KaTeX content after async load', async () => {
		rtl.render(<LatexOutput content='$E = mc^2$' />);
		const output = await screen.findByText('E = mc^2');
		expect(output).toBeInTheDocument();
	});

	it('renders raw LaTeX environments', async () => {
		const latex = '\\begin{align} a &= b \\end{align}';
		rtl.render(<LatexOutput content={latex} />);
		const output = await screen.findByText(latex);
		expect(output).toBeInTheDocument();
	});
});

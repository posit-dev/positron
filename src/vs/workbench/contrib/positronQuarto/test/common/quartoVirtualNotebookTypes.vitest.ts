/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { quartoNotebookUri } from '../../common/quartoVirtualNotebookTypes.js';

describe('quartoNotebookUri', () => {
	it('swaps the scheme and appends .ipynb, keeping authority, query, and fragment', () => {
		const cases = [
			URI.file('/home/u/report.qmd'),
			URI.file('/home/u/report.Rmd'),
			URI.from({ scheme: 'untitled', path: 'Untitled-1' }),
			URI.from({ scheme: 'untitled', path: 'Untitled-1.qmd' }),
			URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+host', path: '/home/u/a.qmd' }),
		];

		expect(cases.map(uri => quartoNotebookUri(uri).toString())).toEqual([
			'quarto-cells:/home/u/report.qmd.ipynb',
			'quarto-cells:/home/u/report.Rmd.ipynb',
			'quarto-cells:Untitled-1.qmd.ipynb',
			'quarto-cells:Untitled-1.qmd.ipynb',
			'quarto-cells://ssh-remote%2Bhost/home/u/a.qmd.ipynb',
		]);
	});
});

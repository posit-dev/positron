/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { CellOutput } from '../../../browser/notebookCells/NotebookCodeCell.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';

/**
 * Coverage for the html branch of CellOutput: relative <img> sources inside
 * IPython.display.HTML output must resolve against the notebook's directory
 * via DeferredImage (#10473) instead of the workbench base URL.
 */
describe('CellOutput html branch', () => {
	const executeCommand = vi.fn(async (command: string) => {
		if (command === 'positronNotebookHelpers.convertImageToBase64') {
			return 'data:image/png;base64,converted';
		}
		return undefined;
	});

	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderHtmlOutput(html: string) {
		const instance = stubInterface<IPositronNotebookInstance>({
			uri: URI.file('/notebooks/notebook.ipynb'),
		});

		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellOutput
					outputId='output-1'
					outputScrolling={false}
					outputs={[{ mime: 'text/html', data: VSBuffer.fromString(html) }]}
					parsed={{ type: 'html', content: html }}
					onShowFullOutput={() => { }}
				/>
			</NotebookInstanceProvider>
		);
	}

	it('resolves relative img sources against the notebook directory', async () => {
		renderHtmlOutput('<img src="test.png" width="400">');

		// DeferredImage converts the relative path through the
		// positronNotebookHelpers extension and swaps in the data URL.
		await waitFor(() => {
			expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,converted');
		});
		expect(executeCommand).toHaveBeenCalledWith(
			'positronNotebookHelpers.convertImageToBase64', 'test.png', '/notebooks');
	});

	it('renders plain fragments without invoking image conversion', () => {
		renderHtmlOutput('<p>Hello world</p>');

		expect(screen.getByText('Hello world')).toBeInTheDocument();
		expect(executeCommand).not.toHaveBeenCalled();
	});
});

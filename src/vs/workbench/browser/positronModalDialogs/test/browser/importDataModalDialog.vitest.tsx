/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IDataImporter, IDataImportRequest, IDataImportResult } from '../../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
import { ImportDataModalDialog } from '../../importDataModalDialog.js';

describe('ImportDataModalDialog', () => {
	const ctx = createTestContainer()
		.withReactServices()
		// The preview renders a real Monaco code editor (EditableCodeEditor), whose view needs
		// IUserInteractionService to create its DOM focus tracker. Use the real implementation so it
		// wires up to genuine jsdom focus/blur events.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// jsdom never computes layout, so Monaco's container measures 0x0 and renders no view-lines
	// (they are outside a zero-height viewport). Give every element a real size so the editor lays
	// out and its text becomes queryable, matching what a real browser gives the container's CSS.
	beforeEach(() => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 660, height: 260, top: 0, left: 0, right: 660, bottom: 260, x: 0, y: 0, toJSON: () => ({}),
		});
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(260);
	});

	const renderer = stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None, dispose: vi.fn() });

	const fileUri = URI.file('/Users/austin/data/flights.csv');

	function createImporter(overrides: Partial<IDataImporter> = {}): IDataImporter {
		return {
			languageId: 'python',
			displayName: 'Python (pandas)',
			fileExtensions: ['csv', 'tsv'],
			generateCode: async (request: IDataImportRequest) => ({
				code: `${request.variableName} = pd.read_csv("${request.fileUri.fsPath}")\n`,
			}),
			...overrides,
		};
	}

	// Monaco splits a rendered line's text across nested spans (one per token), and every ancestor up
	// to the view-lines container also reports the matching text via textContent, so the match is
	// restricted to a leaf node (the token span itself). Monaco also renders regular spaces as U+00A0
	// (non-breaking space) rather than U+0020, which the pattern's literal spaces would not match.
	function codeTextMatching(pattern: RegExp) {
		return (_: string, element: Element | null) =>
			element?.children.length === 0
			&& pattern.test((element?.textContent ?? '').replace(/\u00A0/g, ' '));
	}

	function renderDialog(importers: readonly IDataImporter[], preferredLanguageId?: string) {
		rtl.render(
			<ImportDataModalDialog
				fileUri={fileUri}
				importers={importers}
				options={{ hasHeaderRow: true }}
				preferredLanguageId={preferredLanguageId}
				renderer={renderer}
			/>
		);
	}

	it('seeds the variable name field from the file name', async () => {
		renderDialog([createImporter()]);

		expect(await screen.findByLabelText('Variable Name')).toHaveValue('flights');
	});

	it('names the only importer and selects it', async () => {
		renderDialog([createImporter()]);

		expect(await screen.findByRole('option', { name: 'Python (pandas)' })).toHaveAttribute('aria-selected', 'true');
	});

	it('generates code for the selected importer and variable name', async () => {
		renderDialog([createImporter()]);

		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();
		expect(screen.getByText(codeTextMatching(/flights = /))).toBeInTheDocument();
	});

	it('regenerates when the user renames the variable', async () => {
		const user = userEvent.setup();
		renderDialog([createImporter()]);
		const nameInput = await screen.findByLabelText('Variable Name');

		await user.clear(nameInput);
		await user.type(nameInput, 'df');

		expect(await screen.findByText(codeTextMatching(/df = /))).toBeInTheDocument();
	});

	it('rejects a name that is not a valid identifier', async () => {
		const user = userEvent.setup();
		renderDialog([createImporter()]);
		const nameInput = await screen.findByLabelText('Variable Name');

		await user.clear(nameInput);
		await user.type(nameInput, '2020 data');

		expect(await screen.findByText('Enter a valid variable name.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('preselects the importer matching the foreground session language', async () => {
		const r = createImporter({ languageId: 'r', displayName: 'R (readr)' });
		renderDialog([createImporter(), r], 'r');

		expect(await screen.findByRole('option', { name: 'R (readr)' })).toHaveAttribute('aria-selected', 'true');
	});

	it('regenerates when the user picks a different importer', async () => {
		const user = userEvent.setup();
		const r = createImporter({
			languageId: 'r',
			displayName: 'R (readr)',
			generateCode: async (request: IDataImportRequest) => ({ code: `${request.variableName} <- read_csv()\n` }),
		});
		renderDialog([createImporter(), r]);

		await user.click(await screen.findByRole('option', { name: 'R (readr)' }));

		expect(await screen.findByText(codeTextMatching(/read_csv\(\)/))).toBeInTheDocument();
	});

	it('withholds the previous code while the new inputs are still generating', async () => {
		const user = userEvent.setup();
		const r = createImporter({
			languageId: 'r',
			displayName: 'R (readr)',
			// Never settles, so the test observes the window while generation is in flight.
			generateCode: () => new Promise<IDataImportResult>(() => { }),
		});
		renderDialog([createImporter(), r]);
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();

		await user.click(screen.getByRole('option', { name: 'R (readr)' }));

		expect(screen.queryByText(codeTextMatching(/pd\.read_csv/))).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('drops a generation failure once the name is no longer the one that failed', async () => {
		const user = userEvent.setup();
		renderDialog([createImporter({
			generateCode: async () => { throw new Error('importer exploded'); },
		})]);
		expect(await screen.findByRole('alert')).toHaveTextContent('importer exploded');

		const nameInput = screen.getByLabelText('Variable Name');
		await user.clear(nameInput);
		await user.type(nameInput, '2020 data');

		expect(await screen.findByText('Enter a valid variable name.')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('explains itself when the importer declines to generate any code', async () => {
		renderDialog([createImporter({ generateCode: async () => undefined })]);

		expect(await screen.findByRole('alert')).toHaveTextContent('Python (pandas) did not generate import code for this file.');
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('shows an empty state when no importer can read the file', () => {
		renderDialog([]);

		expect(screen.getByText('No extension can generate code to import this file.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('warns about anything the importer could not translate', async () => {
		renderDialog([createImporter({
			generateCode: async () => ({ code: 'x = 1\n', unsupported: ['Filter on column "dep_delay"'] }),
		})]);

		expect(await screen.findByRole('alert')).toHaveTextContent('Filter on column "dep_delay"');
	});

	it('shows no warning when the importer translated everything', async () => {
		renderDialog([createImporter({
			generateCode: async () => ({ code: 'x = 1\n', unsupported: [] }),
		})]);
		expect(await screen.findByText(codeTextMatching(/x = 1/))).toBeInTheDocument();

		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		// An empty `unsupported` array must not leak its length into the dialog as a stray "0".
		expect(screen.queryByText('0')).not.toBeInTheDocument();
	});

	it('copies the generated code to the clipboard and leaves the dialog open', async () => {
		const user = userEvent.setup();
		const writeText = vi.fn();
		ctx.instantiationService.stub(IClipboardService, { writeText });
		renderDialog([createImporter()]);
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Copy' }));

		expect(writeText).toHaveBeenCalledWith(expect.stringContaining('flights = pd.read_csv'));
		expect(renderer.dispose).not.toHaveBeenCalled();
	});

	it('runs the generated code in the console and opens no editor', async () => {
		const user = userEvent.setup();
		const executeCode = vi.fn();
		const openEditor = vi.fn();
		ctx.instantiationService.stub(IPositronConsoleService, { executeCode });
		ctx.instantiationService.stub(IEditorService, { openEditor });
		renderDialog([createImporter()]);
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Import' }));

		expect(executeCode).toHaveBeenCalledWith(
			'python',
			undefined,
			expect.stringContaining('flights = pd.read_csv'),
			expect.objectContaining({ source: 'interactive' }),
			true
		);
		expect(openEditor).not.toHaveBeenCalled();
	});

	// Enter in the name field reaches Import as the form's implicit submit target, which the
	// dialog delivers as a click on that button rather than a form submit event.
	it('runs the code when the user presses Enter in the variable name field', async () => {
		const user = userEvent.setup();
		const executeCode = vi.fn();
		ctx.instantiationService.stub(IPositronConsoleService, { executeCode });
		renderDialog([createImporter()]);
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();

		await user.type(screen.getByLabelText('Variable Name'), '{Enter}');

		expect(executeCode).toHaveBeenCalledTimes(1);
		expect(executeCode).toHaveBeenCalledWith(
			'python',
			undefined,
			expect.stringContaining('flights = pd.read_csv'),
			expect.objectContaining({ source: 'interactive' }),
			true
		);
	});

	it('ignores Enter while the variable name is invalid', async () => {
		const user = userEvent.setup();
		const executeCode = vi.fn();
		ctx.instantiationService.stub(IPositronConsoleService, { executeCode });
		renderDialog([createImporter()]);
		const nameInput = await screen.findByLabelText('Variable Name');

		await user.clear(nameInput);
		await user.type(nameInput, '2020 data{Enter}');

		expect(executeCode).not.toHaveBeenCalled();
	});
});

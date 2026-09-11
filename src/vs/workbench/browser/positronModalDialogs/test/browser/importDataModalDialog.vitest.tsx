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
import { IDataImporter, IDataImportRequest, IDataImportResult, IDataImportView } from '../../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
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
			reservedNames: ['class', 'import'],
			generateCode: async (request: IDataImportRequest) => ({
				code: `${request.variableName} = pd.read_csv("${request.fileUri.fsPath}")\n`,
			}),
			...overrides,
		};
	}

	// Shaped like the list the readr importer registers, so the tests exercise a genuinely
	// different language's reserved words rather than a copy of Python's.
	const R_RESERVED_NAMES = ['if', 'TRUE', 'NA'];

	// Monaco splits a rendered line's text across nested spans (one per token), and every ancestor up
	// to the view-lines container also reports the matching text via textContent, so the match is
	// restricted to a leaf node (the token span itself). Monaco also renders regular spaces as U+00A0
	// (non-breaking space) rather than U+0020, which the pattern's literal spaces would not match.
	function codeTextMatching(pattern: RegExp) {
		return (_: string, element: Element | null) =>
			element?.children.length === 0
			&& pattern.test((element?.textContent ?? '').replace(/\u00A0/g, ' '));
	}

	const sortOnlyView: IDataImportView = {
		rowFilters: [],
		sortKeys: [{ columnName: 'dep_delay', ascending: false }],
	};

	function renderDialog(
		importers: readonly IDataImporter[],
		preferredLanguageId?: string,
		uri: URI = fileUri,
		view?: IDataImportView
	) {
		rtl.render(
			<ImportDataModalDialog
				fileUri={uri}
				importers={importers}
				options={{ hasHeaderRow: true }}
				preferredLanguageId={preferredLanguageId}
				renderer={renderer}
				view={view}
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

	it('generates with a name the language cannot assign to rather than blocking it', async () => {
		const user = userEvent.setup();
		const executeCode = vi.fn();
		ctx.instantiationService.stub(IPositronConsoleService, { executeCode });
		renderDialog([createImporter()]);
		const nameInput = await screen.findByLabelText('Variable Name');

		await user.clear(nameInput);
		await user.type(nameInput, '2020 data');
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Import' }));

		// The dialog does not validate the name. The user gets the code they asked for, and the
		// syntax error (if any) surfaces in the console where they can see and fix it.
		expect(executeCode).toHaveBeenCalledWith(
			'python',
			undefined,
			expect.stringContaining('2020 data = pd.read_csv'),
			expect.objectContaining({ source: 'interactive' }),
			true,
			true
		);
	});

	it('falls back to the derived name when the field is emptied', async () => {
		const user = userEvent.setup();
		renderDialog([createImporter()]);
		const nameInput = await screen.findByLabelText('Variable Name');

		await user.clear(nameInput);

		// The field is left as the user left it, but the preview shows what Import would run now,
		// rather than a statement with no left-hand side.
		expect(nameInput).toHaveValue('');
		expect(await screen.findByText(codeTextMatching(/flights = /))).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
	});

	it('re-derives an untouched default name when the package changes', async () => {
		const user = userEvent.setup();
		const r = createImporter({ languageId: 'r', displayName: 'R (readr)', reservedNames: R_RESERVED_NAMES });
		renderDialog([createImporter(), r], undefined, URI.file('/Users/austin/data/class.csv'));
		// 'class' is reserved in Python, so the default is suffixed; R assigns to it happily.
		expect(await screen.findByLabelText('Variable Name')).toHaveValue('class_');

		await user.click(screen.getByRole('option', { name: 'R (readr)' }));

		expect(await screen.findByLabelText('Variable Name')).toHaveValue('class');
	});

	it('keeps an edited name when the package changes', async () => {
		const user = userEvent.setup();
		const r = createImporter({ languageId: 'r', displayName: 'R (readr)', reservedNames: R_RESERVED_NAMES });
		renderDialog([createImporter(), r]);
		const nameInput = await screen.findByLabelText('Variable Name');
		await user.clear(nameInput);
		await user.type(nameInput, 'df');

		await user.click(screen.getByRole('option', { name: 'R (readr)' }));

		expect(screen.getByLabelText('Variable Name')).toHaveValue('df');
	});

	it('preselects the importer matching the foreground session language', async () => {
		const r = createImporter({ languageId: 'r', displayName: 'R (readr)', reservedNames: R_RESERVED_NAMES });
		renderDialog([createImporter(), r], 'r');

		expect(await screen.findByRole('option', { name: 'R (readr)' })).toHaveAttribute('aria-selected', 'true');
	});

	it('regenerates when the user picks a different importer', async () => {
		const user = userEvent.setup();
		const r = createImporter({
			languageId: 'r',
			displayName: 'R (readr)',
			reservedNames: R_RESERVED_NAMES,
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
			reservedNames: R_RESERVED_NAMES,
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
			generateCode: async (request: IDataImportRequest) => {
				if (request.variableName === 'flights') {
					throw new Error('importer exploded');
				}
				return { code: `${request.variableName} = pd.read_csv()\n` };
			},
		})]);
		expect(await screen.findByRole('alert')).toHaveTextContent('importer exploded');

		const nameInput = screen.getByLabelText('Variable Name');
		await user.clear(nameInput);
		await user.type(nameInput, 'df');

		expect(await screen.findByText(codeTextMatching(/df = /))).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('explains itself when the importer declines to generate any code', async () => {
		renderDialog([createImporter({ generateCode: async () => undefined })]);

		expect(await screen.findByRole('alert')).toHaveTextContent('Python (pandas) did not generate import code for this file.');
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('shows no filters-and-sorts checkbox when the view is empty', async () => {
		renderDialog([createImporter()]);

		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();
		expect(screen.queryByRole('checkbox', { name: 'Include current filters and sorts (experimental)' })).not.toBeInTheDocument();
	});

	it('offers the checkbox unchecked and generates without the view by default', async () => {
		const requests: IDataImportRequest[] = [];
		const importer = createImporter({
			generateCode: async (request: IDataImportRequest) => {
				requests.push(request);
				return { code: `${request.variableName} = pd.read_csv(...)\n` };
			},
		});
		renderDialog([importer], undefined, fileUri, sortOnlyView);

		expect(await screen.findByRole('checkbox', { name: 'Include current filters and sorts (experimental)' })).not.toBeChecked();
		expect(await screen.findByText(codeTextMatching(/pd\.read_csv/))).toBeInTheDocument();
		expect(requests.at(-1)?.view).toBeUndefined();
	});

	it('includes the view in generation while checked and drops it when unchecked again', async () => {
		const user = userEvent.setup();
		const requests: IDataImportRequest[] = [];
		const importer = createImporter({
			generateCode: async (request: IDataImportRequest) => {
				requests.push(request);
				return { code: `x = ${requests.length}\n` };
			},
		});
		renderDialog([importer], undefined, fileUri, sortOnlyView);
		const checkbox = await screen.findByRole('checkbox', { name: 'Include current filters and sorts (experimental)' });

		await user.click(checkbox);
		expect(await screen.findByText(codeTextMatching(/x = 2/))).toBeInTheDocument();
		expect(requests.at(-1)?.view).toEqual(sortOnlyView);

		await user.click(checkbox);
		expect(await screen.findByText(codeTextMatching(/x = 3/))).toBeInTheDocument();
		expect(requests.at(-1)?.view).toBeUndefined();
	});

	it('warns about anything the importer reported as unsupported', async () => {
		const user = userEvent.setup();
		const importer = createImporter({
			generateCode: async () => ({
				code: 'x = 1\n',
				unsupported: ['filter on "carrier" (regex_match)'],
			}),
		});
		renderDialog([importer], undefined, fileUri, sortOnlyView);

		await user.click(await screen.findByRole('checkbox', { name: 'Include current filters and sorts (experimental)' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Not included in the generated code: filter on "carrier" (regex_match)'
		);
	});

	it('shows an empty state when no importer can read the file', () => {
		renderDialog([]);

		expect(screen.getByText('No extension can generate code to import this file.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
	});

	it('narrows the dialog for the empty state', () => {
		renderDialog([]);

		expect(screen.getByRole('dialog')).toHaveStyle({ width: '450px' });
	});

	it('keeps the dialog wide when an importer can read the file', () => {
		renderDialog([createImporter()]);

		expect(screen.getByRole('dialog')).toHaveStyle({ width: '800px' });
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
			true,
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
			true,
			true
		);
	});

	it('ignores Enter while there is no generated code to run', async () => {
		const user = userEvent.setup();
		const executeCode = vi.fn();
		ctx.instantiationService.stub(IPositronConsoleService, { executeCode });
		// Never settles, so Enter arrives while the first generation is still in flight.
		renderDialog([createImporter({ generateCode: () => new Promise<IDataImportResult>(() => { }) })]);

		await user.type(await screen.findByLabelText('Variable Name'), '{Enter}');

		expect(executeCode).not.toHaveBeenCalled();
	});
});

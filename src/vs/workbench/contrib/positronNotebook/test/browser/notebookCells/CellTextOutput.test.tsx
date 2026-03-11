/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import { flushSync } from 'react-dom';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { TestCommandService } from '../../../../../../editor/test/browser/editorTestServices.js';
import { NotebookOptions, NotebookOptionsChangeEvent } from '../../../../notebook/browser/notebookOptions.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { PositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';
import { CellTextOutput, LongOutputOptions } from '../../../browser/notebookCells/CellTextOutput.js';
import { ParsedTextOutput } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

class CellTextOutputFixture {
	constructor(private readonly container: HTMLElement) { }

	get outputContainer() {
		const el = this.container.querySelector<HTMLDivElement>('.positron-notebook-text-output');
		assert.ok(el, 'Expected output container to exist');
		return el;
	}

	get outputLines() {
		return this.outputContainer.querySelectorAll<HTMLDivElement>(':scope > div');
	}

	get truncationMessage() {
		return this.container.querySelector<HTMLElement>('.notebook-output-truncation-message');
	}

	get settingsLink() {
		return this.container.querySelector<HTMLAnchorElement>('.notebook-output-truncation-message a');
	}

	get quickFixContainer() {
		return this.container.querySelector<HTMLElement>('.notebook-cell-quick-fix');
	}

	get outputRuns() {
		return this.outputContainer.querySelectorAll<HTMLSpanElement>('span.output-run');
	}

	hasClass(cls: string) {
		return this.outputContainer.classList.contains(cls);
	}
}

/** Generate multiline content with the given number of lines. */
function makeLines(n: number): string {
	return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

suite('CellTextOutput', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let optionsEmitter: Emitter<NotebookOptionsChangeEvent>;
	let layoutConfig: LongOutputOptions;
	let commandService: TestCommandService;
	let configurationService: TestConfigurationService;
	let contextKeyService: MockContextKeyService;

	setup(() => {
		optionsEmitter = disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false };

		const instantiationService = disposables.add(new TestInstantiationService());
		commandService = new TestCommandService(instantiationService);

		configurationService = new TestConfigurationService();
		contextKeyService = disposables.add(new MockContextKeyService());
	});

	function renderCellTextOutput(
		props: ParsedTextOutput,
		options?: Partial<LongOutputOptions>,
	) {
		if (options !== undefined) {
			layoutConfig = { ...layoutConfig, ...options };
		}
		const notebookOptions = {
			onDidChangeOptions: optionsEmitter.event,
			getLayoutConfiguration: () => layoutConfig,
		} as unknown as NotebookOptions;
		const instance = { notebookOptions } as unknown as IPositronNotebookInstance;
		const services = {
			commandService,
			configurationService,
			contextKeyService,
		} as unknown as PositronReactServices;

		const container = render(
			<PositronReactServicesContext.Provider value={services}>
				<NotebookInstanceProvider instance={instance}>
					<CellTextOutput {...props} />
				</NotebookInstanceProvider>
			</PositronReactServicesContext.Provider>
		);
		return new CellTextOutputFixture(container);
	}

	test('renders short output', () => {
		const fixture = renderCellTextOutput({ content: 'hello world', type: 'stdout' });

		assert.ok(fixture.outputContainer.textContent?.includes('hello world'), 'Expected content');
		assert.strictEqual(fixture.truncationMessage, null, 'Expected no truncation message');
		assert.strictEqual(fixture.quickFixContainer, null, 'Expected no quick-fix');
	});

	test('renders error output with quick-fix', () => {
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positron-assistant.hasChatModels', true);

		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		assert.ok(fixture.hasClass('notebook-error'), 'Expected error class');
		assert.ok(fixture.quickFixContainer, 'Expected quick-fix container for error output');
	});

	test('does not render quick-fix for errors when assistant is disabled', () => {
		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		assert.ok(fixture.hasClass('notebook-error'), 'Expected error class');
		assert.strictEqual(fixture.quickFixContainer, null, 'Expected no quick-fix when assistant is disabled');
	});

	test('renders multiline content within limit', () => {
		const fixture = renderCellTextOutput({ content: '1\n2\n3', type: 'stdout' });

		assert.strictEqual(fixture.outputLines.length, 3, 'Expected 3 output lines');
		assert.strictEqual(fixture.truncationMessage, null, 'Expected no truncation message');
	});

	test('renders ANSI-colored text', () => {
		const fixture = renderCellTextOutput({ content: '\x1b[31mred\x1b[0m plain', type: 'stdout' });

		const runs = fixture.outputRuns;
		assert.strictEqual(runs.length, 2, 'Expected two output runs');
		assert.strictEqual(runs[0].textContent, 'red');
		assert.strictEqual(runs[1].textContent, ' plain');
	});

	test('truncates long output when scrolling is disabled', async () => {
		disposables.add(CommandsRegistry.registerCommand('workbench.action.openSettings', () => { }));

		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);

		const message = fixture.truncationMessage;
		assert.ok(message, 'Expected truncation message');
		assert.ok(message.textContent?.includes('5 lines truncated'), 'Expected truncation count');

		const link = fixture.settingsLink;
		assert.ok(link, 'Expected "Change behavior" link');

		const commandPromise = Event.toPromise(commandService.onWillExecuteCommand);
		link.click();
		const event = await commandPromise;
		assert.strictEqual(event.commandId, 'workbench.action.openSettings');
	});

	test('does not truncate when scrolling is enabled', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		assert.ok(fixture.outputContainer.textContent?.includes('line 35'), 'Expected all lines rendered');
		assert.strictEqual(fixture.truncationMessage, null, 'Expected no truncation message');
	});

	// TODO: useNotebookOptions has a bug where setNotebookOptions(instance.notebookOptions)
	// passes the same object reference, so React skips the re-render. Once that hook is
	// fixed to produce a new reference on change, unskip this test.
	test.skip('switches from truncated to normal when line limit increases', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);
		assert.ok(fixture.truncationMessage, 'Expected truncation message initially');

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		flushSync(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		assert.strictEqual(fixture.truncationMessage, null, 'Expected no truncation message after limit increase');
		assert.ok(fixture.outputContainer.textContent?.includes('line 35'), 'Expected all lines rendered');
	});
});

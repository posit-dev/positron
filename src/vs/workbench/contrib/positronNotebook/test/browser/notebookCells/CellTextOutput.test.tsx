/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { TestCommandService } from '../../../../../../editor/test/browser/editorTestServices.js';
import { NotebookOptions, NotebookDisplayOptions, NotebookOptionsChangeEvent } from '../../../../notebook/browser/notebookOptions.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { PositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';
import { CellTextOutput } from '../../../browser/notebookCells/CellTextOutput.js';
import { ParsedTextOutput } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

type LayoutOptions = Pick<NotebookDisplayOptions, 'outputLineLimit' | 'outputScrolling' | 'outputWordWrap'>;

class CellTextOutputFixture {
	constructor(private readonly container: HTMLElement) { }

	get outputContainer() {
		const el = this.container.querySelector<HTMLDivElement>('.positron-notebook-text-output');
		assert.ok(el, 'Expected output container to exist');
		return el;
	}

	get outputLines() {
		// OutputLine renders a <div> per line (or <br> for empty lines).
		return this.outputContainer.querySelectorAll<HTMLDivElement>(':scope > div');
	}

	get truncationMessage() {
		return this.container.querySelector<HTMLElement>('.notebook-output-truncation-message');
	}

	get settingsLink() {
		return this.container.querySelector<HTMLButtonElement>('.notebook-output-settings-link');
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
	let layoutConfig: LayoutOptions;
	let commandService: TestCommandService;
	let configurationService: TestConfigurationService;
	let contextKeyService: MockContextKeyService;

	setup(() => {
		optionsEmitter = disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false, outputWordWrap: false };

		const instantiationService = disposables.add(new TestInstantiationService());
		commandService = new TestCommandService(instantiationService);

		configurationService = new TestConfigurationService();
		contextKeyService = disposables.add(new MockContextKeyService());
	});

	teardown(() => {
		sinon.restore();
	});

	function renderCellTextOutput(
		props: ParsedTextOutput,
		options?: Partial<LayoutOptions>,
		wrapperOptions?: { scrollAncestorMaxHeight: string },
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

		const inner = (
			<PositronReactServicesContext.Provider value={services}>
				<NotebookInstanceProvider instance={instance}>
					<CellTextOutput {...props} />
				</NotebookInstanceProvider>
			</PositronReactServicesContext.Provider>
		);

		const element = wrapperOptions
			? <div className='positron-notebook-cell-outputs' style={{ maxHeight: wrapperOptions.scrollAncestorMaxHeight, overflow: 'auto' }}>{inner}</div>
			: inner;

		const container = render(element);
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

		assert.ok(fixture.hasClass('long-output-truncate'), 'Expected truncate mode');

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

	test('scrolls long output when scrolling is enabled', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		assert.ok(fixture.hasClass('long-output-scroll'), 'Expected scroll mode');
		assert.ok(fixture.outputContainer.textContent?.includes('line 35'), 'Expected all lines rendered');

		const message = fixture.truncationMessage;
		assert.ok(message, 'Expected scroll truncation message');
		assert.ok(message.textContent?.includes('Scrolling long outputs'), 'Expected scroll message text');
	});

	test('removes scroll class when content fits, re-applies when it overflows', () => {
		// 6 lines exceeds the limit of 5 → scroll mode, but fits in 500px.
		const shortContent = makeLines(6);
		const fixture = renderCellTextOutput(
			{ content: shortContent, type: 'stdout' },
			{ outputLineLimit: 5, outputScrolling: true },
			{ scrollAncestorMaxHeight: '500px' },
		);

		// Content fits within the 500px ancestor, so the overflow check
		// downgrades the mode from 'scroll' to 'normal'.
		assert.ok(!fixture.hasClass('long-output-scroll'), 'Expected scroll class removed when content fits');
		assert.ok(fixture.hasClass('long-output-normal'), 'Expected normal mode when content fits');

		// Re-render with long content that overflows 500px.
		const longContent = makeLines(200);
		const fixture2 = renderCellTextOutput(
			{ content: longContent, type: 'stdout' },
			{ outputLineLimit: 5, outputScrolling: true },
			{ scrollAncestorMaxHeight: '500px' },
		);

		assert.ok(fixture2.hasClass('long-output-scroll'), 'Expected scroll class re-applied when content overflows');
	});

	test('wraps text when word wrap is enabled', () => {
		const fixture = renderCellTextOutput({ content: 'hello', type: 'stdout' });
		assert.ok(!fixture.hasClass('word-wrap'), 'Expected no word-wrap initially');

		layoutConfig = { ...layoutConfig, outputWordWrap: true };
		flushSync(() => optionsEmitter.fire({ outputWordWrap: true } as NotebookOptionsChangeEvent));

		assert.ok(fixture.hasClass('word-wrap'), 'Expected word-wrap after option change');
	});

	test('switches from truncated to normal when line limit increases', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);
		assert.ok(fixture.hasClass('long-output-truncate'), 'Expected truncate mode initially');
		assert.ok(fixture.truncationMessage, 'Expected truncation message initially');

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		flushSync(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		assert.ok(fixture.hasClass('long-output-normal'), 'Expected normal mode after limit increase');
		assert.strictEqual(fixture.truncationMessage, null, 'Expected no truncation message after limit increase');
	});
});

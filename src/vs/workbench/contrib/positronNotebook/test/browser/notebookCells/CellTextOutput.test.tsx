/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { Emitter } from '../../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NotebookDisplayOptions, NotebookLayoutConfiguration, NotebookOptions, NotebookOptionsChangeEvent } from '../../../../notebook/browser/notebookOptions.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { PositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';
import { CellTextOutput } from '../../../browser/notebookCells/CellTextOutput.js';
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

	get showLessMessage() {
		return this.container.querySelector<HTMLElement>('.notebook-output-show-less-seam');
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
	let layoutConfig: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>;
	let configurationService: TestConfigurationService;
	let contextKeyService: MockContextKeyService;

	setup(() => {
		optionsEmitter = disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false, outputWordWrap: false };

		configurationService = new TestConfigurationService();
		contextKeyService = disposables.add(new MockContextKeyService());
	});

	function renderCellTextOutput(
		props: ParsedTextOutput,
		options?: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>,
		onShowFullOutput: () => void = () => { },
		onTruncateOutput: () => void = () => { },
	) {
		if (options !== undefined) {
			layoutConfig = { ...layoutConfig, ...options };
		}
		const notebookOptions = {
			onDidChangeOptions: optionsEmitter.event,
			getLayoutConfiguration: () => layoutConfig,
		} as unknown as NotebookOptions;
		const instance = {
			notebookOptions,
			hoverManager: { showHover: () => { }, hideHover: () => { } },
		} as unknown as IPositronNotebookInstance;
		const services = {
			configurationService,
			contextKeyService,
		} as unknown as PositronReactServices;

		const container = render(
			<PositronReactServicesContext.Provider value={services}>
				<NotebookInstanceProvider instance={instance}>
					<CellTextOutput
						{...props}
						outputScrolling={layoutConfig.outputScrolling ?? false}
						onShowFullOutput={onShowFullOutput}
						onTruncateOutput={onTruncateOutput}
					/>
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

	test('truncates long output when scrolling is disabled', () => {
		const onShowFullOutput = sinon.stub();
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = fixture.truncationMessage;
		assert.ok(message, 'Expected truncation message');
		assert.ok(message.textContent?.includes('5 more lines'), 'Expected truncation count');

		// 50/50 split: top 15 lines (1-15), bottom 15 lines (21-35), lines 16-20 hidden
		const text = fixture.outputContainer.textContent ?? '';
		assert.ok(text.includes('line 1'), 'Expected first line to be visible');
		assert.ok(text.includes('line 15'), 'Expected line 15 (last top line) to be visible');
		assert.ok(!text.includes('line 16\n'), 'Expected line 16 to be truncated');
		assert.ok(!text.includes('line 20\n'), 'Expected line 20 to be truncated');
		assert.ok(text.includes('line 21'), 'Expected line 21 (first bottom line) to be visible');
		assert.ok(text.includes('line 35'), 'Expected last line to be visible');

		message.click();
		assert.ok(onShowFullOutput.calledOnce, 'Expected onShowFullOutput to be called');
	});

	test('shows full output with show-less button when scrolling is enabled', () => {
		const onTruncateOutput = sinon.stub();
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
			() => { },
			onTruncateOutput,
		);

		assert.ok(fixture.outputContainer.textContent?.includes('line 35'), 'Expected all lines rendered');
		const showLess = fixture.showLessMessage;
		assert.ok(showLess, 'Expected show-less message');
		showLess.click();
		assert.strictEqual(onTruncateOutput.callCount, 1, 'Expected onTruncateOutput to be called once');
	});

	test('does not show show-less button when content is short and scrolling is enabled', () => {
		const content = makeLines(5);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		assert.strictEqual(fixture.showLessMessage, null, 'Expected no show-less message for short content');
	});

	test('does not apply word-wrap class when outputWordWrap is false', () => {
		const fixture = renderCellTextOutput({ content: 'hello', type: 'stdout' });

		assert.ok(!fixture.hasClass('word-wrap'), 'Expected no word-wrap class');
	});

	test('applies word-wrap class when outputWordWrap is true', () => {
		const fixture = renderCellTextOutput(
			{ content: 'hello', type: 'stdout' },
			{ outputWordWrap: true },
		);

		assert.ok(fixture.hasClass('word-wrap'), 'Expected word-wrap class');
	});

	test('clicking truncation message calls onShowFullOutput', () => {
		const onShowFullOutput = sinon.stub();
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = fixture.truncationMessage;
		assert.ok(message, 'Expected truncation message');
		message.click();
		assert.strictEqual(onShowFullOutput.callCount, 1, 'Expected onShowFullOutput to be called once');
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

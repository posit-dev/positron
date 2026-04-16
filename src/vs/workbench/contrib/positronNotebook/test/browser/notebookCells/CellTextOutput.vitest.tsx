/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import { flushSync } from 'react-dom';
import { Emitter } from '../../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../../test/vitest/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
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
		expect(el, 'Expected output container to exist').not.toBeNull();
		return el!;
	}

	get outputLines() {
		return this.outputContainer.querySelectorAll<HTMLDivElement>(':scope > div');
	}

	get truncationMessage() {
		return this.container.querySelector<HTMLElement>('.notebook-output-truncation-message');
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

describe('CellTextOutput', () => {
	const disposables = ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	let optionsEmitter: Emitter<NotebookOptionsChangeEvent>;
	let layoutConfig: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>;
	let configurationService: TestConfigurationService;
	let contextKeyService: MockContextKeyService;

	beforeEach(() => {
		optionsEmitter = disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false, outputWordWrap: false };

		configurationService = new TestConfigurationService();
		contextKeyService = disposables.add(new MockContextKeyService());
	});

	function renderCellTextOutput(
		props: ParsedTextOutput,
		options?: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>,
		onShowFullOutput: () => void = () => { },
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

		const { container } = rtl.render(
			<PositronReactServicesContext.Provider value={services}>
				<NotebookInstanceProvider instance={instance}>
					<CellTextOutput
						{...props}
						outputScrolling={layoutConfig.outputScrolling ?? false}
						onShowFullOutput={onShowFullOutput}
					/>
				</NotebookInstanceProvider>
			</PositronReactServicesContext.Provider>
		);
		return new CellTextOutputFixture(container);
	}

	it('renders short output', () => {
		const fixture = renderCellTextOutput({ content: 'hello world', type: 'stdout' });

		expect(fixture.outputContainer.textContent, 'Expected content').toContain('hello world');
		expect(fixture.truncationMessage, 'Expected no truncation message').toBe(null);
		expect(fixture.quickFixContainer, 'Expected no quick-fix').toBe(null);
	});

	it('renders error output with quick-fix', () => {
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positron-assistant.hasChatModels', true);

		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(fixture.hasClass('notebook-error'), 'Expected error class').toBe(true);
		expect(fixture.quickFixContainer, 'Expected quick-fix container for error output').not.toBeNull();
	});

	it('does not render quick-fix for errors when assistant is disabled', () => {
		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(fixture.hasClass('notebook-error'), 'Expected error class').toBe(true);
		expect(fixture.quickFixContainer, 'Expected no quick-fix when assistant is disabled').toBe(null);
	});

	it('renders multiline content within limit', () => {
		const fixture = renderCellTextOutput({ content: '1\n2\n3', type: 'stdout' });

		expect(fixture.outputLines.length, 'Expected 3 output lines').toBe(3);
		expect(fixture.truncationMessage, 'Expected no truncation message').toBe(null);
	});

	it('renders ANSI-colored text', () => {
		const fixture = renderCellTextOutput({ content: '\x1b[31mred\x1b[0m plain', type: 'stdout' });

		const runs = fixture.outputRuns;
		expect(runs.length, 'Expected two output runs').toBe(2);
		expect(runs[0].textContent).toBe('red');
		expect(runs[1].textContent).toBe(' plain');
	});

	it('truncates long output when scrolling is disabled', () => {
		const onShowFullOutput = vi.fn();
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = fixture.truncationMessage;
		expect(message, 'Expected truncation message').not.toBeNull();
		expect(message!.textContent, 'Expected truncation count').toContain('5 more lines');

		// 50/50 split: top 15 lines (1-15), bottom 15 lines (21-35), lines 16-20 hidden
		const text = fixture.outputContainer.textContent ?? '';
		expect(text, 'Expected first line to be visible').toContain('line 1');
		expect(text, 'Expected line 15 (last top line) to be visible').toContain('line 15');
		expect(text, 'Expected line 16 to be truncated').not.toContain('line 16\n');
		expect(text, 'Expected line 20 to be truncated').not.toContain('line 20\n');
		expect(text, 'Expected line 21 (first bottom line) to be visible').toContain('line 21');
		expect(text, 'Expected last line to be visible').toContain('line 35');

		message!.click();
		expect(onShowFullOutput, 'Expected onShowFullOutput to be called').toHaveBeenCalledOnce();
	});

	it('does not truncate when scrolling is enabled', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		expect(fixture.outputContainer.textContent, 'Expected all lines rendered').toContain('line 35');
		expect(fixture.truncationMessage, 'Expected no truncation message').toBe(null);
	});

	it('does not apply word-wrap class when outputWordWrap is false', () => {
		const fixture = renderCellTextOutput({ content: 'hello', type: 'stdout' });

		expect(fixture.hasClass('word-wrap'), 'Expected no word-wrap class').toBe(false);
	});

	it('applies word-wrap class when outputWordWrap is true', () => {
		const fixture = renderCellTextOutput(
			{ content: 'hello', type: 'stdout' },
			{ outputWordWrap: true },
		);

		expect(fixture.hasClass('word-wrap'), 'Expected word-wrap class').toBe(true);
	});

	// TODO: useNotebookOptions has a bug where setNotebookOptions(instance.notebookOptions)
	// passes the same object reference, so React skips the re-render. Once that hook is
	// fixed to produce a new reference on change, unskip this test.
	it.skip('switches from truncated to normal when line limit increases', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);
		expect(fixture.truncationMessage, 'Expected truncation message initially').not.toBeNull();

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		flushSync(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		expect(fixture.truncationMessage, 'Expected no truncation message after limit increase').toBe(null);
		expect(fixture.outputContainer.textContent, 'Expected all lines rendered').toContain('line 35');
	});
});

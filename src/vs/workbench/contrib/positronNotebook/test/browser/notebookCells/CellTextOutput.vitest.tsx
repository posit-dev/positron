/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { Emitter } from '../../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../../base/test/common/vitestSetup.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/reactVitest.js';
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
		expect(el).toBeTruthy();
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
	const { render } = setupReactRenderer();

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

		const container = render(
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

		expect(fixture.outputContainer.textContent?.includes('hello world')).toBeTruthy();
		expect(fixture.truncationMessage).toBe(null);
		expect(fixture.quickFixContainer).toBe(null);
	});

	it('renders error output with quick-fix', () => {
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positron-assistant.hasChatModels', true);

		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(fixture.hasClass('notebook-error')).toBeTruthy();
		expect(fixture.quickFixContainer).toBeTruthy();
	});

	it('does not render quick-fix for errors when assistant is disabled', () => {
		const fixture = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(fixture.hasClass('notebook-error')).toBeTruthy();
		expect(fixture.quickFixContainer).toBe(null);
	});

	it('renders multiline content within limit', () => {
		const fixture = renderCellTextOutput({ content: '1\n2\n3', type: 'stdout' });

		expect(fixture.outputLines.length).toBe(3);
		expect(fixture.truncationMessage).toBe(null);
	});

	it('renders ANSI-colored text', () => {
		const fixture = renderCellTextOutput({ content: '\x1b[31mred\x1b[0m plain', type: 'stdout' });

		const runs = fixture.outputRuns;
		expect(runs.length).toBe(2);
		expect(runs[0].textContent).toBe('red');
		expect(runs[1].textContent).toBe(' plain');
	});

	it('truncates long output when scrolling is disabled', () => {
		const onShowFullOutput = sinon.stub();
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = fixture.truncationMessage;
		expect(message).toBeTruthy();
		expect(message!.textContent?.includes('5 more lines')).toBeTruthy();

		// 50/50 split: top 15 lines (1-15), bottom 15 lines (21-35), lines 16-20 hidden
		const text = fixture.outputContainer.textContent ?? '';
		expect(text.includes('line 1')).toBeTruthy();
		expect(text.includes('line 15')).toBeTruthy();
		expect(!text.includes('line 16\n')).toBeTruthy();
		expect(!text.includes('line 20\n')).toBeTruthy();
		expect(text.includes('line 21')).toBeTruthy();
		expect(text.includes('line 35')).toBeTruthy();

		message!.click();
		expect(onShowFullOutput.calledOnce).toBeTruthy();
	});

	it('does not truncate when scrolling is enabled', () => {
		const content = makeLines(35);
		const fixture = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		expect(fixture.outputContainer.textContent?.includes('line 35')).toBeTruthy();
		expect(fixture.truncationMessage).toBe(null);
	});

	it('does not apply word-wrap class when outputWordWrap is false', () => {
		const fixture = renderCellTextOutput({ content: 'hello', type: 'stdout' });

		expect(!fixture.hasClass('word-wrap')).toBeTruthy();
	});

	it('applies word-wrap class when outputWordWrap is true', () => {
		const fixture = renderCellTextOutput(
			{ content: 'hello', type: 'stdout' },
			{ outputWordWrap: true },
		);

		expect(fixture.hasClass('word-wrap')).toBeTruthy();
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
		expect(fixture.truncationMessage).toBeTruthy();

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		flushSync(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		expect(fixture.truncationMessage).toBe(null);
		expect(fixture.outputContainer.textContent?.includes('line 35')).toBeTruthy();
	});
});

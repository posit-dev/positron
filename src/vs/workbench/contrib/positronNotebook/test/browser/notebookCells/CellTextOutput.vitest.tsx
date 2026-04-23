/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import { act, screen } from '@testing-library/react';
import { Emitter } from '../../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NotebookDisplayOptions, NotebookLayoutConfiguration, NotebookOptions, NotebookOptionsChangeEvent } from '../../../../notebook/browser/notebookOptions.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { CellTextOutput } from '../../../browser/notebookCells/CellTextOutput.js';
import { ParsedTextOutput } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';

/** Generate multiline content with the given number of lines. */
function makeLines(n: number): string {
	return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('CellTextOutput', () => {
	// Describe-scoped services so the builder's .stub() gets a stable reference.
	// State is reset in beforeEach to keep tests independent.
	const configurationService = new TestConfigurationService();
	const contextKeyService = new MockContextKeyService();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, configurationService)
		.stub(IContextKeyService, contextKeyService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let optionsEmitter: Emitter<NotebookOptionsChangeEvent>;
	let layoutConfig: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>;

	beforeEach(() => {
		optionsEmitter = ctx.disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false, outputWordWrap: false };

		// Reset configuration and context-key state between tests. These cast
		// through `unknown` to private fields because neither class exposes a
		// public reset API. If upstream ever renames `configuration` / `_keys`,
		// the assertions below fail loudly at runtime rather than letting state
		// silently leak between tests (TypeScript can't catch this otherwise).
		const configBag = configurationService as unknown as {
			configuration?: Record<string, unknown>;
			configurationByRoot?: { clear(): void };
		};
		const keysBag = contextKeyService as unknown as { _keys?: Map<string, unknown> };
		if (!configBag.configuration || !keysBag._keys) {
			throw new Error(
				'CellTextOutput test relies on TestConfigurationService.configuration and ' +
				'MockContextKeyService._keys to reset state between tests. One of these ' +
				'fields was renamed upstream; update the reset pattern to match.'
			);
		}
		configBag.configuration = Object.create(null);
		// TestConfigurationService also has a `configurationByRoot` TernarySearchTree
		// populated by the `setUserConfiguration({ resource, ... })` overload. Clear
		// it defensively so that overload also resets between tests (currently no
		// test in this file uses it, but the reset should be complete either way).
		configBag.configurationByRoot?.clear();
		keysBag._keys.clear();
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

		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellTextOutput
					{...props}
					outputScrolling={layoutConfig.outputScrolling ?? false}
					onShowFullOutput={onShowFullOutput}
				/>
			</NotebookInstanceProvider>
		);
	}

	it('renders short output', () => {
		const { container } = renderCellTextOutput({ content: 'hello world', type: 'stdout' });

		// Structural container class under test.
		const output = container.querySelector('.positron-notebook-text-output');
		expect(output).toBeInTheDocument();
		expect(output).toHaveTextContent('hello world');
		// Truncation message is a button with the "Show ... more lines" aria-label.
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
		// Quick-fix block is only present for error output.
		expect(container.querySelector('.notebook-cell-quick-fix')).not.toBeInTheDocument();
	});

	it('renders error output with quick-fix', () => {
		configurationService.setUserConfiguration('positron.assistant.enable', true);
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positron-assistant.hasChatModels', true);

		const { container } = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		// Structural class asserted on the output container: error styling.
		const output = container.querySelector('.positron-notebook-text-output');
		expect(output).toHaveClass('notebook-error');
		// Structural class asserted for the quick-fix block.
		expect(container.querySelector('.notebook-cell-quick-fix')).toBeInTheDocument();
	});

	it('does not render quick-fix for errors when assistant is disabled', () => {
		const { container } = renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		const output = container.querySelector('.positron-notebook-text-output');
		expect(output).toHaveClass('notebook-error');
		expect(container.querySelector('.notebook-cell-quick-fix')).not.toBeInTheDocument();
	});

	it('renders multiline content within limit', () => {
		const { container } = renderCellTextOutput({ content: '1\n2\n3', type: 'stdout' });

		const output = container.querySelector('.positron-notebook-text-output')!;
		// Direct-child divs are the rendered output lines.
		const lines = output.querySelectorAll(':scope > div');
		expect(lines).toHaveLength(3);
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
	});

	it('renders ANSI-colored text', () => {
		const { container } = renderCellTextOutput({ content: '\x1b[31mred\x1b[0m plain', type: 'stdout' });

		// ANSI-rendered runs are emitted as span.output-run -- no role/label available.
		// Use textContent (not toHaveTextContent) to preserve non-breaking-space
		// characters that the ANSI renderer emits for leading whitespace.
		const runs = container.querySelectorAll('span.output-run');
		expect(runs).toHaveLength(2);
		expect(runs[0].textContent).toBe('red');
		expect(runs[1].textContent).toBe(' plain');
	});

	it('truncates long output when scrolling is disabled', () => {
		const onShowFullOutput = vi.fn();
		const content = makeLines(35);
		const { container } = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = screen.getByRole('button', { name: /more lines/ });
		expect(message).toBeInTheDocument();
		expect(message).toHaveTextContent('5 more lines');

		// 50/50 split: top 15 lines (1-15), bottom 15 lines (21-35), lines 16-20 hidden.
		const output = container.querySelector('.positron-notebook-text-output')!;
		const text = output.textContent ?? '';
		expect(text).toContain('line 1');
		expect(text).toContain('line 15');
		expect(text).not.toContain('line 16\n');
		expect(text).not.toContain('line 20\n');
		expect(text).toContain('line 21');
		expect(text).toContain('line 35');

		message.click();
		expect(onShowFullOutput).toHaveBeenCalledOnce();
	});

	it('does not truncate when scrolling is enabled', () => {
		const content = makeLines(35);
		const { container } = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		const output = container.querySelector('.positron-notebook-text-output')!;
		expect(output).toHaveTextContent('line 35');
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
	});

	it('does not apply word-wrap class when outputWordWrap is false', () => {
		const { container } = renderCellTextOutput({ content: 'hello', type: 'stdout' });

		const output = container.querySelector('.positron-notebook-text-output');
		expect(output).not.toHaveClass('word-wrap');
	});

	it('applies word-wrap class when outputWordWrap is true', () => {
		const { container } = renderCellTextOutput(
			{ content: 'hello', type: 'stdout' },
			{ outputWordWrap: true },
		);

		const output = container.querySelector('.positron-notebook-text-output');
		expect(output).toHaveClass('word-wrap');
	});

	// TODO: useNotebookOptions has a bug where setNotebookOptions(instance.notebookOptions)
	// passes the same object reference, so React skips the re-render. Once that hook is
	// fixed to produce a new reference on change, unskip this test.
	it.skip('switches from truncated to normal when line limit increases', () => {
		const content = makeLines(35);
		const { container } = renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);
		expect(screen.getByRole('button', { name: /more lines/ })).toBeInTheDocument();

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		act(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
		const output = container.querySelector('.positron-notebook-text-output')!;
		expect(output).toHaveTextContent('line 35');
	});
});

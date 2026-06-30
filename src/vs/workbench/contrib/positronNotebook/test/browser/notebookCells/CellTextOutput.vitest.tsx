/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

/** Generate multiline content with the given number of lines. */
function makeLines(n: number): string {
	return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('CellTextOutput', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let optionsEmitter: Emitter<NotebookOptionsChangeEvent>;
	let layoutConfig: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>;

	beforeEach(() => {
		optionsEmitter = ctx.disposables.add(new Emitter<NotebookOptionsChangeEvent>());
		layoutConfig = { outputLineLimit: 30, outputScrolling: false, outputWordWrap: false };
	});

	function renderCellTextOutput(
		props: ParsedTextOutput,
		options?: Partial<NotebookLayoutConfiguration & NotebookDisplayOptions>,
		onShowFullOutput: () => void = () => { },
	) {
		if (options !== undefined) {
			layoutConfig = { ...layoutConfig, ...options };
		}
		const notebookOptions = stubInterface<NotebookOptions>({
			onDidChangeOptions: optionsEmitter.event,
			getLayoutConfiguration: () => layoutConfig as NotebookLayoutConfiguration & NotebookDisplayOptions,
		});
		const instance = stubInterface<IPositronNotebookInstance>({
			notebookOptions,
			hoverManager: stubInterface<IPositronNotebookInstance['hoverManager']>({
				showHover: () => { },
				hideHover: () => { },
			}),
		});

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
		renderCellTextOutput({ content: 'hello world', type: 'stdout' });

		const output = screen.getByTestId('cell-text-output');
		expect(output).toHaveTextContent('hello world');
		// Truncation message is a button with the "Show ... more lines" aria-label.
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('renders error output with quick-fix', () => {
		// The workbench preset creates a fresh TestConfigurationService and
		// MockContextKeyService per test, so pulling them out of the container
		// here gives isolated state without any manual reset. The composite
		// notebook AI gate is a context key (positronNotebook.aiEnabled), not a
		// config value.
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positronNotebook.aiEnabled', true);
		contextKeyService.createKey('posit-assistant.hasChatModels', true);

		renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(screen.getByTestId('cell-text-output')).toHaveClass('notebook-error');
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('does not render quick-fix for errors when assistant is disabled', () => {
		renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(screen.getByTestId('cell-text-output')).toHaveClass('notebook-error');
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('does not render quick-fix for errors when the notebook AI gate is off', () => {
		// Everything else that would show the quick-fix is on; only the composite
		// notebook AI context key is off, isolating that gate. (The ai.enabled vs
		// notebook.ai.enabled composition is covered in
		// notebookAIEnabledContextKey.vitest.ts.)
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		configurationService.setUserConfiguration('positron.notebook.enabled', true);
		contextKeyService.createKey('positronNotebook.aiEnabled', false);
		contextKeyService.createKey('posit-assistant.hasChatModels', true);

		renderCellTextOutput({ content: 'NameError: name "x" is not defined', type: 'error' });

		expect(screen.getByTestId('cell-text-output')).toHaveClass('notebook-error');
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('renders multiline content within limit', () => {
		renderCellTextOutput({ content: '1\n2\n3', type: 'stdout' });

		const output = screen.getByTestId('cell-text-output');
		// Direct-child divs are the rendered output lines -- no semantic query
		// fits, and this structural invariant is what's under test.
		// eslint-disable-next-line no-restricted-syntax
		const lines = output.querySelectorAll(':scope > div');
		expect(lines).toHaveLength(3);
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
	});

	it('renders ANSI-colored text', () => {
		const { container } = renderCellTextOutput({ content: '\x1b[31mred\x1b[0m plain', type: 'stdout' });

		// ANSI-rendered runs are emitted as span.output-run by the third-party
		// ANSI renderer -- no role/label available. Read textContent directly
		// (not toHaveTextContent) to preserve non-breaking-space characters the
		// renderer emits for leading whitespace; toHaveTextContent normalizes.
		// eslint-disable-next-line no-restricted-syntax
		const runs = container.querySelectorAll('span.output-run');
		expect(runs).toHaveLength(2);
		// eslint-disable-next-line jest-dom/prefer-to-have-text-content
		expect(runs[0].textContent).toBe('red');
		// eslint-disable-next-line jest-dom/prefer-to-have-text-content
		expect(runs[1].textContent).toBe(' plain');
	});

	it('truncates long output when scrolling is disabled', () => {
		const onShowFullOutput = vi.fn();
		const content = makeLines(35);
		renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
			onShowFullOutput,
		);

		const message = screen.getByRole('button', { name: /more lines/ });
		expect(message).toHaveTextContent('5 more lines');

		// 50/50 split: top 15 lines (1-15), bottom 15 lines (21-35), lines 16-20 hidden.
		const text = screen.getByTestId('cell-text-output').textContent ?? '';
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
		renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: true },
		);

		expect(screen.getByTestId('cell-text-output')).toHaveTextContent('line 35');
		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
	});

	it('does not apply word-wrap class when outputWordWrap is false', () => {
		renderCellTextOutput({ content: 'hello', type: 'stdout' });

		expect(screen.getByTestId('cell-text-output')).not.toHaveClass('word-wrap');
	});

	it('applies word-wrap class when outputWordWrap is true', () => {
		renderCellTextOutput(
			{ content: 'hello', type: 'stdout' },
			{ outputWordWrap: true },
		);

		expect(screen.getByTestId('cell-text-output')).toHaveClass('word-wrap');
	});

	it('switches from truncated to normal when line limit increases', () => {
		const content = makeLines(35);
		renderCellTextOutput(
			{ content, type: 'stdout' },
			{ outputLineLimit: 30, outputScrolling: false },
		);
		expect(screen.getByRole('button', { name: /more lines/ })).toBeInTheDocument();

		layoutConfig = { ...layoutConfig, outputLineLimit: 50 };
		act(() => optionsEmitter.fire({ outputLineLimit: true } as NotebookOptionsChangeEvent));

		expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument();
		expect(screen.getByTestId('cell-text-output')).toHaveTextContent('line 35');
	});
});

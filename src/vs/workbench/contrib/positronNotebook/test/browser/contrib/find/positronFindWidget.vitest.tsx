/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type { Mock } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../../test/vitest/reactTestingLibrary.js';
import { ISettableObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import type { IHoverManager } from '../../../../../../../platform/hover/browser/hoverManager.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget, type PositronFindWidgetKeybindingHints } from '../../../../browser/contrib/find/PositronFindWidget.js';

describe('PositronFindWidget', () => {
	const rtl = setupRTLRenderer();

	// Find props
	let findText: ISettableObservable<string>;
	let matchCase: ISettableObservable<boolean>;
	let matchWholeWord: ISettableObservable<boolean>;
	let useRegex: ISettableObservable<boolean>;
	let matchIndex: ISettableObservable<number | undefined>;
	let matchCount: ISettableObservable<number | undefined>;
	let isVisible: ISettableObservable<boolean>;
	let onPreviousMatch: Mock;
	let onNextMatch: Mock;
	let onFindInputFocus: Mock;
	let onFindInputBlur: Mock;
	// Replace props
	let replaceIsVisible: ISettableObservable<boolean>;
	let replaceText: ISettableObservable<string>;
	let preserveCase: ISettableObservable<boolean>;
	let onReplace: Mock;
	let onReplaceAll: Mock;
	let onReplaceInputFocus: Mock;
	let onReplaceInputBlur: Mock;

	function renderWidget({ useReplace = false, hoverManager, keybindingHints }: {
		useReplace?: boolean;
		hoverManager?: IHoverManager;
		keybindingHints?: PositronFindWidgetKeybindingHints;
	} = {}) {
		const result = rtl.render(
			<PositronFindWidget
				contextKeyService={new MockContextKeyService()}
				// ContextViewService is only used by FindInput for validation message
				// popups, which these tests don't trigger.
				contextViewService={stubInterface<IContextViewService>()}
				findInputOptions={{
					label: 'Find',
					inputBoxStyles: unthemedInboxStyles,
					toggleStyles: unthemedToggleStyles,
				}}
				findText={findText}
				hoverManager={hoverManager}
				isVisible={isVisible}
				keybindingHints={keybindingHints}
				matchCase={matchCase}
				matchCount={matchCount}
				matchIndex={matchIndex}
				matchWholeWord={matchWholeWord}
				replace={useReplace ? {
					isVisible: replaceIsVisible,
					replaceText,
					preserveCase,
					replaceInputOptions: {
						label: 'Replace',
						inputBoxStyles: unthemedInboxStyles,
						toggleStyles: unthemedToggleStyles,
					},
					onReplace,
					onReplaceAll,
					onReplaceInputFocus,
					onReplaceInputBlur,
				} : undefined}
				useRegex={useRegex}
				onFindInputBlur={onFindInputBlur}
				onFindInputFocus={onFindInputFocus}
				onNextMatch={onNextMatch}
				onPreviousMatch={onPreviousMatch}
			/>
		);
		const widgetContainer = screen.getByRole('search', { name: /Find/ });
		return { ...result, widgetContainer };
	}

	beforeEach(() => {
		// Find props
		findText = observableValue('findText', '');
		matchCase = observableValue('matchCase', false);
		matchWholeWord = observableValue('matchWholeWord', false);
		useRegex = observableValue('useRegex', false);
		matchIndex = observableValue<number | undefined>('matchIndex', undefined);
		matchCount = observableValue<number | undefined>('matchCount', undefined);
		isVisible = observableValue('isVisible', true);
		onPreviousMatch = vi.fn();
		onNextMatch = vi.fn();
		onFindInputFocus = vi.fn();
		onFindInputBlur = vi.fn();

		// Replace props
		replaceIsVisible = observableValue('replaceIsVisible', false);
		replaceText = observableValue('replaceText', '');
		preserveCase = observableValue('preserveCase', false);
		onReplace = vi.fn();
		onReplaceAll = vi.fn();
		onReplaceInputFocus = vi.fn();
		onReplaceInputBlur = vi.fn();
	});

	describe('Find', () => {
		it('visible when isVisible is true', () => {
			const { widgetContainer } = renderWidget();

			expect(widgetContainer).toHaveClass('visible');
		});

		it('hidden when isVisible is false', () => {
			isVisible.set(false, undefined);
			const { widgetContainer } = renderWidget();

			expect(widgetContainer).not.toHaveClass('visible');
		});

		it('focuses find input when becoming visible', () => {
			isVisible.set(false, undefined);
			const { widgetContainer } = renderWidget();

			act(() => isVisible.set(true, undefined));

			expect(
				widgetContainer.contains(document.activeElement),
				'Expected focus to be inside the find widget',
			).toBe(true);
		});

		it('hidden when close button is clicked', () => {
			const { widgetContainer } = renderWidget();

			act(() => screen.getByRole('button', { name: 'Close' }).click());

			expect(widgetContainer).not.toHaveClass('visible');
			expect(isVisible.get(), 'Expected isVisible observable to be false after close').toBe(false);
		});

		it('has no error styling when there is no query', () => {
			const { widgetContainer } = renderWidget();

			expect(screen.getByText('No results')).toBeInTheDocument();
			expect(widgetContainer).not.toHaveClass('no-results');
		});

		it('has error styling when there is a query but no matches', () => {
			findText.set('foo', undefined);
			matchCount.set(0, undefined);
			const { widgetContainer } = renderWidget();

			expect(screen.getByText('No results')).toBeInTheDocument();
			expect(widgetContainer).toHaveClass('no-results');
		});

		it('shows empty results while matchCount is loading', () => {
			findText.set('foo', undefined);
			renderWidget();

			const results = screen.getByRole('status');
			// toHaveTextContent does substring matching on strings (so '' always matches).
			// Use a regex for an exact empty-string check.
			expect(results).toHaveTextContent(/^$/);
		});

		it('navigation buttons are disabled when there are no matches', () => {
			matchCount.set(0, undefined);
			renderWidget();

			expect(screen.getByRole('button', { name: 'Previous Match' })).toBeDisabled();
			expect(screen.getByRole('button', { name: 'Next Match' })).toBeDisabled();
		});

		it('previous match button calls onPreviousMatch', () => {
			matchCount.set(3, undefined);
			renderWidget();

			screen.getByRole('button', { name: 'Previous Match' }).click();

			expect(onPreviousMatch, 'Expected onPreviousMatch to be called once').toHaveBeenCalledOnce();
		});

		it('next match button calls onNextMatch', () => {
			matchCount.set(3, undefined);
			renderWidget();

			screen.getByRole('button', { name: 'Next Match' }).click();

			expect(onNextMatch, 'Expected onNextMatch to be called once').toHaveBeenCalledOnce();
		});

		it('shows "1 of N" when matchIndex is undefined', () => {
			findText.set('foo', undefined);
			matchCount.set(3, undefined);
			renderWidget();

			expect(screen.getByText('1 of 3')).toBeInTheDocument();
		});

		it('shows match index and count', () => {
			findText.set('foo', undefined);
			matchCount.set(5, undefined);
			matchIndex.set(2, undefined);
			renderWidget();

			expect(screen.getByText('3 of 5')).toBeInTheDocument();
		});

		it('no toggle replace button when useReplace is false', () => {
			renderWidget();

			expect(screen.queryByRole('button', { name: 'Toggle Replace' })).not.toBeInTheDocument();
		});
	});

	describe('Replace', () => {
		it('hidden when replaceIsVisible is false', () => {
			renderWidget({ useReplace: true });

			expect(screen.getByRole('button', { name: 'Toggle Replace' })).toBeInTheDocument();
			// Replace button (inside the replace part) is the reliable proxy for
			// replace-part visibility; exact match avoids 'Replace All' collision.
			expect(screen.queryByRole('button', { name: /^Replace$/ })).not.toBeInTheDocument();
		});

		it('visible when replaceIsVisible is true', () => {
			replaceIsVisible.set(true, undefined);
			renderWidget({ useReplace: true });

			expect(screen.getByRole('button', { name: 'Toggle Replace' })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /^Replace$/ })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Replace All' })).toBeInTheDocument();
		});

		it('expands/collapses when toggle replace button is clicked', () => {
			renderWidget({ useReplace: true });

			act(() => screen.getByRole('button', { name: 'Toggle Replace' }).click());

			expect(screen.getByRole('button', { name: /^Replace$/ })).toBeInTheDocument();
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be true').toBe(true);

			act(() => screen.getByRole('button', { name: 'Toggle Replace' }).click());

			expect(screen.queryByRole('button', { name: /^Replace$/ })).not.toBeInTheDocument();
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be false').toBe(false);
		});

		it('replace button calls onReplace', () => {
			findText.set('foo', undefined);
			replaceIsVisible.set(true, undefined);
			renderWidget({ useReplace: true });

			act(() => screen.getByRole('button', { name: /^Replace$/ }).click());

			expect(onReplace, 'Expected onReplace to be called once').toHaveBeenCalledOnce();
		});

		it('replace all button calls onReplaceAll', () => {
			replaceIsVisible.set(true, undefined);
			findText.set('foo', undefined);
			renderWidget({ useReplace: true });

			act(() => screen.getByRole('button', { name: 'Replace All' }).click());

			expect(onReplaceAll, 'Expected onReplaceAll to be called once').toHaveBeenCalledOnce();
		});

		it('replace buttons are disabled when there is no query', () => {
			replaceIsVisible.set(true, undefined);
			renderWidget({ useReplace: true });

			expect(screen.getByRole('button', { name: /^Replace$/ })).toBeDisabled();
			expect(screen.getByRole('button', { name: 'Replace All' })).toBeDisabled();
		});
	});

	describe('Tooltips', () => {
		let showHover: Mock;
		let hoverManager: IHoverManager;

		beforeEach(() => {
			showHover = vi.fn();
			hoverManager = stubInterface<IHoverManager>({ showHover, hideHover: vi.fn() });
		});

		it('shows label-plus-keybinding tooltips on hover', async () => {
			const user = userEvent.setup();
			// Enable every button: matches exist and a query is entered.
			findText.set('foo', undefined);
			matchCount.set(3, undefined);
			replaceIsVisible.set(true, undefined);
			renderWidget({
				useReplace: true,
				hoverManager,
				keybindingHints: {
					previousMatch: ' (Shift+F3)',
					nextMatch: ' (F3)',
					close: ' (Escape)',
					toggleReplace: ' (Ctrl+H)',
					replace: ' (Ctrl+Shift+1)',
					replaceAll: ' (Ctrl+Alt+Enter)',
				},
			});

			const expectedTooltips: [string | RegExp, string][] = [
				['Previous Match', 'Previous Match (Shift+F3)'],
				['Next Match', 'Next Match (F3)'],
				['Close', 'Close (Escape)'],
				['Toggle Replace', 'Toggle Replace (Ctrl+H)'],
				[/^Replace$/, 'Replace (Ctrl+Shift+1)'],
				['Replace All', 'Replace All (Ctrl+Alt+Enter)'],
			];
			for (const [name, tooltip] of expectedTooltips) {
				const button = screen.getByRole('button', { name });
				await user.hover(button);
				expect(showHover, `Expected hover on "${tooltip}"`).toHaveBeenLastCalledWith(button, tooltip);
				await user.unhover(button);
			}
		});

		it('falls back to plain labels when no keybinding hints are provided', async () => {
			const user = userEvent.setup();
			matchCount.set(3, undefined);
			renderWidget({ hoverManager });

			const button = screen.getByRole('button', { name: 'Next Match' });
			await user.hover(button);

			expect(showHover).toHaveBeenLastCalledWith(button, 'Next Match');
		});
	});
});

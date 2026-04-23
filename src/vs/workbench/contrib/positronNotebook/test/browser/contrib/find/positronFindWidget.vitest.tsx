/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import type { Mock } from 'vitest';
import { act } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../../test/vitest/reactTestingLibrary.js';
import { ISettableObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget } from '../../../../browser/contrib/find/PositronFindWidget.js';

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

	function renderWidget({ useReplace } = { useReplace: false }) {
		const result = rtl.render(
			<PositronFindWidget
				contextKeyService={new MockContextKeyService()}
				// ContextViewService is only used by FindInput for validation message
				// popups, which these tests don't trigger.
				contextViewService={{} as IContextViewService}
				findInputOptions={{
					label: 'Find',
					inputBoxStyles: unthemedInboxStyles,
					toggleStyles: unthemedToggleStyles,
				}}
				findText={findText}
				isVisible={isVisible}
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
		// Structural root: the component has no landmark role, so a class query
		// is used to scope the widget element for class-based visibility checks.
		// eslint-disable-next-line no-restricted-syntax
		const widgetContainer = result.container.querySelector<HTMLDivElement>('.positron-find-widget');
		expect(widgetContainer, 'Expected PositronFindWidget to be rendered').toBeInTheDocument();
		return { ...result, widgetContainer: widgetContainer! };
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
				// eslint-disable-next-line no-restricted-syntax
				widgetContainer.contains(document.activeElement),
				'Expected focus to be inside the find widget',
			).toBe(true);
		});

		it('hidden when close button is clicked', () => {
			const { widgetContainer, getByRole } = renderWidget();

			act(() => getByRole('button', { name: 'Close' }).click());

			expect(widgetContainer).not.toHaveClass('visible');
			expect(isVisible.get(), 'Expected isVisible observable to be false after close').toBe(false);
		});

		it('has no error styling when there is no query', () => {
			const { widgetContainer, getByText } = renderWidget();

			expect(getByText('No results')).toBeInTheDocument();
			expect(widgetContainer).not.toHaveClass('no-results');
		});

		it('has error styling when there is a query but no matches', () => {
			findText.set('foo', undefined);
			matchCount.set(0, undefined);
			const { widgetContainer, getByText } = renderWidget();

			expect(getByText('No results')).toBeInTheDocument();
			expect(widgetContainer).toHaveClass('no-results');
		});

		it('shows empty results while matchCount is loading', () => {
			findText.set('foo', undefined);
			const { container } = renderWidget();

			// Structural: the `.results` div is an empty <div> with no text or role
			// while matchCount is loading, so no RTL query can find it.
			// eslint-disable-next-line no-restricted-syntax
			const results = container.querySelector('.results');
			expect(results).toBeInTheDocument();
			// toHaveTextContent does substring matching on strings (so '' always matches).
			// Use a regex for an exact empty-string check.
			expect(results).toHaveTextContent(/^$/);
		});

		it('navigation buttons are disabled when there are no matches', () => {
			matchCount.set(0, undefined);
			const { getByRole } = renderWidget();

			expect(getByRole('button', { name: 'Previous Match' })).toBeDisabled();
			expect(getByRole('button', { name: 'Next Match' })).toBeDisabled();
		});

		it('previous match button calls onPreviousMatch', () => {
			matchCount.set(3, undefined);
			const { getByRole } = renderWidget();

			getByRole('button', { name: 'Previous Match' }).click();

			expect(onPreviousMatch, 'Expected onPreviousMatch to be called once').toHaveBeenCalledOnce();
		});

		it('next match button calls onNextMatch', () => {
			matchCount.set(3, undefined);
			const { getByRole } = renderWidget();

			getByRole('button', { name: 'Next Match' }).click();

			expect(onNextMatch, 'Expected onNextMatch to be called once').toHaveBeenCalledOnce();
		});

		it('shows "1 of N" when matchIndex is undefined', () => {
			findText.set('foo', undefined);
			matchCount.set(3, undefined);
			const { getByText } = renderWidget();

			expect(getByText('1 of 3')).toBeInTheDocument();
		});

		it('shows match index and count', () => {
			findText.set('foo', undefined);
			matchCount.set(5, undefined);
			matchIndex.set(2, undefined);
			const { getByText } = renderWidget();

			expect(getByText('3 of 5')).toBeInTheDocument();
		});

		it('no toggle replace button when useReplace is false', () => {
			const { queryByRole } = renderWidget();

			expect(queryByRole('button', { name: 'Toggle Replace' })).not.toBeInTheDocument();
		});
	});

	describe('Replace', () => {
		it('hidden when replaceIsVisible is false', () => {
			const { getByRole, queryByRole } = renderWidget({ useReplace: true });

			expect(getByRole('button', { name: 'Toggle Replace' })).toBeInTheDocument();
			// Replace button (inside the replace part) is the reliable proxy for
			// replace-part visibility; exact match avoids 'Replace All' collision.
			expect(queryByRole('button', { name: /^Replace$/ })).not.toBeInTheDocument();
		});

		it('visible when replaceIsVisible is true', () => {
			replaceIsVisible.set(true, undefined);
			const { getByRole } = renderWidget({ useReplace: true });

			expect(getByRole('button', { name: 'Toggle Replace' })).toBeInTheDocument();
			expect(getByRole('button', { name: /^Replace$/ })).toBeInTheDocument();
			expect(getByRole('button', { name: 'Replace All' })).toBeInTheDocument();
		});

		it('expands/collapses when toggle replace button is clicked', () => {
			const { getByRole, queryByRole } = renderWidget({ useReplace: true });

			act(() => getByRole('button', { name: 'Toggle Replace' }).click());

			expect(queryByRole('button', { name: /^Replace$/ })).toBeInTheDocument();
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be true').toBe(true);

			act(() => getByRole('button', { name: 'Toggle Replace' }).click());

			expect(queryByRole('button', { name: /^Replace$/ })).not.toBeInTheDocument();
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be false').toBe(false);
		});

		it('replace button calls onReplace', () => {
			findText.set('foo', undefined);
			replaceIsVisible.set(true, undefined);
			const { getByRole } = renderWidget({ useReplace: true });

			act(() => getByRole('button', { name: /^Replace$/ }).click());

			expect(onReplace, 'Expected onReplace to be called once').toHaveBeenCalledOnce();
		});

		it('replace all button calls onReplaceAll', () => {
			replaceIsVisible.set(true, undefined);
			findText.set('foo', undefined);
			const { getByRole } = renderWidget({ useReplace: true });

			act(() => getByRole('button', { name: 'Replace All' }).click());

			expect(onReplaceAll, 'Expected onReplaceAll to be called once').toHaveBeenCalledOnce();
		});

		it('replace buttons are disabled when there is no query', () => {
			replaceIsVisible.set(true, undefined);
			const { getByRole } = renderWidget({ useReplace: true });

			expect(getByRole('button', { name: /^Replace$/ })).toBeDisabled();
			expect(getByRole('button', { name: 'Replace All' })).toBeDisabled();
		});
	});
});

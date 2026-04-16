/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import type { Mock } from 'vitest';
import { flushSync } from 'react-dom';
import { setupRTLRenderer } from '../../../../../../../test/vitest/reactTestingLibrary.js';
import { ISettableObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget } from '../../../../browser/contrib/find/PositronFindWidget.js';

class PositronFindWidgetFixture {
	constructor(public readonly container: HTMLDivElement) { }

	get results() {
		const el = this.container.querySelector('.results');
		expect(el, 'Expected results element to exist').not.toBeNull();
		return el!;
	}

	get navigationButtons() {
		return this.container.querySelectorAll<HTMLButtonElement>('.navigation-buttons button');
	}

	get previousButton() {
		// NodeList indexing returns undefined (not null) when out of bounds,
		// so assert .toBeDefined() here rather than .not.toBeNull().
		const button = this.navigationButtons[0];
		expect(button, 'Expected previous button to exist').toBeDefined();
		return button;
	}

	get nextButton() {
		// See previousButton above: NodeList miss is undefined, not null.
		const button = this.navigationButtons[1];
		expect(button, 'Expected next button to exist').toBeDefined();
		return button;
	}

	get closeButton() {
		const button = this.container.querySelector<HTMLButtonElement>('button.close-button');
		expect(button, 'Expected close button to exist').not.toBeNull();
		return button!;
	}

	get isVisible() {
		return this.container.classList.contains('visible');
	}

	get hasErrorStyling() {
		return this.container.classList.contains('no-results');
	}

	get toggleReplaceButton() {
		return this.container.querySelector<HTMLButtonElement>('button.toggle-replace');
	}

	get replacePart() {
		return this.container.querySelector('.replace-part');
	}

	get replaceButton() {
		return this.container.querySelector<HTMLButtonElement>('button.replace-button');
	}

	get replaceAllButton() {
		return this.container.querySelector<HTMLButtonElement>('button.replace-all-button');
	}
}

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
		const { container } = rtl.render(
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
		const widgetContainer = container.querySelector<HTMLDivElement>('.positron-find-widget');
		expect(widgetContainer, 'Expected PositronFindWidget to be rendered').not.toBeNull();
		return new PositronFindWidgetFixture(widgetContainer!);
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

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Find', () => {
		it('visible when isVisible is true', () => {
			const widget = renderWidget();

			expect(widget.isVisible, 'Expected find widget to be visible').toBe(true);
		});

		it('hidden when isVisible is false', () => {
			isVisible.set(false, undefined);
			const widget = renderWidget();

			expect(widget.isVisible, 'Expected find widget to be hidden').toBe(false);
		});

		it('focuses find input when becoming visible', () => {
			isVisible.set(false, undefined);
			const widget = renderWidget();

			flushSync(() => isVisible.set(true, undefined));

			expect(
				widget.container.contains(document.activeElement),
				'Expected focus to be inside the find widget',
			).toBe(true);
		});

		it('hidden when close button is clicked', () => {
			const widget = renderWidget();

			flushSync(() => widget.closeButton.click());

			expect(widget.isVisible, 'Expected find widget to be hidden after close').toBe(false);
			expect(isVisible.get(), 'Expected isVisible observable to be false after close').toBe(false);
		});

		it('has no error styling when there is no query', () => {
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('No results');
			expect(widget.hasErrorStyling, 'Expected find widget to have no error styling without a query').toBe(false);
		});

		it('has error styling when there is a query but no matches', () => {
			findText.set('foo', undefined);
			matchCount.set(0, undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('No results');
			expect(widget.hasErrorStyling, 'Expected find widget to indicate no results found').toBe(true);
		});

		it('shows empty results while matchCount is loading', () => {
			findText.set('foo', undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('');
		});

		it('navigation buttons are disabled when there are no matches', () => {
			matchCount.set(0, undefined);
			const widget = renderWidget();

			expect(widget.previousButton.disabled, 'Expected previous button to be disabled').toBe(true);
			expect(widget.nextButton.disabled, 'Expected next button to be disabled').toBe(true);
		});

		it('previous match button calls onPreviousMatch', () => {
			matchCount.set(3, undefined);
			const widget = renderWidget();

			widget.previousButton.click();

			expect(onPreviousMatch, 'Expected onPreviousMatch to be called once').toHaveBeenCalledOnce();
		});

		it('next match button calls onNextMatch', () => {
			matchCount.set(3, undefined);
			const widget = renderWidget();

			widget.nextButton.click();

			expect(onNextMatch, 'Expected onNextMatch to be called once').toHaveBeenCalledOnce();
		});

		it('shows "1 of N" when matchIndex is undefined', () => {
			findText.set('foo', undefined);
			matchCount.set(3, undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('1 of 3');
		});

		it('shows match index and count', () => {
			findText.set('foo', undefined);
			matchCount.set(5, undefined);
			matchIndex.set(2, undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('3 of 5');
		});

		it('no toggle replace button when useReplace is false', () => {
			const widget = renderWidget();

			expect(widget.toggleReplaceButton, 'Expected no toggle replace button').toBe(null);
		});
	});

	describe('Replace', () => {
		it('hidden when replaceIsVisible is false', () => {
			const widget = renderWidget({ useReplace: true });

			expect(widget.toggleReplaceButton, 'Expected toggle replace button to exist').not.toBeNull();
			expect(widget.replacePart, 'Expected replace part to be hidden').toBe(null);
		});

		it('visible when replaceIsVisible is true', () => {
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			expect(widget.toggleReplaceButton, 'Expected toggle replace button to exist').not.toBeNull();
			expect(widget.replacePart, 'Expected replace part to be visible').not.toBeNull();
			expect(widget.replaceButton, 'Expected replace button to exist').not.toBeNull();
			expect(widget.replaceAllButton, 'Expected replace all button to exist').not.toBeNull();
		});

		it('expands/collapses when toggle replace button is clicked', () => {
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.toggleReplaceButton!.click());

			expect(widget.replacePart, 'Expected replace part to be visible when expanded').not.toBeNull();
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be true').toBe(true);

			flushSync(() => widget.toggleReplaceButton!.click());

			expect(widget.replacePart, 'Expected replace part to be hidden').toBe(null);
			expect(replaceIsVisible.get(), 'Expected replaceIsVisible to be false').toBe(false);
		});

		it('replace button calls onReplace', () => {
			findText.set('foo', undefined);
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.replaceButton!.click());

			expect(onReplace, 'Expected onReplace to be called once').toHaveBeenCalledOnce();
		});

		it('replace all button calls onReplaceAll', () => {
			replaceIsVisible.set(true, undefined);
			findText.set('foo', undefined);
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.replaceAllButton!.click());

			expect(onReplaceAll, 'Expected onReplaceAll to be called once').toHaveBeenCalledOnce();
		});

		it('replace buttons are disabled when there is no query', () => {
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			expect(widget.replaceButton!.disabled, 'Expected replace button to be disabled').toBe(true);
			expect(widget.replaceAllButton!.disabled, 'Expected replace all button to be disabled').toBe(true);
		});
	});
});

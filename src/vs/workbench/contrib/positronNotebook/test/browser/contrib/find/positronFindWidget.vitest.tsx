/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoLeakedDisposables } from '../../../../../../../test/vitest/vitestUtils.js';
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
		expect(el).toBeTruthy();
		return el!;
	}

	get navigationButtons() {
		return this.container.querySelectorAll<HTMLButtonElement>('.navigation-buttons button');
	}

	get previousButton() {
		const button = this.navigationButtons[0];
		expect(button).toBeTruthy();
		return button;
	}

	get nextButton() {
		const button = this.navigationButtons[1];
		expect(button).toBeTruthy();
		return button;
	}

	get closeButton() {
		const button = this.container.querySelector<HTMLButtonElement>('button.close-button');
		expect(button).toBeTruthy();
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
	ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	// Find props
	let findText: ISettableObservable<string>;
	let matchCase: ISettableObservable<boolean>;
	let matchWholeWord: ISettableObservable<boolean>;
	let useRegex: ISettableObservable<boolean>;
	let matchIndex: ISettableObservable<number | undefined>;
	let matchCount: ISettableObservable<number | undefined>;
	let isVisible: ISettableObservable<boolean>;
	let onPreviousMatch: sinon.SinonStub;
	let onNextMatch: sinon.SinonStub;
	let onFindInputFocus: sinon.SinonStub;
	let onFindInputBlur: sinon.SinonStub;
	// Replace props
	let replaceIsVisible: ISettableObservable<boolean>;
	let replaceText: ISettableObservable<string>;
	let preserveCase: ISettableObservable<boolean>;
	let onReplace: sinon.SinonStub;
	let onReplaceAll: sinon.SinonStub;
	let onReplaceInputFocus: sinon.SinonStub;
	let onReplaceInputBlur: sinon.SinonStub;

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
		expect(widgetContainer).toBeTruthy();
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
		onPreviousMatch = sinon.stub();
		onNextMatch = sinon.stub();
		onFindInputFocus = sinon.stub();
		onFindInputBlur = sinon.stub();

		// Replace props
		replaceIsVisible = observableValue('replaceIsVisible', false);
		replaceText = observableValue('replaceText', '');
		preserveCase = observableValue('preserveCase', false);
		onReplace = sinon.stub();
		onReplaceAll = sinon.stub();
		onReplaceInputFocus = sinon.stub();
		onReplaceInputBlur = sinon.stub();
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('Find', () => {
		it('visible when isVisible is true', () => {
			const widget = renderWidget();

			expect(widget.isVisible).toBeTruthy();
		});

		it('hidden when isVisible is false', () => {
			isVisible.set(false, undefined);
			const widget = renderWidget();

			expect(!widget.isVisible).toBeTruthy();
		});

		it('focuses find input when becoming visible', () => {
			isVisible.set(false, undefined);
			const widget = renderWidget();

			flushSync(() => isVisible.set(true, undefined));

			expect(
				widget.container.contains(document.activeElement)
			).toBeTruthy();
		});

		it('hidden when close button is clicked', () => {
			const widget = renderWidget();

			flushSync(() => widget.closeButton.click());

			expect(!widget.isVisible).toBeTruthy();
			expect(!isVisible.get()).toBeTruthy();
		});

		it('has no error styling when there is no query', () => {
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('No results');
			expect(!widget.hasErrorStyling).toBeTruthy();
		});

		it('has error styling when there is a query but no matches', () => {
			findText.set('foo', undefined);
			matchCount.set(0, undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('No results');
			expect(widget.hasErrorStyling).toBeTruthy();
		});

		it('shows empty results while matchCount is loading', () => {
			findText.set('foo', undefined);
			const widget = renderWidget();

			expect(widget.results.textContent).toBe('');
		});

		it('navigation buttons are disabled when there are no matches', () => {
			matchCount.set(0, undefined);
			const widget = renderWidget();

			expect(widget.previousButton.disabled).toBeTruthy();
			expect(widget.nextButton.disabled).toBeTruthy();
		});

		it('previous match button calls onPreviousMatch', () => {
			matchCount.set(3, undefined);
			const widget = renderWidget();

			widget.previousButton.click();

			expect(onPreviousMatch.calledOnce).toBeTruthy();
		});

		it('next match button calls onNextMatch', () => {
			matchCount.set(3, undefined);
			const widget = renderWidget();

			widget.nextButton.click();

			expect(onNextMatch.calledOnce).toBeTruthy();
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

			expect(widget.toggleReplaceButton).toBe(null);
		});
	});

	describe('Replace', () => {
		it('hidden when replaceIsVisible is false', () => {
			const widget = renderWidget({ useReplace: true });

			expect(widget.toggleReplaceButton).toBeTruthy();
			expect(widget.replacePart).toBe(null);
		});

		it('visible when replaceIsVisible is true', () => {
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			expect(widget.toggleReplaceButton).toBeTruthy();
			expect(widget.replacePart).toBeTruthy();
			expect(widget.replaceButton).toBeTruthy();
			expect(widget.replaceAllButton).toBeTruthy();
		});

		it('expands/collapses when toggle replace button is clicked', () => {
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.toggleReplaceButton!.click());

			expect(widget.replacePart).toBeTruthy();
			expect(replaceIsVisible.get()).toBeTruthy();

			flushSync(() => widget.toggleReplaceButton!.click());

			expect(widget.replacePart).toBe(null);
			expect(!replaceIsVisible.get()).toBeTruthy();
		});

		it('replace button calls onReplace', () => {
			findText.set('foo', undefined);
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.replaceButton!.click());

			expect(onReplace.calledOnce).toBeTruthy();
		});

		it('replace all button calls onReplaceAll', () => {
			replaceIsVisible.set(true, undefined);
			findText.set('foo', undefined);
			const widget = renderWidget({ useReplace: true });

			flushSync(() => widget.replaceAllButton!.click());

			expect(onReplaceAll.calledOnce).toBeTruthy();
		});

		it('replace buttons are disabled when there is no query', () => {
			replaceIsVisible.set(true, undefined);
			const widget = renderWidget({ useReplace: true });

			expect(widget.replaceButton!.disabled).toBeTruthy();
			expect(widget.replaceAllButton!.disabled).toBeTruthy();
		});
	});
});

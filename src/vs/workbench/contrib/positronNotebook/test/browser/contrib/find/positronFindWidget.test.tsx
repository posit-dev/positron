/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../../base/test/browser/react.js';
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
		assert.ok(el, 'Expected results element to exist');
		return el;
	}

	get navigationButtons() {
		return this.container.querySelectorAll<HTMLButtonElement>('.navigation-buttons button');
	}

	get previousButton() {
		const button = this.navigationButtons[0];
		assert.ok(button, 'Expected previous button to exist');
		return button;
	}

	get nextButton() {
		const button = this.navigationButtons[1];
		assert.ok(button, 'Expected next button to exist');
		return button;
	}

	get closeButton() {
		const button = this.container.querySelector<HTMLButtonElement>('button.close-button');
		assert.ok(button, 'Expected close button to exist');
		return button;
	}

	get isVisible() {
		return this.container.classList.contains('visible');
	}

	get hasErrorStyling() {
		return this.container.classList.contains('no-results');
	}
}

suite('PositronFindWidget', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let findText: ISettableObservable<string>;
	let matchCase: ISettableObservable<boolean>;
	let matchWholeWord: ISettableObservable<boolean>;
	let useRegex: ISettableObservable<boolean>;
	let matchIndex: ISettableObservable<number | undefined>;
	let matchCount: ISettableObservable<number | undefined>;
	let isVisible: ISettableObservable<boolean>;
	let inputFocused: ISettableObservable<boolean>;
	let onPreviousMatch: sinon.SinonStub;
	let onNextMatch: sinon.SinonStub;

	function renderWidget() {
		const container = render(
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
				inputFocused={inputFocused}
				isVisible={isVisible}
				matchCase={matchCase}
				matchCount={matchCount}
				matchIndex={matchIndex}
				matchWholeWord={matchWholeWord}
				useRegex={useRegex}
				onNextMatch={onNextMatch}
				onPreviousMatch={onPreviousMatch}
			/>
		);
		const widgetContainer = container.querySelector<HTMLDivElement>('.positron-find-widget');
		assert.ok(widgetContainer, 'Expected PositronFindWidget to be rendered');
		return new PositronFindWidgetFixture(widgetContainer);
	}

	setup(() => {
		findText = observableValue('findText', '');
		matchCase = observableValue('matchCase', false);
		matchWholeWord = observableValue('matchWholeWord', false);
		useRegex = observableValue('useRegex', false);
		matchIndex = observableValue<number | undefined>('matchIndex', undefined);
		matchCount = observableValue<number | undefined>('matchCount', undefined);
		isVisible = observableValue('isVisible', true);
		inputFocused = observableValue('inputFocused', false);
		onPreviousMatch = sinon.stub();
		onNextMatch = sinon.stub();
	});

	teardown(() => {
		sinon.restore();
	});

	test('is visible after first render', () => {
		const widget = renderWidget();

		assert.ok(widget.isVisible, 'Expected find widget to be visible');
	});

	test('hides when close button is clicked', () => {
		const widget = renderWidget();

		flushSync(() => widget.closeButton.click());

		assert.ok(!widget.isVisible, 'Expected find widget to be hidden after close');
		assert.ok(!isVisible.get(), 'Expected isVisible observable to be false after close');
	});

	test('hides when isVisible changes', () => {
		const widget = renderWidget();

		flushSync(() => isVisible.set(false, undefined));

		assert.ok(!widget.isVisible, 'Expected find widget to be hidden');
	});

	test('has no error styling when there is no query', () => {
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, 'No results');
		assert.ok(!widget.hasErrorStyling, 'Expected find widget to have no error styling without a query');
	});

	test('has error styling when there is a query but no matches', () => {
		findText.set('foo', undefined);
		matchCount.set(0, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, 'No results');
		assert.ok(widget.hasErrorStyling, 'Expected find widget to indicate no results found');
	});

	test('shows empty results while matchCount is loading', () => {
		findText.set('foo', undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '');
	});

	test('navigation buttons are disabled when there are no matches', () => {
		matchCount.set(0, undefined);
		const widget = renderWidget();

		assert.ok(widget.previousButton.disabled, 'Expected previous button to be disabled');
		assert.ok(widget.nextButton.disabled, 'Expected next button to be disabled');
	});

	test('previous match button calls onPreviousMatch', () => {
		matchCount.set(3, undefined);
		const widget = renderWidget();

		widget.previousButton.click();

		assert.ok(onPreviousMatch.calledOnce, 'Expected onPreviousMatch to be called once');
	});

	test('next match button calls onNextMatch', () => {
		matchCount.set(3, undefined);
		const widget = renderWidget();

		widget.nextButton.click();

		assert.ok(onNextMatch.calledOnce, 'Expected onNextMatch to be called once');
	});

	test('shows "1 of N" when matchIndex is undefined', () => {
		findText.set('foo', undefined);
		matchCount.set(3, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '1 of 3');
	});

	test('shows match index and count', () => {
		findText.set('foo', undefined);
		matchCount.set(5, undefined);
		matchIndex.set(2, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '3 of 5');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../../base/test/browser/react.js';
import { ISettableObservable, observableValue, transaction } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget } from '../../../../browser/contrib/find/PositronFindWidget.js';

suite('PositronFindWidget', () => {
	const { render, container } = setupReactRenderer();
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
		render(
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

	suite('Rendering & Visibility', () => {
		test('renders when visible', () => {
			renderWidget();

			const widget = container().querySelector('.positron-find-widget.visible');
			assert.ok(widget, 'Expected .positron-find-widget.visible to exist');
		});

		test('hidden when not visible', () => {
			isVisible.set(false, undefined);
			renderWidget();

			const widget = container().querySelector('.positron-find-widget');
			assert.ok(widget, 'Expected .positron-find-widget to exist');
			assert.ok(
				!widget.classList.contains('visible'),
				'Expected widget to lack .visible class'
			);
		});

	});

	suite('FindResult display', () => {
		test('shows "No results" when find text is empty', () => {
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, 'No results');
		});

		test('shows empty results when matchCount is undefined', () => {
			findText.set('foo', undefined);
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '');
		});

		test('shows "No results" with error styling when no matches', () => {
			findText.set('foo', undefined);
			matchCount.set(0, undefined);
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, 'No results');

			const widget = container().querySelector('.positron-find-widget.no-results');
			assert.ok(widget, 'Expected widget to have .no-results class');
		});

		test('shows match count when matches exist', () => {
			findText.set('foo', undefined);
			matchCount.set(5, undefined);
			matchIndex.set(2, undefined);
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '3 of 5');
		});

		test('shows "1 of N" when matchIndex is undefined', () => {
			findText.set('foo', undefined);
			matchCount.set(3, undefined);
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '1 of 3');
		});
	});

	suite('Navigation buttons', () => {
		test('previous match button disabled when no matches', () => {
			matchCount.set(0, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			assert.ok(prevButton, 'Expected previous button to exist');
			assert.strictEqual(prevButton.disabled, true, 'Expected previous button to be disabled');
		});

		test('next match button disabled when no matches', () => {
			matchCount.set(0, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			assert.ok(nextButton, 'Expected next button to exist');
			assert.strictEqual(nextButton.disabled, true, 'Expected next button to be disabled');
		});

		test('previous match button enabled when matches exist', () => {
			matchCount.set(3, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			assert.ok(prevButton, 'Expected previous button to exist');
			assert.strictEqual(prevButton.disabled, false, 'Expected previous button to be enabled');
		});

		test('next match button enabled when matches exist', () => {
			matchCount.set(3, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			assert.ok(nextButton, 'Expected next button to exist');
			assert.strictEqual(nextButton.disabled, false, 'Expected next button to be enabled');
		});

		test('previous match button calls onPreviousMatch', () => {
			matchCount.set(3, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			prevButton.click();

			assert.ok(onPreviousMatch.calledOnce, 'Expected onPreviousMatch to be called once');
		});

		test('next match button calls onNextMatch', () => {
			matchCount.set(3, undefined);
			renderWidget();

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			nextButton.click();

			assert.ok(onNextMatch.calledOnce, 'Expected onNextMatch to be called once');
		});
	});

	suite('Close button', () => {
		test('sets isVisible to false', () => {
			renderWidget();

			const closeButton = container().querySelector('.positron-find-widget button.close-button') as HTMLButtonElement;
			assert.ok(closeButton, 'Expected close button to exist');
			closeButton.click();

			assert.strictEqual(isVisible.get(), false, 'Expected isVisible to be false after close');
		});
	});

	suite('Tab order', () => {
		test('disabled navigation buttons are excluded from tab order', () => {
			matchCount.set(0, undefined);
			renderWidget();

			const navButtons = container().querySelectorAll('.positron-find-widget .navigation-buttons button') as NodeListOf<HTMLButtonElement>;
			for (const btn of navButtons) {
				assert.strictEqual(btn.disabled, true, `Expected navigation button "${btn.ariaLabel}" to be disabled`);
			}

			// Close button should still be enabled
			const closeButton = container().querySelector('.positron-find-widget button.close-button') as HTMLButtonElement;
			assert.strictEqual(closeButton.disabled, false, 'Expected close button to remain enabled');
		});
	});

	suite('Reactivity', () => {
		test('re-renders when matchCount changes', () => {
			transaction((tx) => {
				findText.set('foo', tx);
				matchCount.set(3, tx);
				matchIndex.set(0, tx);
			});
			renderWidget();

			let results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '1 of 3');

			matchCount.set(5, undefined);
			renderWidget();

			results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '1 of 5');
		});

		test('re-renders when findText changes', () => {
			renderWidget();

			let results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, 'No results');

			findText.set('foo', undefined);
			renderWidget();

			results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '');
		});

		test('re-renders when visibility changes', () => {
			renderWidget();

			let widget = container().querySelector('.positron-find-widget');
			assert.ok(widget?.classList.contains('visible'), 'Expected widget to be visible');

			isVisible.set(false, undefined);
			renderWidget();

			widget = container().querySelector('.positron-find-widget');
			assert.ok(widget?.classList.contains('visible') === false, 'Expected widget to not be visible');
		});
	});
});

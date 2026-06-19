/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { WebviewFindDelegate, WebviewFindWidget } from '../../browser/webviewFindWidget.js';

type FindCall = {
	readonly value: string;
	readonly previous: boolean;
};

type EnterKeyEventOptions = {
	readonly shiftKey?: boolean;
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly isComposing?: boolean;
};

function createEnterKeyEvent(options: EnterKeyEventOptions = {}): KeyboardEvent {
	const event = new KeyboardEvent('keydown', {
		key: 'Enter',
		code: 'Enter',
		bubbles: true,
		cancelable: true,
		shiftKey: options.shiftKey,
		altKey: options.altKey,
		ctrlKey: options.ctrlKey,
		metaKey: options.metaKey,
	});
	Object.defineProperty(event, 'keyCode', { get: () => 13 });
	Object.defineProperty(event, 'isComposing', { get: () => options.isComposing === true });
	return event;
}

describe('WebviewFindWidget', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	let findCalls: FindCall[];
	let widget: WebviewFindWidget;

	function createWidget(): void {
		findCalls = [];
		const delegate: WebviewFindDelegate = {
			hasFindResult: Event.None,
			onDidStopFind: Event.None,
			checkImeCompletionState: true,
			find: (value, previous) => {
				findCalls.push({ value, previous });
			},
			updateFind: () => { },
			stopFind: () => { },
			focus: () => { },
		};

		widget = ctx.disposables.add(ctx.instantiationService.createInstance(WebviewFindWidget, delegate));
		document.body.appendChild(widget.getDomNode());
		widget.reveal('needle', false);
	}

	afterEach(() => {
		widget?.getDomNode().remove();
	});

	describe('Keyboard navigation', () => {
		it('Enter invokes find next with the current input value', () => {
			createWidget();

			const event = createEnterKeyEvent();
			const stopPropagation = vi.spyOn(event, 'stopPropagation');
			widget.getFindInputDomNode().dispatchEvent(event);

			expect(findCalls).toEqual([{ value: 'needle', previous: false }]);
			expect(event.defaultPrevented).toBe(true);
			expect(stopPropagation).toHaveBeenCalledOnce();
		});

		it('Shift+Enter invokes find previous with the current input value', () => {
			createWidget();

			const event = createEnterKeyEvent({ shiftKey: true });
			const stopPropagation = vi.spyOn(event, 'stopPropagation');
			widget.getFindInputDomNode().dispatchEvent(event);

			expect(findCalls).toEqual([{ value: 'needle', previous: true }]);
			expect(event.defaultPrevented).toBe(true);
			expect(stopPropagation).toHaveBeenCalledOnce();
		});

		it('ignores modified Enter chords', () => {
			createWidget();

			for (const options of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
				const event = createEnterKeyEvent(options);
				widget.getFindInputDomNode().dispatchEvent(event);
				expect(event.defaultPrevented).toBe(false);
			}

			expect(findCalls).toEqual([]);
		});

		it('ignores Enter while IME composition is active', () => {
			createWidget();

			const event = createEnterKeyEvent({ isComposing: true });
			widget.getFindInputDomNode().dispatchEvent(event);

			expect(findCalls).toEqual([]);
			expect(event.defaultPrevented).toBe(false);
		});
	});
});

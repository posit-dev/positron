/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode } from '../../common/keyCodes.js';
import { findTopMostPositronModalDialog, WORKBENCH_DIALOG_CLASS } from '../positronTopLayerDialog.js';
import { createElement } from 'react';
import { createTestContainer } from '../../../test/vitest/positronTestContainer.js';
import { PositronReactServices } from '../positronReactServices.js';
import { applyModalKeydownSuppression, PositronModalDialogReactRenderer } from '../positronModalDialogReactRenderer.js';

/** A keyboard event with only the members applyModalKeydownSuppression touches. */
function fakeEvent(keyCode: KeyCode) {
	return { keyCode, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('applyModalKeydownSuppression', () => {
	it('leaves unbound keys alone (no matching command)', () => {
		const event = fakeEvent(KeyCode.KeyA);
		applyModalKeydownSuppression(null, event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('leaves allowable commands alone so modal inputs keep working', () => {
		const event = fakeEvent(KeyCode.KeyC);
		applyModalKeydownSuppression('copy', event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('Escape bound to a non-allowable command stops propagation but NOT default, so the dialog still closes', () => {
		const event = fakeEvent(KeyCode.Escape);
		applyModalKeydownSuppression('notebook.cell.quitEdit', event);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('a non-Escape bound key gets the full stop (preventDefault + stopPropagation)', () => {
		const event = fakeEvent(KeyCode.KeyP);
		applyModalKeydownSuppression('workbench.action.showCommands', event);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});
});

describe('workbench dialogs inside a Positron modal dialog', () => {
	// Stands in for the DOM upstream's Dialog widget builds. Only the class matters here: it is how
	// the renderer recognises a workbench dialog that has been parented into it.
	function appendWorkbenchDialog(parent: HTMLElement) {
		const workbenchDialog = document.createElement('div');
		workbenchDialog.classList.add(WORKBENCH_DIALOG_CLASS);
		parent.appendChild(workbenchDialog);
		return workbenchDialog;
	}

	const ctx = createTestContainer().withReactServices().build();

	let rendered: PositronModalDialogReactRenderer[];

	beforeEach(() => {
		// The renderer reads the services singleton in its constructor to find its container.
		PositronReactServices.services = ctx.reactServices;
		rendered = [];
	});

	afterEach(() => {
		// Tear down here rather than at the end of each test. A failing assertion would skip an
		// in-test dispose() and leave the <dialog> in the document, where the next test's
		// querySelector would find it instead of its own.
		rendered.forEach(renderer => renderer.dispose());
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	function renderDialog(onDisposed?: () => void) {
		const renderer = new PositronModalDialogReactRenderer({ container: document.body, onDisposed });
		rendered.push(renderer);
		renderer.render(createElement('div', null, 'dialog content'));
		// eslint-disable-next-line no-restricted-syntax -- getByRole throws once a test opens a second dialog, and these tests need exactly that case
		const dialogs = document.body.querySelectorAll('dialog');
		const dialog = dialogs[dialogs.length - 1] as HTMLDialogElement;
		return { renderer, dialog };
	}

	describe('findTopMostPositronModalDialog', () => {
		it('finds nothing when no dialog is open', () => {
			expect(findTopMostPositronModalDialog(document.body)).toBeUndefined();
		});

		it('finds the open dialog, which is where a workbench dialog has to render to be usable', () => {
			const { dialog } = renderDialog();
			expect(findTopMostPositronModalDialog(document.body)).toBe(dialog);
		});

		it('picks the last of several, because that is the one on top of the top layer', () => {
			renderDialog();
			const { dialog: second } = renderDialog();
			expect(findTopMostPositronModalDialog(document.body)).toBe(second);
		});
	});

	describe('Escape', () => {
		it('closes the dialog when nothing is rendered inside it', () => {
			const onDisposed = vi.fn();
			renderDialog(onDisposed);

			const event = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, cancelable: true });
			window.dispatchEvent(event);

			expect(event.defaultPrevented).toBe(false);
		});

		it('is left to the workbench dialog when one is rendered inside, so both do not close at once', () => {
			const { dialog } = renderDialog();
			appendWorkbenchDialog(dialog);

			const event = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, cancelable: true });
			window.dispatchEvent(event);

			// preventDefault stops the browser closing this dialog, which would take the workbench
			// dialog down with it before the user could answer it.
			expect(event.defaultPrevented).toBe(true);
		});
	});

	describe('disposal', () => {
		it('moves a workbench dialog back out rather than deleting it, so its caller is not left waiting', () => {
			const { renderer, dialog } = renderDialog();
			const workbenchDialog = appendWorkbenchDialog(dialog);

			renderer.dispose();

			expect(workbenchDialog.isConnected).toBe(true);
			expect(workbenchDialog.parentElement).toBe(document.body);
		});
	});
});

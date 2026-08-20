/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from './dom.js';

/**
 * The class upstream's Dialog widget puts on its outermost element (see dialog.ts). Positron uses
 * it to recognise a workbench dialog that has been parented into a Positron modal dialog.
 */
export const WORKBENCH_DIALOG_CLASS = 'monaco-dialog-modal-block';

/**
 * Finds the Positron modal dialog that a workbench dialog should be rendered inside, if one is
 * open.
 *
 * A <dialog> opened with showModal() is promoted to the browser's top layer. Content there paints
 * above every z-index, and everything that is not a descendant of it cannot be clicked or focused.
 * A workbench dialog is an ordinary z-indexed element, so while a Positron modal dialog is open the
 * only way for it to be visible and usable is to be a child of that dialog.
 *
 * @param container The container to search, normally the active workbench container.
 * @returns The dialog to render into, or undefined when no Positron modal dialog is open.
 */
export function findTopMostPositronModalDialog(container: HTMLElement): HTMLDialogElement | undefined {
	// Where dialogs are nested, the last one in DOM order is the one on top of the top layer, and
	// so the only one whose descendants escape being inert.
	// eslint-disable-next-line no-restricted-syntax -- the modal DOM is built by a separate renderer, so it must be located by selector rather than dom.ts h()
	const dialogs = container.querySelectorAll('dialog.positron-modal-dialog[open]');
	const topMost = dialogs.length ? dialogs[dialogs.length - 1] : undefined;
	// The selector already pins this to a <dialog>, so the element check is only here to rule out
	// a stray match from another document.
	return dom.isHTMLElement(topMost) ? topMost as HTMLDialogElement : undefined;
}

/**
 * Whether a workbench dialog is currently parented inside the given element.
 *
 * @param element The element to check, normally a Positron modal <dialog>.
 * @returns True when a workbench dialog is rendered inside it.
 */
export function hostsWorkbenchDialog(element: HTMLElement): boolean {
	// eslint-disable-next-line no-restricted-syntax -- the dialog DOM is built by the upstream widget, so it must be located by selector rather than dom.ts h()
	return element.querySelector(`.${WORKBENCH_DIALOG_CLASS}`) !== null;
}

/**
 * Moves any workbench dialogs parented inside the given element back out to a container that will
 * outlive it. Without this, closing a Positron modal dialog would delete an unanswered workbench
 * dialog along with it, and whoever was waiting on that dialog's answer would wait forever.
 *
 * @param element The element to move dialogs out of, normally a Positron modal <dialog>.
 * @param container The container to move them to.
 */
export function releaseWorkbenchDialogs(element: HTMLElement, container: HTMLElement): void {
	// eslint-disable-next-line no-restricted-syntax -- the dialog DOM is built by the upstream widget, so it must be located by selector rather than dom.ts h()
	for (const workbenchDialog of Array.from(element.querySelectorAll(`.${WORKBENCH_DIALOG_CLASS}`))) {
		container.appendChild(workbenchDialog);
	}
}

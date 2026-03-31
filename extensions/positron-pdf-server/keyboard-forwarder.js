/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This script is injected into the PDF.js viewer to forward specific keyboard
 * shortcuts to VS Code. Without this, keyboard events are captured by PDF.js
 * and don't reach VS Code's keybinding service.
 *
 * We use an allowlist approach to only forward shortcuts that should be handled
 * by VS Code, while letting PDF.js handle its own shortcuts (like Cmd+F for find).
 */

(function () {
	'use strict';

	/**
	 * Check if the keyboard event matches a shortcut that should be forwarded to VS Code.
	 * @param {KeyboardEvent} e
	 * @returns {boolean}
	 */
	function shouldForwardToVSCode(e) {
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

		// Command Palette: Cmd/Ctrl+Shift+P
		if (cmdOrCtrl && e.shiftKey && e.code === 'KeyP') {
			return true;
		}

		// Settings: Cmd/Ctrl+,
		if (cmdOrCtrl && e.code === 'Comma') {
			return true;
		}

		// Toggle Sidebar: Cmd/Ctrl+B
		if (cmdOrCtrl && e.code === 'KeyB') {
			return true;
		}

		// Explorer: Cmd/Ctrl+Shift+E
		if (cmdOrCtrl && e.shiftKey && e.code === 'KeyE') {
			return true;
		}

		// Search: Cmd/Ctrl+Shift+F
		if (cmdOrCtrl && e.shiftKey && e.code === 'KeyF') {
			return true;
		}

		// Note: We intentionally do NOT forward Cmd/Ctrl+P (without shift) because
		// in a PDF context, users expect this to print the PDF, not open Quick Open.

		// Close Editor: Cmd/Ctrl+W
		if (cmdOrCtrl && e.code === 'KeyW') {
			return true;
		}

		// New Window: Cmd/Ctrl+Shift+N
		if (cmdOrCtrl && e.shiftKey && e.code === 'KeyN') {
			return true;
		}

		// Escape key - useful for closing dialogs, panels
		if (e.code === 'Escape') {
			return true;
		}

		// F1 - Help
		if (e.code === 'F1') {
			return true;
		}

		return false;
	}

	/**
	 * Forward a keyboard event to the parent frames.
	 * @param {KeyboardEvent} e
	 * @param {string} type
	 */
	function forwardKeyEvent(e, type) {
		const eventData = {
			type: type,
			key: e.key,
			keyCode: e.keyCode,
			code: e.code,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
			repeat: e.repeat
		};

		// Post message to parent frame (the VS Code webview).
		// We use '*' for the target origin because:
		// 1. The parent webview has a dynamic vscode-webview:// origin that we can't
		//    easily know from this context
		// 2. This follows the same pattern as VS Code's webview-events.js
		// 3. Security is enforced on the receiving side, which validates that
		//    messages come from the expected localhost origin
		try {
			window.parent.postMessage({
				channel: 'pdf-keyboard-event',
				data: eventData
			}, '*');
		} catch (err) {
			// Ignore cross-origin errors
		}
	}

	/**
	 * Handle keydown events.
	 * @param {KeyboardEvent} e
	 */
	function handleKeyDown(e) {
		if (shouldForwardToVSCode(e)) {
			// Prevent PDF.js from handling this shortcut
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			forwardKeyEvent(e, 'keydown');
		}
	}

	/**
	 * Handle keyup events.
	 * @param {KeyboardEvent} e
	 */
	function handleKeyUp(e) {
		if (shouldForwardToVSCode(e)) {
			e.preventDefault();
			e.stopPropagation();
			forwardKeyEvent(e, 'keyup');
		}
	}

	// Add event listeners with capture phase to intercept before PDF.js
	window.addEventListener('keydown', handleKeyDown, true);
	window.addEventListener('keyup', handleKeyUp, true);
})();

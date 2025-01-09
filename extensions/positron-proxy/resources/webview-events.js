/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This file is derived from the event handlers in the `index.html` file from
 * src/vs/workbench/contrib/webview/browser/pre/index.html. Its job is to absorb
 * vents from the inner iframe and forward them to the host as window messages.
 *
 * This allows the host to dispatch events such as copy/cut/paste commands and
 * context menus to the webview.
 *
 * The other side of the communication is in `index.html`; it receives
 * messages sent from this file and forwards them to the webview host, where
 * they are processed and dispatched.
 *
 * Differences between this file and the original are code-fenced with the comment format:
 * // --- Start Positron Proxy Changes ---
 * ...
 * // --- End Positron Proxy Changes ---
 *
 * Original: src/vs/workbench/contrib/webview/browser/pre/webview-events.js
 *
 * This file is intended for the browser context of Positron, and should not used in the
 * Electron context. Please see the original webview-events.js file for the Electron context.
 */

/**
 * Send a message to the host; this simulates the `hostMessaging` object in the
 * webview.
 */
const hostMessaging = {
	postMessage: (type, data) => {
		// OK to be promiscuous here, as this script is only used in an Electron
		// webview context we already control.
		window.parent.postMessage({
			channel: type,
			data: data,
		}, '*');
	}
};

/**
 * Handles a message sent from the host.
 */
const handlePostMessage = (event) => {
	// Execute a command in the document if requested
	if (event.data.channel === 'execCommand') {
		const command = event.data.data;
		// Check for special Positron commands.
		if (command === 'navigate-back') {
			window.history.back();
			return;
		} else if (command === 'navigate-forward') {
			window.history.forward();
			return;
		} else if (command === 'reload-window') {
			window.location.reload();
			return;
		}

		// Otherwise, execute the command in the document.
		document.execCommand(command);
	}
};

/**
 * @param {MouseEvent} event
 */
const handleAuxClick = (event) => {
	// Prevent middle clicks opening a broken link in the browser
	if (!event?.view?.document) {
		return;
	}

	if (event.button === 1) {
		for (const pathElement of event.composedPath()) {
			/** @type {any} */
			const node = pathElement;
			if (
				node.tagName &&
				node.tagName.toLowerCase() === "a" &&
				node.href
			) {
				event.preventDefault();
				return;
			}
		}
	}
};

// --- Start Positron Proxy Changes ---
/**
 * This is a copy of the handleInnerKeydown function from src/vs/workbench/contrib/webview/browser/pre/index.html,
 * with some modifications for Positron in a browser context.
 * @param {KeyboardEvent} e
 */
const handleInnerKeydown = (e) => {
	// If the keypress would trigger a browser event, such as copy or paste,
	// make sure we block the browser from dispatching it. Instead VS Code
	// handles these events and will dispatch a copy/paste back to the webview
	// if needed
	if (isPrint(e) || isFindEvent(e) || isSaveEvent(e)) {
		e.preventDefault();
	} else if (isUndoRedo(e) || isCopyPasteOrCut(e)) {
		return; // let the browser handle this
	} else if (isCloseTab(e) || isNewWindow(e) || isHelp(e) || isRefresh(e)) {
		// Prevent Ctrl+W closing window / Ctrl+N opening new window in PWA.
		// (No effect in a regular browser tab.)
		e.preventDefault();
	}

	hostMessaging.postMessage('did-keydown', {
		key: e.key,
		keyCode: e.keyCode,
		code: e.code,
		shiftKey: e.shiftKey,
		altKey: e.altKey,
		ctrlKey: e.ctrlKey,
		metaKey: e.metaKey,
		repeat: e.repeat
	});
};
// --- End Positron Proxy Changes ---

/**
 * @param {KeyboardEvent} e
 */
const handleInnerKeyup = (e) => {
	hostMessaging.postMessage("did-keyup", {
		key: e.key,
		keyCode: e.keyCode,
		code: e.code,
		shiftKey: e.shiftKey,
		altKey: e.altKey,
		ctrlKey: e.ctrlKey,
		metaKey: e.metaKey,
		repeat: e.repeat,
	});
};

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isCopyPasteOrCut(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 45: keyCode of "Insert"
	const shiftInsert = e.shiftKey && e.keyCode === 45;
	// 67, 86, 88: keyCode of "C", "V", "X"
	return (hasMeta && [67, 86, 88].includes(e.keyCode)) || shiftInsert;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isUndoRedo(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 90, 89: keyCode of "Z", "Y"
	return hasMeta && [90, 89].includes(e.keyCode);
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isPrint(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 80: keyCode of "P"
	return hasMeta && e.keyCode === 80;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isFindEvent(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 70: keyCode of "F"
	return hasMeta && e.keyCode === 70;
}

let isHandlingScroll = false;

/**
 * @param {WheelEvent} event
 */
const handleWheel = (event) => {
	if (isHandlingScroll) {
		return;
	}

	hostMessaging.postMessage("did-scroll-wheel", {
		deltaMode: event.deltaMode,
		deltaX: event.deltaX,
		deltaY: event.deltaY,
		deltaZ: event.deltaZ,
		detail: event.detail,
		type: event.type,
	});
};

/**
 * @param {Event} event
 */
const handleInnerScroll = (event) => {
	if (isHandlingScroll) {
		return;
	}

	const target = /** @type {HTMLDocument | null} */ (event.target);
	const currentTarget = /** @type {Window | null} */ (
		event.currentTarget
	);
	if (!currentTarget || !target?.body) {
		return;
	}

	const progress = currentTarget.scrollY / target.body.clientHeight;
	if (isNaN(progress)) {
		return;
	}

	isHandlingScroll = true;
	window.requestAnimationFrame(() => {
		try {
			hostMessaging.postMessage("did-scroll", {
				scrollYPercentage: progress,
			});
		} catch (e) {
			// noop
		}
		isHandlingScroll = false;
	});
};

function handleInnerDragStartEvent(/** @type {DragEvent} */ e) {
	if (e.defaultPrevented) {
		// Extension code has already handled this event
		return;
	}

	if (!e.dataTransfer || e.shiftKey) {
		return;
	}

	// Only handle drags from outside editor for now
	if (
		e.dataTransfer.items.length &&
		Array.prototype.every.call(
			e.dataTransfer.items,
			(item) => item.kind === "file",
		)
	) {
		hostMessaging.postMessage("drag-start", undefined);
	}
}
/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isSaveEvent(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 83: keyCode of "S"
	return hasMeta && e.keyCode === 83;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isCloseTab(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 87: keyCode of "W"
	return hasMeta && e.keyCode === 87;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isNewWindow(e) {
	const hasMeta = e.ctrlKey || e.metaKey;
	// 78: keyCode of "N"
	return hasMeta && e.keyCode === 78;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isHelp(e) {
	// 112: keyCode of "F1"
	return e.keyCode === 112;
}

/**
 * @param {KeyboardEvent} e
 * @return {boolean}
 */
function isRefresh(e) {
	// 116: keyCode of "F5"
	return e.keyCode === 116;
}

window.addEventListener('message', handlePostMessage);
window.addEventListener('dragenter', handleInnerDragStartEvent);
window.addEventListener('dragover', handleInnerDragStartEvent);
window.addEventListener('scroll', handleInnerScroll);
window.addEventListener('wheel', handleWheel);
window.addEventListener('auxclick', handleAuxClick);
window.addEventListener('keydown', handleInnerKeydown);
window.addEventListener('keyup', handleInnerKeyup);
window.addEventListener('contextmenu', (e) => {
	if (e.defaultPrevented) {
		// Extension code has already handled this event
		return;
	}

	e.preventDefault();

	/** @type { Record<string, boolean>} */
	let context = {};

	/** @type {HTMLElement | null} */
	let el = e.target;
	while (true) {
		if (!el) {
			break;
		}

		// Search self/ancestors for the closest context data attribute
		el = el.closest("[data-vscode-context]");
		if (!el) {
			break;
		}

		try {
			context = {
				...JSON.parse(el.dataset.vscodeContext),
				...context,
			};
		} catch (e) {
			console.error(
				`Error parsing 'data-vscode-context' as json`,
				el,
				e,
			);
		}

		el = el.parentElement;
	}

	hostMessaging.postMessage('did-context-menu', {
		clientX: e.clientX,
		clientY: e.clientY,
		context: context,
	});
});

// Ask Positron to open a link instead of handling it internally
function openLinkInHost(link) {
	link.addEventListener('click', function (event) {
		hostMessaging.postMessage('did-click-link', { uri: link.href });
		event.preventDefault();
		return false;
	});
}

// When the window loads, look for all links and add a click handler to each
// external link (i.e. links that point to a different origin) that will ask
// Positron to open them instead of handling them internally.
window.addEventListener('load', () => {
	const links = document.getElementsByTagName('a');
	const origin = window.location.origin;
	for (let i = 0; i < links.length; i++) {
		const link = links[i];
		if (link.href && !link.href.startsWith(origin)) {
			openLinkInHost(link);
		}
	}

	// Notify the host that the webview has loaded its content
	hostMessaging.postMessage('did-load-window', {
		title: document.title,
	});
});

// Override the prompt function to return the default value or 'Untitled' if one isnt provided.
// This is needed because the prompt function is not supported in webviews and the prompt function
// is commonly used by libraries like bokeh to provide names for files to save. The main file save
// dialog that positron shows will already provide the ability to change the file name so we're
// just providing a default value here.
window.prompt = (message, _default) => {
	return _default ?? 'Untitled';
};

// Override the window.open function to send a message to the host to open the link instead.
// Save the old window.open function so we can call it after sending the message in case there's
// some other behavior that was depended upon that we're not aware of.
const oldOpen = window.open;
window.open = (url, target, features) => {
	const uri = url instanceof URL ? url.href : url;
	hostMessaging.postMessage('did-click-link', { uri });
	return oldOpen(uri, target, features);
};

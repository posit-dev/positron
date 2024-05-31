/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Send a message to the host
 */
const hostMessaging = {
	postMessage: (type, data) => {
		window.parent.postMessage({
			channel: type,
			data: data,
		}, "*");
	}
};

const handlePostMessage = (event) => {
	console.log('handlePostMessage', event);
	if (event.data.channel === 'execCommand') {
		document.execCommand(event.data.data);
	}
};

/**
 * @param {MouseEvent} event
 */
const handleInnerClick = (event) => {
	if (!event?.view?.document) {
		return;
	}

	const baseElement = event.view.document.querySelector("base");

	for (const pathElement of event.composedPath()) {
		/** @type {any} */
		const node = pathElement;
		if (node.tagName && node.tagName.toLowerCase() === "a" && node.href) {
			if (node.getAttribute("href") === "#") {
				event.view.scrollTo(0, 0);
			} else if (
				node.hash &&
				(node.getAttribute("href") === node.hash ||
					(baseElement && node.href === baseElement.href + node.hash))
			) {
				const fragment = node.hash.slice(1);
				const decodedFragment = decodeURIComponent(fragment);
				const scrollTarget =
					event.view.document.getElementById(fragment) ??
					event.view.document.getElementById(decodedFragment);
				if (scrollTarget) {
					scrollTarget.scrollIntoView();
				} else if (decodedFragment.toLowerCase() === "top") {
					event.view.scrollTo(0, 0);
				}
			} else {
				hostMessaging.postMessage("did-click-link", {
					uri: node.href.baseVal || node.href,
				});
			}
			event.preventDefault();
			return;
		}
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

/**
 * @param {KeyboardEvent} e
 */
const handleInnerKeydown = (e) => {
	// If the keypress would trigger a browser event, such as copy or paste,
	// make sure we block the browser from dispatching it. Instead VS Code
	// handles these events and will dispatch a copy/paste back to the webview
	// if needed
	if (isUndoRedo(e) || isPrint(e) || isFindEvent(e) || isSaveEvent(e) || isCopyPasteOrCut(e)) {
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
		repeat: e.repeat,
	});
};
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
window.addEventListener('click', handleInnerClick);
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


/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

let findText = undefined;
let findResult = false;

window.localStorage.setItem('foo', 'bar');

window.addEventListener('message', (event) => {
	if (window.find) {
		if (event.data.command === 'find') {
			findText = event.data.findText;
			findResult = findText && window.find(findText, false, false, true, false, true);
			window.sessionStorage.setItem(event.data.identifier, `${findResult}`);
			if (findResult) {
				window.focus();
			} else {
				window.getSelection().removeAllRanges();
			}
		} else if (event.data.command === 'find-previous') {
			if (findResult) {
				window.find(findText, false, true, false, false, true);
				window.focus();
			}
		} else if (event.data.command === 'find-next') {
			if (findResult) {
				window.find(findText, false, false, false, false, true);
				window.focus();
			}
		}
	}
}, false);

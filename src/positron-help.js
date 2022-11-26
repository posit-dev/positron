/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

console.log('POSITRON HELP SCRIPT LOADED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

// The find text.
let findText = undefined;
let results = false;

window.addEventListener('load', function () {
	if (window.find) {
		console.log('The window has a find method.');
	}
});

window.addEventListener('message', (event) => {
	if (window.find) {
		if (event.data.command === 'find') {
			findText = event.data.findText;
			results = findText && window.find(findText, false, false, true, false, true);

			if (results) {
				window.focus();
			} else {
				window.getSelection().removeAllRanges();
			}
		} else if (event.data.command === 'find-previous') {
			if (results) {
				window.find(findText, false, true, false, false, true);
				window.focus();
			}
		} else if (event.data.command === 'find-next') {
			if (results) {
				window.find(findText, false, false, false, false, true);
				window.focus();
			}
		}
	}
}, false);

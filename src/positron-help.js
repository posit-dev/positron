/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

console.log('POSITRON HELP SCRIPT LOADED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

// The find text.
let findText = undefined;

window.addEventListener('load', function () {
	if (window.find) {
		console.log('The window has a find method.');
	}
});

window.addEventListener('message', (event) => {
	console.log('The window received a message!');
	console.log(event.data);

	// syntax : window.find(aString, aCaseSensitive, aBackwards, aWrapAround, aWholeWord, aSearchInFrames, aShowDialog);

	if (event.data.command === 'find') {
		if (window.find) {
			findText = event.data.findText;
			if (findText) {
				console.log(`FDIND '${findText}'`);
				window.find(findText, false, false, true, false, true);
				window.focus();
			}
		}
	} else if (event.data.command === 'find-previous') {
		if (window.find) {
			window.find(findText, false, true, false, false, true);
		}
	} else if (event.data.command === 'find-next') {
		if (window.find) {
			window.find(findText, false, false, false, false, true);
		}
	} else if (event.data.command === 'cancel-find') {
		if (window.find) {
			window.find();
		}
	}
}, false);

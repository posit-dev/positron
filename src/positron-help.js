/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

console.log('POSITRON HELP SCRIPT LOADED!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

const findText = 'Here is some bold text';

window.addEventListener('load', function () {
	console.log('The window loaded!!');
	if (window.find) {
		console.log('The window has a find method!');
		console.log(window.find);
		const result = window.find('Here is some bold text');
		console.log(`Find result is ${result}`);
		console.log(window.origin);
	}
});

window.addEventListener('message', (event) => {
	console.log(`The window received a message! ${event.data}`);
	if (event.data === 'find-previous') {
		window.find(findText, false, true, true, false, true);
	} else if (event.data === 'find-next') {
		window.find(findText, false, false, true, false, true);
	}
}, false);

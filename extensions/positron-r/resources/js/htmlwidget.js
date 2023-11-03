/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
export const activate = (_context) => ({

	renderOutputItem(data, element) {
		const h1 = document.createElement('h1');
		h1.innerText = 'R HTML Widget';
		element.appendChild(h1);

		const pre = document.createElement('pre');
		pre.innerText = data.text();
		element.appendChild(pre);
	},
	disposeOutputItem(id) {
	}
});

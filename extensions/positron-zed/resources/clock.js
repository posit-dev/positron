/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Displays a big clock using the VS Code notebook renderer API.
 *
 * @param {*} _ctx Render context (unused)
 * @returns
 */
export const activate = (_ctx) => ({
	renderOutputItem(data, element) {
		const t = data.json();
		const ele = document.createElement('div');
		t.hour = t.hour.toString().padStart(2, '0');
		t.minute = t.minute.toString().padStart(2, '0');
		t.second = t.second.toString().padStart(2, '0');
		ele.innerText = t.hour + ':' + t.minute + ':' + t.second;
		ele.style.fontSize = '30vmin';
		ele.style.textAlign = 'center';
		element.appendChild(ele);
		element.style.display = 'flex';
		element.style.justifyContent = 'center';
		element.style.alignItems = 'center';
		element.style.height = '100vh';
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

define(['require', 'exports', 'react-dom'], function (require, exports) {
	"use strict";
	Object.defineProperty(exports, '__esModule', { value: true });
	exports.createRoot = void 0;
	function createRoot(a, b) {
		const reactDOM = require('react-dom');
		return reactDOM.createRoot(a, b);
	}
	exports.createRoot = createRoot;
});

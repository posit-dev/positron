/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

(function () {

	/**
	 * @import { ISandboxConfiguration } from '../../../../base/parts/sandbox/common/sandboxTypes'
	 */

	const bootstrapWindow = bootstrapWindowLib();

	// Load issue reporter into window
	bootstrapWindow.load(['vs/workbench/contrib/issue/electron-sandbox/issueReporterMain'], function (issueReporter, configuration) {
		return issueReporter.startup(configuration);
	},
		{
			configureDeveloperSettings: function () {
				return {
					forceEnableDeveloperKeybindings: true,
					disallowReloadKeybinding: true
				};
			}
		}
	);

	/**
	 * @returns {{
	 *   load: (
	 *     modules: string[],
	 *     resultCallback: (result: any, configuration: ISandboxConfiguration) => unknown,
	 *     options?: {
	 *       configureDeveloperSettings?: (config: ISandboxConfiguration) => {
	 * 			forceEnableDeveloperKeybindings?: boolean,
	 * 			disallowReloadKeybinding?: boolean,
	 * 			removeDeveloperKeybindingsAfterLoad?: boolean
	 * 		 }
	 *     }
	 *   ) => Promise<unknown>
	 * }}
	 */
	function bootstrapWindowLib() {
		// @ts-ignore (defined in bootstrap-window.js)
		return window.MonacoBootstrapWindow;
	}
}());

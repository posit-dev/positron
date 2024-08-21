/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as base from '@jupyter-widgets/base';
import * as controls from '@jupyter-widgets/controls';
import * as output from '@jupyter-widgets/output';
import { ActivationFunction } from 'vscode-notebook-renderer';
import { PositronWidgetManager } from './manager';
import { Messaging } from './messaging';

// Import CSS files required by the bundled widget packages.
import '@fortawesome/fontawesome-free/css/all.min.css';
import '@fortawesome/fontawesome-free/css/v4-shims.min.css';
import '@jupyter-widgets/base/css/index.css';
import '@jupyter-widgets/controls/css/widgets.css';
import '@lumino/widgets/style/index.css';

function isDefineFn(x: unknown): x is (name: string, fn: () => any) => void {
	return typeof x === 'function';
}

export const activate: ActivationFunction = async (context) => {
	// We bundle the main Jupyter widget packages together with the renderer.
	// However, we still need to define them as AMD modules since if a third party module
	// depends on them it will try to load them with requirejs.
	const define = (window as any).define;
	if (!isDefineFn(define)) {
		throw new Error('Requirejs is needed, please ensure it is loaded on the page.');
	}
	define('@jupyter-widgets/base', () => base);
	define('@jupyter-widgets/controls', () => controls);
	define('@jupyter-widgets/output', () => output);

	// Add the bundled stylesheet to the document head.
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	// It's assumed to be named the same as the bundled .js file but with a .css extension.
	link.href = import.meta.url.replace(/\.js$/, '.css');
	document.head.appendChild(link);

	// Define the typed messaging interface.
	const messaging = new Messaging(context);

	// Create the widget manager.
	const manager = new PositronWidgetManager(messaging, context);

	// Wait until the Positron IPyWidgets instance sends the initialize_result message.
	await new Promise<void>((resolve) => {
		console.debug('positron-ipywidgets renderer: Waiting for initialize_result');
		const disposable = messaging.onDidReceiveMessage(message => {
			if (message.type === 'initialize_result') {
				disposable.dispose();
				resolve();
			}
		});
	});

	console.debug('positron-ipywidgets renderer: Ready!');

	return {
		async renderOutputItem(outputItem, element, _signal) {
			const widgetData = outputItem.json();

			// Check if the widget's comm exists in the manager.
			if (!manager.has_model(widgetData.model_id)) {
				// Try to load all widget comms from the kernel.
				await manager.loadFromKernel();

				// Check if the widget's comm was loaded from the kernel.
				if (!manager.has_model(widgetData.model_id)) {
					throw new Error(`Widget model with ID ${widgetData.model_id} not found`);
				}
			}

			// Render the widget view in the element.
			const model = await manager.get_model(widgetData.model_id);
			const view = await manager.create_view(model);
			manager.display_view(view, element);

			console.log('positron-ipywidgets renderer: done!');
		},
	};
};

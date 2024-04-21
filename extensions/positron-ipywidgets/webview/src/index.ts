/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// import { IClassicComm, WidgetModel, WidgetView } from '@jupyter-widgets/base';
import { DOMWidgetView, IClassicComm, WidgetModel, WidgetView } from '@jupyter-widgets/base';
import { ManagerBase, IManagerState } from '@jupyter-widgets/base-manager';
import { JSONObject } from '@lumino/coreutils';
// import { HTMLManager } from '@jupyter-widgets/html-manager';
// import { JSONObject } from '@lumino/coreutils';

// TODO: Could we type this? Is this necessarily loaded?
// const define = (window as any).define;

const vscode = acquireVsCodeApi();

// TODO: Does everything need to be protected?
class HTMLManager extends ManagerBase {
	protected override loadClass(className: string, moduleName: string, moduleVersion: string): Promise<typeof WidgetModel | typeof WidgetView> {
		console.log('loadClass', className, moduleName, moduleVersion);
		throw new Error('Method not implemented.');
	}

	protected override _create_comm(comm_target_name: string, model_id?: string | undefined, data?: JSONObject | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): Promise<IClassicComm> {
		console.log('_create_comm', comm_target_name, model_id, data, metadata, buffers);
		throw new Error('Method not implemented.');
	}

	protected override _get_comm_info(): Promise<{}> {
		console.log('_get_comm_info');
		throw new Error('Method not implemented.');
	}

	async display_view(
		view: Promise<DOMWidgetView> | DOMWidgetView,
		el: HTMLElement
	): Promise<void> {
		console.log('display_view', view, el);
		throw new Error('Method not implemented.');
	}
	// loadClass(className: string, moduleName: string, moduleVersion: string): Promise<typeof WidgetModel | typeof WidgetView> {
	// 	throw new Error('Method not implemented.');
	// }

	// _create_comm(comm_target_name: string, model_id?: string, data?: JSONObject, metadata?: JSONObject, buffers?: ArrayBuffer[] | ArrayBufferView[]): Promise<IClassicComm> {
	// 	throw new Error('Method not implemented.');
	// }

	// _get_comm_info(): Promise<{}> {
	// 	throw new Error('Method not implemented.');
	// }
}

console.log(HTMLManager);
// console.log(ManagerBase);
// console.log(HTMLManager);

// define('positron-ipywidgets', () => { return { WidgetManager }; });

async function renderManager(
	element: HTMLElement,
	widgetState: unknown,
	managerFactory: () => HTMLManager
): Promise<void> {
	// TODO: validate widgetState?
	// const valid = model_validate(widgetState);
	// if (!valid) {
	//   throw new Error(`Model state has errors: ${model_validate.errors}`);
	// }
	const manager = managerFactory();
	const models = await manager.set_state(widgetState as IManagerState);
	const tags = element.querySelectorAll(
		'script[type="application/vnd.jupyter.widget-view+json"]'
	);
	await Promise.all(
		Array.from(tags).map(async (viewtag) => {
			const widgetViewObject = JSON.parse(viewtag.innerHTML);
			// TODO: validate view state?
			// const valid = view_validate(widgetViewObject);
			// if (!valid) {
			// 	throw new Error(`View state has errors: ${view_validate.errors}`);
			// }
			const model_id: string = widgetViewObject.model_id;
			const model = models.find((item) => item.model_id === model_id);
			if (model !== undefined && viewtag.parentElement !== null) {
				const prev = viewtag.previousElementSibling;
				if (
					prev &&
					prev.tagName === 'img' &&
					prev.classList.contains('jupyter-widget')
				) {
					viewtag.parentElement.removeChild(prev);
				}
				const widgetTag = document.createElement('div');
				widgetTag.className = 'widget-subarea';
				viewtag.parentElement.insertBefore(widgetTag, viewtag);
				const view = await manager.create_view(model);
				manager.display_view(view, widgetTag);
			}
		})
	);
}


async function renderWidgets() {
	const element = document.documentElement;
	const managerFactory = () => new HTMLManager();

	// manager.register('positron-ipywidgets', WidgetManager as any);
	// manager.set_loader_options({ paths: { 'positron-ipywidgets': 'https://localhost:8080/' } });
	// manager.loadClass('positron-ipywidgets', 'WidgetManager', '0.1').then((module: any) => {
	// 	console.log('module', module);
	// });
	const tags = element.querySelectorAll(
		'script[type="application/vnd.jupyter.widget-state+json"]'
	);
	await Promise.all(
		Array.from(tags).map(async (t) =>
			renderManager(element, JSON.parse(t.innerHTML), managerFactory)
		)
	);
}

// TODO: Do we also need to check document.readyState === 'complete'?
window.onload = function () {
	console.log('window.onload');
	renderWidgets().then(() => {
		vscode.postMessage({ type: 'render_complete' });
	}).catch((error) => {
		console.error('Error rendering widgets:', error);
	});
};

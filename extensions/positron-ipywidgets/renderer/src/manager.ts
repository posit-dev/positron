/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as base from '@jupyter-widgets/base';
import { ManagerBase } from '@jupyter-widgets/base-manager';
import { JSONObject } from '@lumino/coreutils';
import * as LuminoWidget from '@lumino/widgets';
import type * as WebviewMessage from '../../../../src/vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';
import { RendererContext } from 'vscode-notebook-renderer';
import { Disposable } from 'vscode-notebook-renderer/events';
import { Messaging } from './messaging';
import { Comm } from './comm';
import { IRenderMime, RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';
import { PositronRenderer } from './renderer';

// This is the default CDN in @jupyter-widgets/html-manager/libembed-amd.
const CDN = 'https://cdn.jsdelivr.net/npm/';

/**
 * Convert a module name and version to a CDN URL.
 *
 * @param moduleName The name of the module.
 * @param moduleVersion The version of the module.
 * @returns The CDN URL.
 */
function moduleNameToCDNUrl(moduleName: string, moduleVersion: string): string {
	// Adapted from @jupyter-widgets/html-manager
	let packageName = moduleName;
	let fileName = 'index'; // default filename
	// if a '/' is present, like 'foo/bar', packageName is changed to 'foo', and path to 'bar'
	// We first find the first '/'
	let index = moduleName.indexOf('/');
	if (index !== -1 && moduleName[0] === '@') {
		// if we have a namespace, it's a different story
		// @foo/bar/baz should translate to @foo/bar and baz
		// so we find the 2nd '/'
		index = moduleName.indexOf('/', index + 1);
	}
	if (index !== -1) {
		fileName = moduleName.substring(index + 1);
		packageName = moduleName.substring(0, index);
	}
	return `${CDN}${packageName}@${moduleVersion}/dist/${fileName}`;
}

/**
 * Create a RenderMimeRegistry with renderer factories for all standard mime types with
 * standard ranks, but all using the PositronRenderer.
 */
function createRenderMimeRegistry(messaging: Messaging, context: RendererContext<any>): RenderMimeRegistry {
	const positronRendererFactory = (options: IRenderMime.IRendererOptions) => {
		return new PositronRenderer(options, messaging, context);
	};

	const factories = [];
	// Reroute all standard mime types (with their default ranks) to the PositronRenderer.
	for (const factory of standardRendererFactories) {
		factories.push({
			...factory,
			createRenderer: positronRendererFactory,
		});
	}
	// Also handle known widget mimetypes.
	factories.push({
		safe: false,
		mimeTypes: [
			'application/geo+json',
			'application/vdom.v1+json',
			'application/vnd.dataresource+json',
			'application/vnd.jupyter.widget-view+json',
			'application/vnd.plotly.v1+json',
			'application/vnd.r.htmlwidget',
			'application/vnd.vega.v2+json',
			'application/vnd.vega.v3+json',
			'application/vnd.vega.v4+json',
			'application/vnd.vega.v5+json',
			'application/vnd.vegalite.v1+json',
			'application/vnd.vegalite.v2+json',
			'application/vnd.vegalite.v3+json',
			'application/vnd.vegalite.v4+json',
			'application/x-nteract-model-debug+json',
		],
		createRenderer: positronRendererFactory,
	});
	return new RenderMimeRegistry({ initialFactories: factories });
}

/**
 * A widget manager that interfaces with the Positron IPyWidgets service and renders to HTML.
 */
export class PositronWidgetManager extends ManagerBase implements base.IWidgetManager, Disposable {
	private _disposables: Disposable[] = [];

	public readonly renderMime: RenderMimeRegistry;

	constructor(
		private readonly _messaging: Messaging,
		context: RendererContext<any>,
	) {
		super();

		this.renderMime = createRenderMimeRegistry(_messaging, context);

		// Handle messages from the runtime.
		this._disposables.push(_messaging.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'comm_open':
					await this._handle_comm_open(message);
					break;
			}
		}));

		// Request initialization from the Positron IPyWidgets instance.
		this._messaging.postMessage({ type: 'initialize_request' });
	}

	private async _handle_comm_open(message: WebviewMessage.ICommOpenToWebview): Promise<void> {
		const comm = new Comm(message.comm_id, message.target_name, this._messaging);
		await this.handle_comm_open(
			comm,
			{
				content: {
					comm_id: message.comm_id,
					target_name: message.target_name,
					data: message.data as JSONObject,
				},
				// This is expected to at least contain the backend widget protocol 'version', which
				// should match the frontend version.
				metadata: message.metadata as JSONObject,
				channel: 'iopub',
				// Stub the rest of the interface - these are not currently used by handle_comm_open.
				header: {
					date: '',
					msg_id: '',
					msg_type: 'comm_open',
					session: '',
					username: '',
					version: '',
				},
				parent_header: {},
			}
		);
	}

	/**
	 * Load a module containing IPyWidget widgets.
	 *
	 * @param moduleName The name of the module.
	 * @param moduleVersion The version of the module.
	 * @returns Promise that resolves with the loaded module.
	 */
	private async loadModule(moduleName: string, moduleVersion: string): Promise<any> {
		// Adapted from @jupyter-widgets/html-manager.

		// Get requirejs from the window object.
		const require = (window as any).requirejs;
		if (require === undefined) {
			throw new Error('Requirejs is needed, please ensure it is loaded on the page.');
		}

		try {
			// Try to load the module with requirejs.
			return await new Promise((resolve, reject) => require([moduleName], resolve, reject));
		} catch (err) {
			// We failed to load the module with requirejs, fall back to a CDN.
			const failedId = err.requireModules && err.requireModules[0];
			if (failedId) {
				// Undefine the failed module to allow requirejs to try again.
				if (require.specified(failedId)) {
					require.undef(failedId);
				}

				// Configure requirejs to load the module from the CDN.
				console.log(`Falling back to ${CDN} for ${moduleName}@${moduleVersion}`);
				require.config({
					paths: { [moduleName]: moduleNameToCDNUrl(moduleName, moduleVersion) }
				});

				// Try to load the module with requirejs again.
				return await new Promise((resolve, reject) => require([moduleName], resolve, reject));
			}
		}

		throw new Error(`Error loading module ${moduleName}@${moduleVersion}`);
	}

	/**
	 * Load a class and return a promise to the loaded object.
	 * @param className The name of the class.
	 * @param moduleName The name of the module.
	 * @param moduleVersion The version of the module.
	 * @returns Promise that resolves with the class.
	 */
	protected override async loadClass(className: string, moduleName: string, moduleVersion: string): Promise<typeof base.WidgetModel | typeof base.WidgetView> {
		const module = await this.loadModule(moduleName, moduleVersion);
		if (!module[className]) {
			throw new Error(`Class ${className} not found in module ${moduleName}@${moduleVersion}`);
		}
		return module[className];
	}

	/**
	 * Create a comm which can be used for communication for a widget.
	 *
	 * If the data/metadata is passed in, open the comm before returning (i.e.,
	 * send the comm_open message). If the data and metadata is undefined, we
	 * want to reconstruct a comm that already exists in the kernel, so do not
	 * open the comm by sending the comm_open message.
	 *
	 * @param comm_target_name Comm target name
	 * @param model_id The comm id
	 * @param data The initial data for the comm
	 * @param metadata The metadata in the open message
	 */
	protected override async _create_comm(
		comm_target_name: string,
		model_id?: string | undefined,
		data?: JSONObject | undefined,
		metadata?: JSONObject | undefined,
		_buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined
	): Promise<base.IClassicComm> {
		if (!model_id) {
			throw new Error('model_id is required to create a comm.');
		}

		const comm = new Comm(model_id, comm_target_name, this._messaging);

		// Notify the kernel about the comm.
		if (data || metadata) {
			this._messaging.postMessage({
				type: 'comm_open',
				comm_id: model_id,
				target_name: comm_target_name,
				data: data,
				metadata: metadata,
			});
		}
		return comm;
	}

	/**
	 * Get the currently-registered comms from the runtime.
	 */
	protected override _get_comm_info(): Promise<{}> {
		throw new Error('Method not implemented.');
	}

	/**
	 * Display a view in an HTML element.
	 *
	 * @param view The view to display.
	 * @param element The HTML element to display the view in.
	 * @returns Promise that resolves when the view is displayed.
	 */
	async display_view(view: base.DOMWidgetView, element: HTMLElement): Promise<void> {
		LuminoWidget.Widget.attach(view.luminoWidget, element);
	}

	loadFromKernel(): Promise<void> {
		return this._loadFromKernel();
	}

	private readonly _messageHandlers = new Map<string, Disposable>();

	async registerMessageHandler(msgId: string, handler: (message: WebviewMessage.IKernelMessageToWebview) => void): Promise<void> {
		if (this._messageHandlers.has(msgId)) {
			throw new Error(`Message handler already exists for msgId: ${msgId}`);
		}

		// TODO: Does the backend need to know about the registered message handler?
		//       I suppose it eventually does so that it can _not_ show the messages elsewhere...
		//       But we can implement that next.
		// this._messaging.postMessage({ type: 'register_message_handler', msg_id: msgId });

		this._messageHandlers.set(
			msgId,
			this._messaging.onDidReceiveMessage(async (message) => {
				if (message.type === 'kernel_message' && message.parent_id === msgId) {
					handler(message);
				}
			})
		);
	}

	removeMessageHandler(msgId: string): void {
		const handler = this._messageHandlers.get(msgId);
		if (!handler) {
			throw new Error(`No message handler for msgId: ${msgId}`);
		}
		this._messageHandlers.delete(msgId);
		handler.dispose();
	}

	dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}
}

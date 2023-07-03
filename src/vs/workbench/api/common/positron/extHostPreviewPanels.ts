/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { serializeWebviewOptions, toExtensionData, ExtHostWebview, ExtHostWebviews } from 'vs/workbench/api/common/extHostWebview';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import type * as vscode from 'vscode';
import type * as positron from 'positron';
import * as extHostProtocol from './extHost.positron.protocol';

type IconPath = URI | { readonly light: URI; readonly dark: URI };

/**
 * `ExtHostPreviewPanel` is the implementation of `vscode.PreviewPanel` that
 * lives in the extension host. It wraps an `ExtHostWebView` with metadata about
 * how the view is displayed in the Preview panel.
 *
 * This class is similar to `ExtHostWebviewPanel` in that it hosts a webview in
 * a UI panel, but different in that the webview lives in Positron's preview
 * panel instead of a view column or editor group.
 */
class ExtHostPreviewPanel extends Disposable implements positron.PreviewPanel {

	readonly #handle: extHostProtocol.PreviewHandle;
	readonly #proxy: extHostProtocol.MainThreadPreviewPanelShape;
	readonly #viewType: string;

	readonly #webview: ExtHostWebview;

	#title: string;
	#iconPath?: IconPath;
	#visible: boolean = true;
	#active: boolean;
	#isDisposed: boolean = false;

	readonly #onDidDispose = this._register(new Emitter<void>());
	public readonly onDidDispose = this.#onDidDispose.event;

	readonly #onDidChangeViewState = this._register(new Emitter<positron.PreviewPanelOnDidChangeViewStateEvent>());
	public readonly onDidChangeViewState = this.#onDidChangeViewState.event;

	/**
	 * Construct a new PreviewPanel.
	 *
	 * @param handle Unique handle for the preview panel
	 * @param proxy A proxy to the main thread
	 * @param webview The webview that will be displayed in the preview panel
	 * @param params The initial state of the preview panel
	 */
	constructor(
		handle: extHostProtocol.PreviewHandle,
		proxy: extHostProtocol.MainThreadPreviewPanelShape,
		webview: ExtHostWebview,
		params: {
			viewType: string;
			title: string;
			active: boolean;
		}
	) {
		super();
		this.#handle = handle;
		this.#proxy = proxy;
		this.#webview = webview;
		this.#viewType = params.viewType;
		this.#title = params.title;
		this.#active = params.active;
	}

	public override dispose() {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;
		this.#onDidDispose.fire();

		this.#proxy.$disposePreview(this.#handle);
		this.#webview.dispose();

		super.dispose();
	}

	get webview() {
		this.assertNotDisposed();
		return this.#webview;
	}

	get viewType(): string {
		this.assertNotDisposed();
		return this.#viewType;
	}

	get title(): string {
		this.assertNotDisposed();
		return this.#title;
	}

	set title(value: string) {
		this.assertNotDisposed();
		if (this.#title !== value) {
			this.#title = value;
			this.#proxy.$setTitle(this.#handle, value);
		}
	}

	get iconPath(): IconPath | undefined {
		this.assertNotDisposed();
		return this.#iconPath;
	}

	get options() {
		return {
			enableFindWidget: false,
			retainContextWhenHidden: true,
		};
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		return undefined;
	}

	public get active(): boolean {
		this.assertNotDisposed();
		return this.#active;
	}

	public get visible(): boolean {
		this.assertNotDisposed();
		return this.#visible;
	}

	_updateViewState(newState: { active: boolean; visible: boolean }) {
		if (this.#isDisposed) {
			return;
		}

		if (this.active !== newState.active || this.visible !== newState.visible) {
			this.#active = newState.active;
			this.#visible = newState.visible;
			this.#onDidChangeViewState.fire({ previewPanel: this });
		}
	}

	public reveal(preserveFocus?: boolean): void {
		this.assertNotDisposed();
		this.#proxy.$reveal(this.#handle, !!preserveFocus);
	}

	private assertNotDisposed() {
		if (this.#isDisposed) {
			throw new Error('Webview is disposed');
		}
	}
}

/**
 * Extension host side of the Preview pane's API.
 */
export class ExtHostPreviewPanels implements extHostProtocol.ExtHostPreviewPanelShape {

	/**
	 * Generator for preview panel handles, also referred to as "preview IDs" on
	 * the main thread side.
	 *
	 * @returns A new handle for a preview panel
	 */
	private static newHandle(): extHostProtocol.PreviewHandle {
		return generateUuid();
	}

	/** A proxy to the main thread to trigger UI actions (create/reveal/etc) */
	private readonly _proxy: extHostProtocol.MainThreadPreviewPanelShape;

	/** A map of all known previews; handle to instance */
	private readonly _previewPanels = new Map<extHostProtocol.PreviewHandle, ExtHostPreviewPanel>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly webviews: ExtHostWebviews,
		private readonly workspace: IExtHostWorkspace | undefined,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadPreviewPanel);
	}

	public createPreviewPanel(
		extension: IExtensionDescription,
		viewType: string,
		title: string,
		preserveFocus?: boolean,
		options: positron.PreviewOptions = {},
	): positron.PreviewPanel {

		const handle = ExtHostPreviewPanels.newHandle();
		this._proxy.$createPreviewPanel(toExtensionData(extension), handle, viewType, {
			title,
			webviewOptions: serializeWebviewOptions(extension, this.workspace, options),
		}, !!preserveFocus);

		const webview = this.webviews.$createNewWebview(handle, options, extension);
		const panel = this.createNewPreviewPanel(handle, viewType, title, webview as ExtHostWebview, true);

		return panel;
	}

	public $onDidChangePreviewPanelViewStates(newStates: extHostProtocol.PreviewPanelViewStateData): void {
		// Note: This logic is largely copied from
		// `$onDidChangeWebviewPanelViewStates`, and is written to handle
		// batched updates to view state changes. Currently, the main thread
		// side of the view state manager doesn't batch updates, but it's
		// somewhat likely that it will in the future, so we duplicate the sort
		// logic here.

		const handles = Object.keys(newStates);
		// Notify webviews of state changes in the following order:
		// - Non-visible
		// - Visible
		// - Active
		handles.sort((a, b) => {
			const stateA = newStates[a];
			const stateB = newStates[b];
			if (stateA.active) {
				return 1;
			}
			if (stateB.active) {
				return -1;
			}
			return (+stateA.visible) - (+stateB.visible);
		});

		for (const handle of handles) {
			const panel = this.getPreviewPanel(handle);
			if (!panel) {
				continue;
			}

			const newState = newStates[handle];
			panel._updateViewState({
				active: newState.active,
				visible: newState.visible,
			});
		}
	}

	async $onDidDisposePreviewPanel(handle: extHostProtocol.PreviewHandle): Promise<void> {
		const panel = this.getPreviewPanel(handle);
		panel?.dispose();

		this._previewPanels.delete(handle);
		this.webviews.$deleteWebview(handle);
	}

	public createNewPreviewPanel(previewHandle: string, viewType: string, title: string, webview: ExtHostWebview, active: boolean) {
		const panel = new ExtHostPreviewPanel(previewHandle, this._proxy, webview, { viewType, title, active });
		this._previewPanels.set(previewHandle, panel);
		return panel;
	}

	public getPreviewPanel(handle: extHostProtocol.PreviewHandle): ExtHostPreviewPanel | undefined {
		return this._previewPanels.get(handle);
	}
}


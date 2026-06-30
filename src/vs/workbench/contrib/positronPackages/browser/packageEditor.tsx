/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { PackageEditorInput } from './packageEditorInput.js';
import { PackageDetail } from './components/packageDetail.js';

/**
 * PackageEditor class.
 * An EditorPane that mounts the PackageDetail React component into an editor tab.
 */
export class PackageEditor extends EditorPane {

	static readonly ID = 'workbench.editor.positronPackageDetail';

	private readonly _container: HTMLElement;
	private _reactRenderer?: PositronReactRenderer;

	constructor(
		group: IEditorGroup,
		@IPositronPackagesService private readonly _packagesService: IPositronPackagesService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(PackageEditor.ID, group, telemetryService, themeService, storageService);
		this._container = DOM.$('.positron-package-detail-container');
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PackageEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		this.disposeRenderer();
		this._reactRenderer = new PositronReactRenderer(this._container);
		this._reactRenderer.render(
			<PackageDetail
				languageId={input.identity.languageId}
				packageName={input.identity.packageName}
				packagesService={this._packagesService}
				sessionId={input.identity.sessionId}
			/>
		);
		await super.setInput(input, options, context, token);
	}

	override clearInput(): void {
		this.disposeRenderer();
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);
	}

	override dispose(): void {
		this.disposeRenderer();
		super.dispose();
	}

	private disposeRenderer(): void {
		this._reactRenderer?.dispose();
		this._reactRenderer = undefined;
	}
}

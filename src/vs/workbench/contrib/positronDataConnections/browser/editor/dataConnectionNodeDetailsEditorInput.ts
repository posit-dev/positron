/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IUntypedEditorInput, Verbosity } from '../../../../common/editor.js';
import { IDataConnectionNodeDetailsDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';

/**
 * The node a details editor describes, as the tree saw it when the editor was opened.
 */
export interface IDataConnectionNodeDetailsTarget {
	// Identifies the node across tree refreshes: its connection profile and the kind and name of
	// each node on the way down to it. Node handles are re-minted on every fetch, so they can't
	// serve; this is what lets clicking the same node again reuse its tab.
	readonly key: string;

	// The node's name, which is the tab's label.
	readonly name: string;

	// The codicon id the tree shows for the node, reused as the tab icon.
	readonly icon: string;

	// The names on the way down to the node, from the connection to the node itself, shown as the
	// tab's tooltip so two tabs for same-named nodes can be told apart, and as the page's breadcrumbs.
	readonly path: readonly string[];

	// The id of the connection profile the node belongs to.
	readonly profileId: string;

	// The reload key of each row on the way down from the connection to the node itself, group rows
	// ("Tables", "Metrics") included, so the tree can walk straight back down it rather than search
	// the groups for each node.
	readonly nodePath: readonly string[];

	// For each entry of path, how much of nodePath leads to it: 0 for the connection, and for any
	// other node the length of the nodePath prefix that ends at it. A breadcrumb reveals its node
	// with that prefix.
	readonly breadcrumbNodePathLengths: readonly number[];

	// Whether the node can be opened in the Data Explorer, so the page offers a button for it.
	readonly canPreview: boolean;
}

/**
 * DataConnectionNodeDetailsEditorInput class.
 * The input for a data connection node's details editor. It holds a snapshot of the details rather
 * than a live link to the node: node handles die when the tree refreshes or the connection closes,
 * and a details tab shouldn't break, or keep the connection open, because of either. Clicking the
 * node again fetches fresh details and hands them to the existing input via setDetails.
 */
export class DataConnectionNodeDetailsEditorInput extends EditorInput {
	//#region Static Properties

	/**
	 * Gets the type ID.
	 */
	static readonly TypeID: string = 'workbench.input.positronDataConnectionNodeDetails';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronDataConnectionNodeDetails';

	//#endregion Static Properties

	//#region Private Properties

	/**
	 * The current details snapshot.
	 */
	private _details: IDataConnectionNodeDetailsDTO;

	/**
	 * The emitter for the onDidChangeDetails event.
	 */
	private readonly _onDidChangeDetailsEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param target The node the editor describes.
	 * @param details The node's details.
	 */
	constructor(
		readonly target: IDataConnectionNodeDetailsTarget,
		details: IDataConnectionNodeDetailsDTO,
	) {
		super();
		this._details = details;
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Fires when the details are replaced.
	 */
	readonly onDidChangeDetails: Event<void> = this._onDidChangeDetailsEmitter.event;

	/**
	 * Gets the current details snapshot.
	 */
	get details(): IDataConnectionNodeDetailsDTO {
		return this._details;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Replaces the details snapshot with a freshly fetched one.
	 * @param details The node's details.
	 */
	setDetails(details: IDataConnectionNodeDetailsDTO): void {
		this._details = details;
		this._onDidChangeDetailsEmitter.fire();
	}

	//#endregion Public Methods

	//#region EditorInput Overrides

	/**
	 * Gets the type identifier.
	 */
	override get typeId(): string {
		return DataConnectionNodeDetailsEditorInput.TypeID;
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return DataConnectionNodeDetailsEditorInput.EditorID;
	}

	/**
	 * Gets the resource. A node has no resource; it is identified by its target's key.
	 */
	override get resource(): URI | undefined {
		return undefined;
	}

	/**
	 * Gets the capabilities of this input. The editor describes the node; it never edits it.
	 */
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	/**
	 * Gets the display name of this input, which is the tab's label.
	 */
	override getName(): string {
		return this.target.name;
	}

	/**
	 * Gets the title of this input, which is the tab's tooltip: the node's full path.
	 * @param verbosity The verbosity.
	 */
	override getTitle(verbosity?: Verbosity): string {
		return verbosity === Verbosity.SHORT ? this.target.name : this.target.path.join(' / ');
	}

	/**
	 * Gets the icon to display in the editor tab.
	 */
	override getIcon(): ThemeIcon {
		return ThemeIcon.fromId(this.target.icon);
	}

	/**
	 * Determines whether the other input matches this input.
	 * @param otherInput The other input.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}

		return otherInput instanceof DataConnectionNodeDetailsEditorInput &&
			otherInput.target.key === this.target.key;
	}

	//#endregion EditorInput Overrides
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * RuntimeItem class.
 */
export class RuntimeItem {
	//#region Protected Properties

	/**
	 * Gets or sets a value which indicates whether the item is hidden.
	 */
	protected _isHidden = false;

	//#endregion Protected Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 */
	constructor(readonly id: string) {
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets a value which indicates whether the item is hidden.
	 */
	public get isHidden(): boolean {
		return this._isHidden;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the runtime item.
	 * @param commentPrefix The comment prefix to use.
	 * @note Override in derived classes to provide a clipboard representation.
	 * @returns The clipboard representation of the runtime item.
	 */
	public getClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @note The default implementation treats a runtime item as a single item, so it is either
	 * entirely visible or entirely hidden. Override in derived classes to provide a different
	 * behavior.
	 * @returns The remaining scrollback size.
	 */
	public optimizeScrollback(scrollbackSize: number) {
		// If scrollback size is zero, hide the item and return zero.
		if (!scrollbackSize) {
			this._isHidden = true;
			return 0;
		}

		// Unhide the item and return the scrollback size minus one.
		this._isHidden = false;
		return scrollbackSize - 1;
	}

	//#endregion Public Methods
}

/**
 * RuntimeItemStandard class.
 */
export class RuntimeItemStandard extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The message.
	 */
	constructor(id: string, message: string) {
		// Call the base class's constructor.
		super(id);

		// Process the message directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(message);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
	}

	//#endregion Public Methods
}

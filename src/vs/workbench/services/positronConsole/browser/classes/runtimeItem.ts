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
	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 */
	constructor(readonly id: string) {
	}

	//#endregion Constructor

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

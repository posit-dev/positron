/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This module is adapted from the MIT licensed https://github.com/posit-dev/databot repo.
 */

export type ProcessedText = {
	type: 'text';
	text: string;
};

export type ProcessedTag<TagNameT extends string> = {
	type: 'tag';
	name: TagNameT;
	kind: 'open' | 'close';
	attributes: Record<string, string>;
	originalText: string;
};

export type Chunk<T extends string> = ProcessedText | ProcessedTag<T>;

export class StreamingTagLexer<TagNameT extends string> {
	private readonly tagNames: TagNameT[];
	private readonly contentHandler: (
		chunk: Chunk<TagNameT>
	) => void | Promise<void>;

	// Variables for tracking the state of the lexer
	private state:
		| 'TEXT' // Initial state - we're not in a potential tag
		| 'TAG_START' // We've seen '<'
		| 'TAG_START_SLASH' // We've seen '</'
		| 'TAG_NAME' // We're in a potential tag name, like '<SH' or '</SH'
		| 'WHITESPACE' // We're in whitespace after the tag name or betweent attrs
		| 'ATTR_NAME' // We're in an attribute name, like '<FILESET F'
		| 'ATTR_NAME_END' // Finished attr name with whitespace, like '<FILESET FOO ' (doesn't always go into this state)
		| 'ATTR_EQUAL_FOUND' // Found = sign after attr name, like '<FILESET FOO='
		| 'IN_ATTR_VALUE_DOUBLE_QUOTE' // Found opening double quote for attr value, like `<FILESET FOO='`
		| 'IN_ATTR_VALUE_SINGLE_QUOTE' // Found opening single quote for attr value, like `<FILESET FOO='`
		| 'ATTRIBUTE_VALUE_END' // Found closing quote for attr value, like `<FILESET FOO='1'`
		| 'TAG_END' = 'TEXT'; // Found closing angle bracket, like `<FILESET>`

	private scannedText: string = '';

	// Variables for tracking the state when we're in a potential tag
	private tagName: TagNameT | null = null;
	private tagNamePartial: string = ''; // Partial tag name as we build it
	private kind: 'open' | 'close' = 'open';
	private currentAttributeName: string = '';
	private currentAttributeValue: string = '';
	private attributes: Record<string, string> = {};
	// Counter for iterating over a tag name character by character.
	private tagNamePartialIdx = 0;
	private potentialTagNameMatches: TagNameT[] = [];

	private resetPotentialTagStateVars() {
		this.tagNamePartialIdx = 0;
		this.potentialTagNameMatches = [...this.tagNames];
		this.tagName = null;
		this.tagNamePartial = '';
		this.kind = 'open';
		this.currentAttributeName = '';
		this.currentAttributeValue = '';
		this.attributes = {};
	}

	/**
	 * Creates a new StreamingTagLexer that looks for specified XML-style tags.
	 * @param tagNames - Array of tag names without angle brackets or attributes
	 *   (e.g., ['FILESET', 'FILE'])
	 * @param contentHandler - Callback function that will be invoked with each
	 *   processed chunk, either text or a tag
	 */
	constructor({
		tagNames,
		contentHandler,
	}: {
		tagNames: Readonly<Array<TagNameT>>;
		contentHandler: (
			chunk: ProcessedText | ProcessedTag<TagNameT>
		) => void | Promise<void>;
	}) {
		// TODO: Validate tag names
		this.tagNames = [...tagNames];
		this.contentHandler = contentHandler;
		this.resetPotentialTagStateVars();
	}

	/**
	 * Processes a chunk of text to identify and handle specific tags. Accumulates
	 * text until a complete tag is found, then invokes the contentHandler
	 * callback with each processed chunk (text or tag).
	 *
	 * @param chunk - The chunk of text to process.
	 */
	async process(chunk: string): Promise<void> {
		for (const char of chunk) {
			if (this.state === 'TEXT') {
				if (char === '<') {
					if (this.scannedText.length > 0) {
						await this.contentHandler({ type: 'text', text: this.scannedText });
						this.scannedText = '';
					}

					this.state = 'TAG_START';
				} else {
					// Just more text; don't change state
				}
			} else if (this.state === 'TAG_START') {
				if (char === '/') {
					// We have '</'
					this.state = 'TAG_START_SLASH';
				} else if (/^[a-zA-Z0-9]$/.test(char)) {
					// This is a valid starting character for a tag name
					// Iterate backward over the list of potentialTagNameMatches because we
					// may remove items as we go.
					for (let j = this.potentialTagNameMatches.length - 1; j >= 0; j--) {
						if (
							char !== this.potentialTagNameMatches[j][this.tagNamePartialIdx]
						) {
							// Character mismatch: we can remove this tag name from the list of
							// potential matches.
							this.potentialTagNameMatches.splice(j, 1);
						}
					}

					if (this.potentialTagNameMatches.length === 0) {
						// Didn't match any tag names, as in '<Z'
						this.resetPotentialTagStateVars();
						this.state = 'TEXT';
					}

					this.state = 'TAG_NAME';
					this.tagNamePartial = char;
					this.kind = 'open';
					this.tagNamePartialIdx++;
				} else {
					// Not a valid tag name starting character
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'TAG_START_SLASH') {
				if (/^[a-zA-Z0-9]$/.test(char)) {
					for (let j = this.potentialTagNameMatches.length - 1; j >= 0; j--) {
						if (
							char !== this.potentialTagNameMatches[j][this.tagNamePartialIdx]
						) {
							this.potentialTagNameMatches.splice(j, 1);
						}
					}

					if (this.potentialTagNameMatches.length === 0) {
						// Didn't match any tag names, as in '</Z'
						this.resetPotentialTagStateVars();
						this.state = 'TEXT';
					}

					this.state = 'TAG_NAME';
					this.tagNamePartial = char;
					this.kind = 'close';
					this.tagNamePartialIdx++;
				} else {
					// Not a valid tag name starting character
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'TAG_NAME') {
				// This state: We're in a tag name and have at least one character

				if (char === ' ' || char === '>') {
					// Filter out potentialTagNameMatches that aren't the correct length.
					// So if the potentialTagNameMatches are ['SHINY', 'FILESET'], and
					// the text up to here is '<SHINY>', we should remove 'FILESET' from
					// the potential matches. (For consistency, we're not using filter();
					// elsewhere in the code we're modifying the array in place.)
					for (let i = this.potentialTagNameMatches.length - 1; i >= 0; i--) {
						if (
							this.tagNamePartialIdx !== this.potentialTagNameMatches[i].length
						) {
							this.potentialTagNameMatches.splice(i, 1);
						}
					}
					// If we hit the end of a tag name, we can transition to the next state.
					if (this.potentialTagNameMatches.length === 1) {
						this.tagName = this.tagNamePartial as TagNameT;
						if (char === ' ') {
							// '<FILESET '
							this.state = 'WHITESPACE';
						} else if (char === '>') {
							// '<FILESET>'
							this.state = 'TAG_END';
						} else {
							// Shouldn't get here, throw error
							throw new Error(`Unexpected character: ${char}`);
						}
					} else {
						// If we got here, then it's something like '<SHIN>' or '<SHINYA '
						this.resetPotentialTagStateVars();
						this.state = 'TEXT';
					}
				} else if (/^[a-zA-Z0-9_-]$/.test(char)) {
					for (let j = this.potentialTagNameMatches.length - 1; j >= 0; j--) {
						if (
							char !== this.potentialTagNameMatches[j][this.tagNamePartialIdx]
						) {
							this.potentialTagNameMatches.splice(j, 1);
						}
					}

					if (this.potentialTagNameMatches.length === 0) {
						// Didn't match any tag names, as in '<SHINYX'
						this.resetPotentialTagStateVars();
						this.state = 'TEXT';
					}

					this.tagNamePartial += char;
					this.tagNamePartialIdx++;
				} else {
					// Not a valid tag name character, as in '<SHIN!'
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'WHITESPACE') {
				if (/^[a-zA-Z0-9]$/.test(char)) {
					// TODO: Closing tags shouldn't have attributes
					// Could be the start of an attribute name
					this.state = 'ATTR_NAME';
					this.currentAttributeName = char;
				} else if (char === ' ') {
					// Stay in this state
				} else if (char === '>') {
					this.state = 'TAG_END';
				} else {
					// Invalid character - we're not in a tag
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'ATTR_NAME') {
				if (/^[a-zA-Z0-9_-]$/.test(char)) {
					// Stay in this state
					this.currentAttributeName += char;
				} else if (char === ' ') {
					this.state = 'ATTR_NAME_END';
				} else if (char === '=') {
					this.state = 'ATTR_EQUAL_FOUND';
				} else {
					// Invalid character
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'ATTR_NAME_END') {
				if (char === ' ') {
					// Stay in this state
				} else if (char === '=') {
					this.state = 'ATTR_EQUAL_FOUND';
				} else {
					// Invalid character
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'ATTR_EQUAL_FOUND') {
				if (char === ' ') {
					// Stay in this state
				} else if (char === '"') {
					// Found opening quote - now we're in the attribute value
					this.state = 'IN_ATTR_VALUE_DOUBLE_QUOTE';
					this.currentAttributeValue = '';
				} else if (char === '"') {
					this.state = 'IN_ATTR_VALUE_SINGLE_QUOTE';
					this.currentAttributeValue = '';
				} else {
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			} else if (this.state === 'IN_ATTR_VALUE_DOUBLE_QUOTE') {
				if (char === '"') {
					// Found closing quote. Save the attribute name-value pair and reset
					// the accumulators.
					this.state = 'ATTRIBUTE_VALUE_END';
					this.attributes[this.currentAttributeName] =
						this.currentAttributeValue;
					this.currentAttributeName = '';
					this.currentAttributeValue = '';
				} else if (char === '>') {
					// The attribute value shouldn't have a '>'. Those should be escaped.
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				} else {
					this.currentAttributeValue += char;
				}
			} else if (this.state === 'IN_ATTR_VALUE_SINGLE_QUOTE') {
				// This block behaves the same as the double-quote block above.
				if (char === '"') {
					this.state = 'ATTRIBUTE_VALUE_END';
					this.attributes[this.currentAttributeName] =
						this.currentAttributeValue;
					this.currentAttributeName = '';
					this.currentAttributeValue = '';
				} else if (char === '>') {
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				} else {
					this.currentAttributeValue += char;
				}
			} else if (this.state === 'ATTRIBUTE_VALUE_END') {
				if (char === ' ') {
					this.state = 'WHITESPACE';
				} else if (char === '>') {
					this.state = 'TAG_END';
				} else {
					this.resetPotentialTagStateVars();
					this.state = 'TEXT';
				}
			}

			this.scannedText += char;

			// We found a complete tag! Add it to the result and reset the state.
			if (this.state === 'TAG_END') {
				await this.contentHandler({
					type: 'tag',
					name: this.tagName as TagNameT,
					kind: this.kind,
					attributes: structuredClone(this.attributes),
					originalText: this.scannedText,
				});
				this.scannedText = '';
				this.resetPotentialTagStateVars();
				this.state = 'TEXT';
			}
		}

		// At the end of the chunk, if we're in the TEXT state, we can flush the
		// text.
		if (this.state === 'TEXT') {
			if (this.scannedText.length > 0) {
				await this.contentHandler({ type: 'text', text: this.scannedText });
				this.scannedText = '';
			}
		}
	}

	/**
	 * Sends any content that has been scanned but not yet sent to the
	 * contentHandler (for example, if it was a potential start of a tag like
	 * '<FI', and waiting for the rest of the tag) will be sent to the
	 * contentHandler, as type: 'text'. This should be called at the end of the
	 * text stream.
	 */
	async flush(): Promise<void> {
		if (this.scannedText.length > 0) {
			await this.contentHandler({ type: 'text', text: this.scannedText });
			this.scannedText = '';
		}
	}
}

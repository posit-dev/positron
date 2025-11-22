/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';
import { IInputHistoryEntry } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { applyFontInfo } from '../../../../../editor/browser/config/domFontInfo.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';

const ttPolicy = createTrustedTypesPolicy('positronHistoryEntry', { createHTML: value => value });

/**
 * Props for the HistoryEntry component
 */
interface HistoryEntryProps {
	entry: IInputHistoryEntry;
	index: number;
	style: CSSProperties;
	isSelected: boolean;
	hasFocus: boolean;
	languageId: string;
	searchText?: string;
	onSelect: () => void;
	onHeightChange: (height: number) => void;
	onToConsole: () => void;
	onToSource: () => void;
	onCopy: () => void;
	instantiationService: IInstantiationService;
	fontInfo: FontInfo;
}

/**
 * Maximum number of lines to show when collapsed
 */
const MAX_COLLAPSED_LINES = 4;

/**
 * Find all match positions in text (case insensitive)
 */
const findMatches = (text: string, search: string): Array<{ start: number; end: number }> => {
	if (!search) {
		return [];
	}

	const matches: Array<{ start: number; end: number }> = [];
	const searchLower = search.toLowerCase();
	const textLower = text.toLowerCase();
	let pos = 0;

	while (pos < text.length) {
		const index = textLower.indexOf(searchLower, pos);
		if (index === -1) {
			break;
		}
		matches.push({ start: index, end: index + search.length });
		pos = index + search.length;
	}

	return matches;
};

/**
 * Decode HTML entities to get the actual text character
 */
const decodeEntity = (entity: string): string => {
	const textarea = document.createElement('textarea');
	textarea.innerHTML = entity;
	return textarea.value;
};

/**
 * Highlight matches in HTML string by wrapping them with <mark> tags
 * This function carefully preserves the HTML structure and only highlights text content
 */
const highlightMatchesInHtml = (html: string, text: string, search: string): string => {
	if (!search) {
		return html;
	}

	const matches = findMatches(text, search);
	if (matches.length === 0) {
		return html;
	}

	// Build a set of text positions that should be highlighted for O(1) lookup
	const highlightSet = new Set<number>();
	for (const match of matches) {
		for (let i = match.start; i < match.end; i++) {
			highlightSet.add(i);
		}
	}

	// Walk through the HTML and track text position
	// Key: Monaco uses <br/> for newlines, which we need to count as \n characters
	let result = '';
	let textPos = 0;
	let i = 0;
	let inTag = false;
	let inHighlight = false;

	while (i < html.length) {
		const char = html[i];

		if (char === '<') {
			// Check if this is a <br/> or <br> tag
			const isBr = html.substring(i, i + 4) === '<br>' || html.substring(i, i + 5) === '<br/>';

			if (isBr) {
				// <br> represents a newline character in the original text
				const shouldHighlight = highlightSet.has(textPos);

				// Close highlight if needed before the br tag
				if (!shouldHighlight && inHighlight) {
					result += '</mark>';
					inHighlight = false;
				}

				// Add the br tag
				if (html.substring(i, i + 5) === '<br/>') {
					result += '<br/>';
					i += 5;
				} else {
					result += '<br>';
					i += 4;
				}

				// Count this as a newline character
				textPos++;

				// Reopen highlight if needed after the br tag
				if (textPos < text.length && highlightSet.has(textPos) && !inHighlight) {
					result += '<mark class="history-search-highlight">';
					inHighlight = true;
				}

				continue;
			}

			// Regular tag - close any open highlight
			if (inHighlight) {
				result += '</mark>';
				inHighlight = false;
			}
			inTag = true;
			result += char;
			i++;
		} else if (char === '>') {
			// Exiting a tag
			inTag = false;
			result += char;
			i++;
		} else if (inTag) {
			// Inside a tag, just copy
			result += char;
			i++;
		} else if (char === '&') {
			// Possible HTML entity
			let entityEnd = i + 1;
			while (entityEnd < html.length && html[entityEnd] !== ';' && (entityEnd - i) < 10) {
				entityEnd++;
			}

			if (entityEnd < html.length && html[entityEnd] === ';') {
				// Valid entity
				const entity = html.substring(i, entityEnd + 1);
				const decoded = decodeEntity(entity);

				// Check if this position should be highlighted
				const shouldHighlight = highlightSet.has(textPos);

				if (shouldHighlight && !inHighlight) {
					result += '<mark class="history-search-highlight">';
					inHighlight = true;
				} else if (!shouldHighlight && inHighlight) {
					result += '</mark>';
					inHighlight = false;
				}

				result += entity;
				textPos += decoded.length;
				i = entityEnd + 1;
			} else {
				// Not a valid entity, treat as regular character
				const shouldHighlight = highlightSet.has(textPos);

				if (shouldHighlight && !inHighlight) {
					result += '<mark class="history-search-highlight">';
					inHighlight = true;
				} else if (!shouldHighlight && inHighlight) {
					result += '</mark>';
					inHighlight = false;
				}

				result += char;
				textPos++;
				i++;
			}
		} else {
			// Regular text character
			const shouldHighlight = highlightSet.has(textPos);

			if (shouldHighlight && !inHighlight) {
				result += '<mark class="history-search-highlight">';
				inHighlight = true;
			} else if (!shouldHighlight && inHighlight) {
				result += '</mark>';
				inHighlight = false;
			}

			result += char;
			textPos++;
			i++;
		}
	}

	// Close any open highlight
	if (inHighlight) {
		result += '</mark>';
	}

	return result;
};

/**
 * Highlight matches in plain text by wrapping them with <mark> tags
 * Returns HTML-escaped text with mark tags
 */
const highlightMatchesInText = (text: string, search: string): string => {
	if (!search) {
		// Escape HTML entities in plain text
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	const matches = findMatches(text, search);
	if (matches.length === 0) {
		// Escape HTML entities in plain text
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	let result = '';
	let lastIndex = 0;

	for (const match of matches) {
		// Add text before match (escaped)
		const beforeText = text.substring(lastIndex, match.start);
		result += beforeText
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');

		// Add highlighted match (escaped)
		const matchText = text.substring(match.start, match.end);
		const escapedMatch = matchText
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
		result += `<mark class="history-search-highlight">${escapedMatch}</mark>`;

		lastIndex = match.end;
	}

	// Add remaining text (escaped)
	const remainingText = text.substring(lastIndex);
	result += remainingText
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

	return result;
};

/**
 * Get smart excerpt of code when search matches but entry is collapsed
 * Shows the matching portion plus context to fill MAX_COLLAPSED_LINES
 */
const getSmartExcerpt = (code: string, search: string): { excerpt: string; hiddenAbove: number; hiddenBelow: number } | null => {
	if (!search) {
		return null;
	}

	const lines = code.split('\n');
	if (lines.length <= MAX_COLLAPSED_LINES) {
		return null; // No need for smart excerpt
	}

	// Find first line with a match
	const searchLower = search.toLowerCase();
	let matchLineIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toLowerCase().includes(searchLower)) {
			matchLineIndex = i;
			break;
		}
	}

	if (matchLineIndex === -1) {
		return null; // No match found
	}

	// Calculate how many lines to show
	const totalLines = lines.length;
	const linesToShow = MAX_COLLAPSED_LINES;

	// Try to center the match, but prioritize showing context after
	let startLine = Math.max(0, matchLineIndex - 1);
	let endLine = Math.min(totalLines, startLine + linesToShow);

	// Adjust if we're at the end
	if (endLine - startLine < linesToShow) {
		startLine = Math.max(0, endLine - linesToShow);
	}

	const excerpt = lines.slice(startLine, endLine).join('\n');
	const hiddenAbove = startLine;
	const hiddenBelow = totalLines - endLine;

	return { excerpt, hiddenAbove, hiddenBelow };
};

/**
 * HistoryEntry component - renders a single history entry with syntax highlighting
 */
export const HistoryEntry = (props: HistoryEntryProps) => {
	const {
		entry,
		style,
		isSelected,
		hasFocus,
		languageId,
		searchText,
		onSelect,
		onHeightChange,
		onToConsole,
		onToSource,
		onCopy,
		instantiationService
	} = props;

	const services = usePositronReactServicesContext();
	const [lineCount, setLineCount] = useState<number>(0);
	const [colorizedHtml, setColorizedHtml] = useState<string | null>(null);
	const [smartExcerpt, setSmartExcerpt] = useState<{ excerpt: string; hiddenAbove: number; hiddenBelow: number } | null>(null);
	const entryRef = useRef<HTMLDivElement>(null);
	const codeRef = useRef<HTMLDivElement>(null);

	/**
	 * Count lines in the code
	 */
	const countLines = (code: string): number => {
		return code.split('\n').length;
	};

	/**
	 * Truncate code to first N lines
	 */
	const truncateCode = (code: string, maxLines: number): string => {
		const lines = code.split('\n');
		if (lines.length <= maxLines) {
			return code;
		}
		return lines.slice(0, maxLines).join('\n');
	};

	/**
	 * Tokenize and highlight the code
	 */
	useEffect(() => {
		// Determine what code to show
		let codeToHighlight: string;
		let excerpt: { excerpt: string; hiddenAbove: number; hiddenBelow: number } | null = null;

		// Count total lines
		setLineCount(countLines(entry.input));

		if (isSelected) {
			// Show full code when selected
			codeToHighlight = entry.input;
		} else if (searchText) {
			// When searching and collapsed, show smart excerpt if needed
			excerpt = getSmartExcerpt(entry.input, searchText);
			codeToHighlight = excerpt ? excerpt.excerpt : truncateCode(entry.input, MAX_COLLAPSED_LINES);
		} else {
			// Normal truncation when collapsed
			codeToHighlight = truncateCode(entry.input, MAX_COLLAPSED_LINES);
		}

		setSmartExcerpt(excerpt);

		// If no languageId, show plain text with highlighting
		if (!languageId) {
			if (searchText) {
				const highlighted = highlightMatchesInText(codeToHighlight, searchText);
				const trustedHtml = (ttPolicy?.createHTML(highlighted) ?? highlighted) as string;
				setColorizedHtml(trustedHtml);
			} else {
				setColorizedHtml(null);
			}
			return;
		}

		const languageService = instantiationService.invokeFunction(accessor =>
			accessor.get(ILanguageService)
		);

		tokenizeToString(languageService, codeToHighlight, languageId).then(html => {
			// Apply search highlighting if present
			let finalHtml = html;
			if (searchText) {
				finalHtml = highlightMatchesInHtml(html, codeToHighlight, searchText);
			}

			// Use TrustedTypes policy if available, otherwise use the html string directly
			const trustedHtml = (ttPolicy?.createHTML(finalHtml) ?? finalHtml) as string;
			setColorizedHtml(trustedHtml);
		}).catch(err => {
			// Fallback to plain text on error
			if (searchText) {
				const highlighted = highlightMatchesInText(codeToHighlight, searchText);
				const trustedHtml = (ttPolicy?.createHTML(highlighted) ?? highlighted) as string;
				setColorizedHtml(trustedHtml);
			} else {
				setColorizedHtml(null);
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entry.input, languageId, isSelected, searchText, instantiationService]);

	/**
	 * Measure height after render
	 */
	useEffect(() => {
		if (entryRef.current) {
			const height = entryRef.current.offsetHeight;
			onHeightChange(height);
		}
	}, [isSelected, colorizedHtml, onHeightChange]);

	/**
	 * Apply font info after render
	 */
	useEffect(() => {
		if (codeRef.current) {
			applyFontInfo(codeRef.current, props.fontInfo);
		}
	});

	/**
	 * Handle context menu
	 */
	const handleContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		const x = event.clientX;
		const y = event.clientY;

		const actions: IAction[] = [];

		// Add "Send to Console" action
		actions.push({
			id: 'positronHistory.sendToConsole',
			label: 'Send to Console',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => onToConsole()
		});

		// Add "Send to Editor" action
		actions.push({
			id: 'positronHistory.sendToEditor',
			label: 'Send to Editor',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => onToSource()
		});

		// Add separator
		actions.push(new Separator());

		// Add "Copy" action
		actions.push({
			id: 'positronHistory.copy',
			label: 'Copy',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => onCopy()
		});

		// Show the context menu
		services.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	const showExpandButton = lineCount > MAX_COLLAPSED_LINES;
	const needsTruncation = showExpandButton && !isSelected && !smartExcerpt;
	const codeToDisplay = isSelected ? entry.input : truncateCode(entry.input, MAX_COLLAPSED_LINES);

	// Override the height from react-window's style to allow natural content sizing
	const styleWithoutHeight = { ...style, height: 'auto' };

	return (
		<div
			ref={entryRef}
			style={styleWithoutHeight}
			className={`history-entry ${isSelected ? (hasFocus ? 'selected' : 'selected-unfocused') : ''}`}
			onMouseDown={(e) => {
				// Use onMouseDown instead of onClick to ensure selection happens before focus events
				// This prevents the two-click issue when the panel is unfocused
				if (e.button === 0) { // Only handle left clicks
					onSelect();
				}
			}}
			onContextMenu={handleContextMenu}
		>
			<div className="history-entry-content">
				{/* Show "... N more lines" above if smart excerpt hides lines above */}
				{smartExcerpt && smartExcerpt.hiddenAbove > 0 && (
					<div className="history-entry-line-indicator">
						... {smartExcerpt.hiddenAbove} more lines
					</div>
				)}

				{colorizedHtml ? (
					<div
						ref={codeRef}
						className={`history-entry-code ${needsTruncation ? 'truncated' : ''}`}
						dangerouslySetInnerHTML={{ __html: colorizedHtml }}
					/>
				) : (
					<div
						ref={codeRef}
						className={`history-entry-code ${needsTruncation ? 'truncated' : ''}`}
					>
						{codeToDisplay}
					</div>
				)}

				{/* Show "... N more lines" below for normal truncation */}
				{needsTruncation && (
					<div className="history-entry-line-indicator">
						... {lineCount - MAX_COLLAPSED_LINES} more lines
					</div>
				)}

				{/* Show "... N more lines" below if smart excerpt hides lines below */}
				{smartExcerpt && smartExcerpt.hiddenBelow > 0 && (
					<div className="history-entry-line-indicator">
						... {smartExcerpt.hiddenBelow} more lines
					</div>
				)}
			</div>
		</div>
	);
};

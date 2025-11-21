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

const ttPolicy = createTrustedTypesPolicy('tokenizeToString', { createHTML: value => value });

/**
 * Props for the HistoryEntry component
 */
interface HistoryEntryProps {
	entry: IInputHistoryEntry;
	index: number;
	style: CSSProperties;
	isSelected: boolean;
	isExpanded: boolean;
	languageId: string;
	onSelect: () => void;
	onToggleExpand: () => void;
	onHeightChange: (height: number) => void;
	instantiationService: IInstantiationService;
	fontInfo: FontInfo;
}

/**
 * Maximum number of lines to show when collapsed
 */
const MAX_COLLAPSED_LINES = 3;

/**
 * HistoryEntry component - renders a single history entry with syntax highlighting
 */
export const HistoryEntry = (props: HistoryEntryProps) => {
	const {
		entry,
		style,
		isSelected,
		isExpanded,
		languageId,
		onSelect,
		onToggleExpand,
		onHeightChange,
		instantiationService
	} = props;

	const [lineCount, setLineCount] = useState<number>(0);
	const [colorizedHtml, setColorizedHtml] = useState<TrustedHTML | null>(null);
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
		const codeToHighlight = isExpanded ? entry.input : truncateCode(entry.input, MAX_COLLAPSED_LINES);

		// Count total lines
		setLineCount(countLines(entry.input));

		// If no languageId, show plain text
		if (!languageId) {
			setColorizedHtml(null);
			return;
		}

		const languageService = instantiationService.invokeFunction(accessor =>
			accessor.get(ILanguageService)
		);

		tokenizeToString(languageService, codeToHighlight, languageId).then(html => {
			if (ttPolicy) {
				setColorizedHtml(ttPolicy.createHTML(html));
			}
		}).catch(err => {
			// Fallback to plain text on error
			setColorizedHtml(null);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entry.input, languageId, isExpanded, instantiationService]);

	/**
	 * Measure height after render
	 */
	useEffect(() => {
		if (entryRef.current) {
			const height = entryRef.current.offsetHeight;
			onHeightChange(height);
		}
	});

	/**
	 * Apply font info after render
	 */
	useEffect(() => {
		if (codeRef.current) {
			applyFontInfo(codeRef.current, props.fontInfo);
		}
	});

	const showExpandButton = lineCount > MAX_COLLAPSED_LINES;
	const needsTruncation = showExpandButton && !isExpanded;
	const codeToDisplay = isExpanded ? entry.input : truncateCode(entry.input, MAX_COLLAPSED_LINES);

	return (
		<div
			ref={entryRef}
			style={style}
			className={`history-entry ${isSelected ? 'selected' : ''}`}
			onClick={onSelect}
		>
			<div className="history-entry-content">
				{colorizedHtml ? (
					<div
						ref={codeRef}
						className="history-entry-code"
						dangerouslySetInnerHTML={{ __html: colorizedHtml }}
					/>
				) : (
					<div
						ref={codeRef}
						className="history-entry-code"
					>
						{codeToDisplay}
					</div>
				)}
				{needsTruncation && (
					<div className="history-entry-truncated-indicator">...</div>
				)}
			</div>
			{showExpandButton && (
				<button
					className="history-entry-expand-button"
					onClick={(e) => {
						e.stopPropagation();
						onToggleExpand();
					}}
				>
					{isExpanded ? 'Show less' : `Show ${lineCount - MAX_COLLAPSED_LINES} more lines`}
				</button>
			)}
		</div>
	);
};

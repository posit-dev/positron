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
	hasFocus: boolean;
	languageId: string;
	onSelect: () => void;
	onToggleExpand: () => void;
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
		hasFocus,
		languageId,
		onSelect,
		onToggleExpand,
		onHeightChange,
		onToConsole,
		onToSource,
		onCopy,
		instantiationService
	} = props;

	const services = usePositronReactServicesContext();
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
	const needsTruncation = showExpandButton && !isExpanded;
	const codeToDisplay = isExpanded ? entry.input : truncateCode(entry.input, MAX_COLLAPSED_LINES);

	// Override the height from react-window's style to allow natural content sizing
	const styleWithoutHeight = { ...style, height: 'auto' };

	return (
		<div
			ref={entryRef}
			style={styleWithoutHeight}
			className={`history-entry ${isSelected ? (hasFocus ? 'selected' : 'selected-unfocused') : ''}`}
			onClick={onSelect}
			onContextMenu={handleContextMenu}
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

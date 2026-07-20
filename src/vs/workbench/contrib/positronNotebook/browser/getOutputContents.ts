/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { hasKey } from '../../../../base/common/types.js';
import { IOutputItemDto } from '../../notebook/common/notebookCommon.js';
import { ParsedDataExplorerOutput, ParsedOutput, ParsedTextOutput } from './PositronNotebookCells/IPositronNotebookCell.js';
import { parseVariablePath } from '../../../services/positronDataExplorer/common/utils.js';

/**
 * MIME type for Positron inline data explorer
 */
export const DATA_EXPLORER_MIME_TYPE = 'application/vnd.positron.dataExplorer+json';

/**
 * Case-insensitive check for the data explorer MIME type. Needed because
 * MIME types are case-insensitive per RFC 2045, and VS Code's
 * normalizeMimeType lowercases the type/subtype when loading notebooks from
 * disk, while live kernel execution preserves the original casing.
 */
export function isDataExplorerMimeType(mime: string): boolean {
	return mime.toLowerCase() === DATA_EXPLORER_MIME_TYPE.toLowerCase();
}

const textOutputTypes: ParsedTextOutput['type'][] = ['stdout', 'text', 'stderr', 'error'];

export function isParsedTextOutput(output: ParsedOutput): output is ParsedTextOutput {
	return (textOutputTypes as string[]).includes(output.type);
}

export function getPlainTextOutputContent(outputs: ReadonlyArray<{ parsed: ParsedOutput }>): string {
	return outputs
		.filter(o => isParsedTextOutput(o.parsed))
		.map(o => removeAnsiEscapeCodes((o.parsed as ParsedTextOutput).content))
		.join('\n');
}

/**
 * The text content of a parsed output, ANSI escape codes stripped, or
 * `undefined` for outputs with no text content (images, JSON, data explorer,
 * interrupts). Broader than {@link isParsedTextOutput}: html, markdown, latex,
 * and unknown outputs count as text here.
 */
export function getParsedOutputContent(parsed: ParsedOutput): string | undefined {
	return hasKey(parsed, { content: true }) ? removeAnsiEscapeCodes(parsed.content) : undefined;
}

/**
 * Parse cell output into standard serializable js objects.
 * @param outputItem Contents of a cells output
 * @returns The output parsed to the known types.
 */
export function parseOutputData(outputItem: IOutputItemDto, metadata?: Record<string, unknown>): ParsedOutput {
	const { data, mime } = outputItem;
	const message = data.toString();

	if (mime === 'application/json') {
		try {
			const parsed = JSON.parse(message);
			return { type: 'json', data: parsed };
		} catch {
			// Invalid JSON -- fall through to render as plain text
			return { type: 'text', content: message };
		}
	}

	try {
		const parsedMessage = JSON.parse(message);

		if (parsedMessage?.name === 'KeyboardInterrupt') {
			return { type: 'interrupt', trace: parsedMessage.traceback };
		}

		if (parsedMessage?.name === 'Runtime Error') {
			return { type: 'error', content: parsedMessage.message };
		}

		if (mime === 'application/vnd.code.notebook.error') {
			return { type: 'error', content: parsedMessage.stack };
		}

	} catch (e) {
	}

	if (mime === 'application/vnd.code.notebook.stdout') {
		return { type: 'stdout', content: message };
	}

	if (mime === 'application/vnd.code.notebook.stderr') {
		return { type: 'stderr', content: message };
	}

	if (mime === 'text/plain') {
		return { type: 'text', content: message };
	}

	// Handle Positron inline data explorer MIME type
	if (isDataExplorerMimeType(mime)) {
		try {
			const payload = JSON.parse(message);
			const variablePath = parseVariablePath(payload.variable_path);
			return {
				type: 'dataExplorer',
				commId: payload.comm_id,
				shape: payload.shape,
				title: payload.title,
				version: payload.version,
				source: payload.source,
				variablePath,
			} satisfies ParsedDataExplorerOutput;
		} catch {
			// Fall through to unknown if parsing fails
		}
	}

	if (mime === 'text/html') {
		return { type: 'html', content: message };
	}

	if (mime === 'text/markdown') {
		return { type: 'markdown', content: message };
	}

	if (mime === 'text/latex') {
		return { type: 'latex', content: message };
	}

	if (mime === 'image/png') {
		const nested = metadata?.['metadata'];
		const nestedObj = typeof nested === 'object' && nested !== null ? nested as Record<string, unknown> : undefined;
		const imgMeta = nestedObj?.[mime] ?? metadata?.[mime] ?? metadata;
		const imgObj = typeof imgMeta === 'object' && imgMeta !== null ? imgMeta as Record<string, unknown> : undefined;
		const width = typeof imgObj?.['width'] === 'number' ? imgObj['width'] : undefined;
		const height = typeof imgObj?.['height'] === 'number' ? imgObj['height'] : undefined;
		return {
			type: 'image',
			dataUrl: `data:image/png;base64,${encodeBase64(VSBuffer.wrap(data.buffer))}`,
			width,
			height,
		};
	}

	if (mime === 'image/svg+xml') {
		return {
			type: 'image',
			dataUrl: `data:image/svg+xml,${encodeURIComponent(message)}`
		};
	}

	return {
		type: 'unknown',
		content: localize('cellExecutionUnknownMimeType', 'Can\'t handle mime type "{0}" yet', mime)
	};
}

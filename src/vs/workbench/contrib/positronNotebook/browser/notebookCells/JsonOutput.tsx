/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useCallback, useState } from 'react';

// CSS.
import './JsonOutput.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

interface JsonOutputProps {
	data: unknown;
}

const copyJsonLabel = localize('positron.notebook.copyJson', "Copy JSON");

export const JsonOutput = React.memo(function JsonOutput({ data }: JsonOutputProps) {
	const services = usePositronReactServicesContext();
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(() => {
		const text = JSON.stringify(data, null, 2) ?? String(data);
		services.clipboardService.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [data, services.clipboardService]);

	return (
		<div className='json-output'>
			<div className='json-output-header'>
				<button
					aria-label={copyJsonLabel}
					className='json-copy-button'
					title={copyJsonLabel}
					onClick={handleCopy}
				>
					<span className={`codicon ${copied ? 'codicon-check' : 'codicon-copy'}`} />
				</button>
			</div>
			<div className='json-tree'>
				<JsonNode value={data} />
			</div>
		</div>
	);
});

interface JsonNodeProps {
	value: unknown;
	keyName?: string;
}

function JsonNode({ value, keyName }: JsonNodeProps) {
	if (value === null) {
		return <JsonLeaf display='null' keyName={keyName} valueClass='json-null' />;
	}

	if (Array.isArray(value)) {
		return <JsonCollapsible keyName={keyName} type='array' value={value} />;
	}

	switch (typeof value) {
		case 'object':
			return <JsonCollapsible keyName={keyName} type='object' value={value as Record<string, unknown>} />;
		case 'string':
			return <JsonLeaf display={JSON.stringify(value)} keyName={keyName} valueClass='json-string' />;
		case 'number':
			return <JsonLeaf display={String(value)} keyName={keyName} valueClass='json-number' />;
		case 'boolean':
			return <JsonLeaf display={String(value)} keyName={keyName} valueClass='json-boolean' />;
		default:
			return <JsonLeaf display={String(value)} keyName={keyName} valueClass='json-null' />;
	}
}

const STRING_TRUNCATE_LENGTH = 120;

interface JsonLeafProps {
	keyName?: string;
	valueClass: string;
	display: string;
}

function JsonLeaf({ keyName, valueClass, display }: JsonLeafProps) {
	const [expanded, setExpanded] = useState(false);
	const contentLength = display.length - 2; // exclude wrapper quotes
	const isTruncatable = valueClass === 'json-string' && contentLength > STRING_TRUNCATE_LENGTH;
	const shown = isTruncatable && !expanded
		? display.slice(0, STRING_TRUNCATE_LENGTH + 1) + '..."'
		: display;

	return (
		<div className='json-leaf'>
			{isTruncatable && (
				<button
					aria-expanded={expanded}
					aria-label={expanded ? 'Collapse string' : `Expand string (${contentLength} chars)`}
					className='json-inline-toggle'
					type='button'
					onClick={() => setExpanded(prev => !prev)}
				>
					<span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
				</button>
			)}
			{keyName !== undefined && <span className='json-key'>{keyName}: </span>}
			<span className={valueClass}>{shown}</span>
			{isTruncatable && !expanded && (
				<span className='json-secondary'>{contentLength} chars</span>
			)}
		</div>
	);
}

interface JsonCollapsibleProps {
	keyName?: string;
	value: unknown[] | Record<string, unknown>;
	type: 'array' | 'object';
}

function JsonCollapsible({ keyName, value, type }: JsonCollapsibleProps) {
	const [expanded, setExpanded] = useState(true);
	const entries = type === 'array'
		? (value as unknown[]).map((v, i) => [String(i), v] as const)
		: Object.entries(value as Record<string, unknown>);
	const count = entries.length;
	const brackets = type === 'array' ? ['[', ']'] : ['{', '}'];

	if (count === 0) {
		return (
			<div className='json-leaf'>
				{keyName !== undefined && <span className='json-key'>{keyName}: </span>}
				<span className='json-punct'>{brackets[0]}{brackets[1]}</span>
			</div>
		);
	}

	const toggle = () => setExpanded(prev => !prev);

	return (
		<div className='json-collapsible'>
			<button
				aria-expanded={expanded}
				aria-label={keyName ? `${keyName}: ${count} ${count === 1 ? 'item' : 'items'}` : `${count} ${count === 1 ? 'item' : 'items'}`}
				className='json-collapsible-header'
				type='button'
				onClick={toggle}
			>
				<span className={`codicon json-chevron ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
				{keyName !== undefined && <span className='json-key'>{keyName}: </span>}
				{!expanded && (
					<>
						<span className='json-punct'>{brackets[0]}...{brackets[1]}</span>
						<span className='json-secondary'>{count} {count === 1 ? 'item' : 'items'}</span>
					</>
				)}
				{expanded && <span className='json-punct'>{brackets[0]}</span>}
			</button>
			{expanded && (
				<>
					<div className='json-children'>
						{entries.map(([k, v]) => (
							<JsonNode key={k} keyName={type === 'object' ? k : undefined} value={v} />
						))}
					</div>
					<div className='json-bracket-close'>
						<span className='json-punct'>{brackets[1]}</span>
					</div>
				</>
			)}
		</div>
	);
}

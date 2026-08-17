/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Test file to verify the code-no-eager-usestate ESLint rule.

import React, { useState } from 'react';

declare function computeValue(): number;
declare const generateId: () => string;

// -----
// Valid
// -----

export function ValidLazyInitializer() {
	const [value] = useState(() => computeValue());
	return <div>{value}</div>;
}

export function ValidLazyFunctionReference() {
	const [value] = useState(computeValue);
	return <div>{value}</div>;
}

export function ValidLiteralInitializer() {
	const [value] = useState(0);
	const [flag] = useState(false);
	return <div>{value}{flag}</div>;
}

export function ValidIdentifierInitializer(props: { initial: number }) {
	const [value] = useState(props.initial);
	return <div>{value}</div>;
}

export function ValidCallInsideNestedFunction() {
	// The call runs when the handler runs, not during render.
	const [handlers] = useState({ onClick: () => computeValue() });
	return <div>{String(!!handlers)}</div>;
}

// -------
// Invalid
// -------

export function InvalidEagerCall() {
	// eslint-disable-next-line local/code-no-eager-usestate
	const [value] = useState(computeValue());
	return <div>{value}</div>;
}

export function InvalidEagerArrowCall() {
	// eslint-disable-next-line local/code-no-eager-usestate
	const [id] = useState(generateId());
	return <div>{id}</div>;
}

export function InvalidEagerNewExpression() {
	// eslint-disable-next-line local/code-no-eager-usestate
	const [map] = useState(new Map<string, number>());
	return <div>{map.size}</div>;
}

export function InvalidEagerCallOnNamespace() {
	// eslint-disable-next-line local/code-no-eager-usestate
	const [value] = React.useState(computeValue());
	return <div>{value}</div>;
}

export function InvalidEagerCallInsideTernary(props: { flag: boolean }) {
	// eslint-disable-next-line local/code-no-eager-usestate
	const [value] = useState(props.flag ? computeValue() : 0);
	return <div>{value}</div>;
}

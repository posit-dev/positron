/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Test file to verify the code-no-hardcoded-codicon-classes ESLint rule.

import { positronClassNames } from '../../src/vs/base/common/positronUtilities.js';

// -----
// Valid
// -----

// No codicon classes (no warning)
const valid1 = <div className='notebook-error-boundary-icon' />;
const valid2 = <div className='some-other-class' />;
const valid3 = <div className={'dynamic-class'} />;
const valid4 = <div className={`template-class`} />;
const valid5 = <span className='action-icon' />;
const valid6 = <div className={positronClassNames('my-icon', 'highlighted')} />;

// Hyphenated class names containing "codicon" as a substring should not trigger
const valid7 = <div className='btn-codicon-wrapper' />;
const valid8 = <div className={positronClassNames('my-codicon-helper')} />;

// -------
// Invalid
// -------

// String literal className with codicon classes
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid1 = <span className='codicon codicon-error' />;

// String literal with extra classes
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid2 = <div className='notebook-icon codicon codicon-check' />;

// Expression container with string literal
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid3 = <div className={'codicon codicon-error'} />;

// Expression container with template literal
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid4 = <div className={`icon codicon codicon-chevron-down`} />;

// Template literal with interpolation (still has the static codicon pattern)
const iconName = 'error';
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid5 = <div className={`codicon codicon-${iconName}`} />;

// Call expression with codicon string arguments (combined in one arg)
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid6 = <div className={positronClassNames('codicon codicon-error', 'highlighted')} />;

// Call expression with split codicon arguments
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid7 = <div className={positronClassNames('codicon', 'codicon-error')} />;

// Call expression with template literal argument
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid8 = <div className={positronClassNames(`codicon codicon-error`)} />;

// Call expression with split args and interpolated template literal
// eslint-disable-next-line local/code-no-hardcoded-codicon-classes
const invalid9 = <div className={positronClassNames('codicon', `codicon-${iconName}`)} />;

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRoot } from 'react-dom/client';
import { App } from './App';
// esbuild collects this into a sibling dist/providerDemo.css, which the host
// HTML links. See css.d.ts for why the import typechecks.
import './providerDemo.css';

const container = document.getElementById('root');
if (!container) {
	throw new Error('scratch provider demo: no #root element');
}

createRoot(container).render(<App />);

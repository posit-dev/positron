/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	buildAppendText,
	hasImportsVerbatim,
} from '../../../../browser/contrib/visualize/applyVisualizeResult.js';

describe('applyVisualizeResult helpers', () => {
	describe('hasImportsVerbatim', () => {
		it('returns true when every import line appears as its own line in the cell', () => {
			const existing = `import numpy as np\nimport pandas as pd\n\ndf = pd.read_csv("x.csv")\n`;
			expect(hasImportsVerbatim(existing, 'import pandas as pd')).toBe(true);
		});

		it('returns true for a multi-line import block where every line matches', () => {
			const existing = `import numpy as np\nimport pandas as pd\nimport plotly.express as px\n`;
			expect(hasImportsVerbatim(existing, 'import pandas as pd\nimport plotly.express as px')).toBe(true);
		});

		it('returns false when the import line is only a prefix of an existing line', () => {
			const existing = `import pandas as pd\n`;
			expect(hasImportsVerbatim(existing, 'import pandas')).toBe(false);
		});

		it('returns false when the import block is absent', () => {
			const existing = `import pandas as pd\n`;
			expect(hasImportsVerbatim(existing, 'from pandas import DataFrame')).toBe(false);
		});
	});

	describe('buildAppendText', () => {
		const snippet = { imports: 'import plotly.express as px', body: 'fig = px.bar(df, x="a")\nfig.show()' };

		it('prepends imports when not already present', () => {
			const existing = `df = pd.DataFrame()\ndf`;
			const appended = buildAppendText(existing, snippet);
			expect(appended.startsWith('\n\nimport plotly.express as px')).toBe(true);
			expect(appended).toContain('fig = px.bar(df, x="a")');
		});

		it('omits imports when already present verbatim', () => {
			const existing = `import plotly.express as px\n\ndf`;
			const appended = buildAppendText(existing, snippet);
			expect(appended.includes('import plotly.express as px')).toBe(false);
			expect(appended.startsWith('\n\nfig =')).toBe(true);
		});
	});
});

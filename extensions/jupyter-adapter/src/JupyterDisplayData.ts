/*
 * JupyterDisplayData.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from './JupyterMessageSpec';

export interface JupyterDisplayDataTypes {
    'text/html': string;
    'text/markdown': string;
    'text/latex': string;
    'text/plain': string;
}

export interface JupyterDisplayData extends JupyterMessageSpec {
    data: JupyterDisplayDataTypes;
}

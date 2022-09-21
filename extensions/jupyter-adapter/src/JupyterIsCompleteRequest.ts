/*
 * JupyterIsCompleteRequest.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a is_complete_request from the Jupyter frontend to the kernel.
 * This requests tests a code fragment to see if it's complete.
 * 
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#code-completeness
 */
export interface JupyterIsCompleteRequest extends JupyterMessageSpec {
    /** The code to test for completeness */
    code: string;
}


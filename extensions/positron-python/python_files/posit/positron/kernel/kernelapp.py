#
# Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import traitlets
from ipykernel.kernelapp import IPKernelApp

from ..utils import with_logging
from .ipkernel import PositronIPyKernel
from .session_mode import SessionMode

if TYPE_CHECKING:
    from ipykernel.control import ControlThread


class PositronIPKernelApp(IPKernelApp):
    control_thread: ControlThread | None
    kernel: PositronIPyKernel

    # Use the PositronIPyKernel class.
    kernel_class: type[PositronIPyKernel] = traitlets.Type(PositronIPyKernel)  # type: ignore

    # Positron-specific attributes:
    session_mode: SessionMode = SessionMode.trait()  # type: ignore

    def init_control(self, context):
        result = super().init_control(context)
        # Should be defined in init_control().
        assert self.control_thread is not None
        # Add a bunch of debug logging to control thread methods.
        # See: https://github.com/posit-dev/positron/issues/7142.
        self.control_thread.io_loop.start = with_logging(self.control_thread.io_loop.start)
        self.control_thread.io_loop.stop = with_logging(self.control_thread.io_loop.stop)
        self.control_thread.io_loop.close = with_logging(self.control_thread.io_loop.close)
        self.control_thread.run = with_logging(self.control_thread.run)
        self.control_thread.stop = with_logging(self.control_thread.stop)
        self.control_thread.join = with_logging(self.control_thread.join)
        return result

    def init_gui_pylab(self):
        # Enable the Positron matplotlib backend if we're not in a notebook.
        # If we're in a notebook, use IPython's default backend via the super() call below.
        # Matplotlib uses the MPLBACKEND environment variable to determine the backend to use.
        # It imports the backend module when it's first needed.
        if self.session_mode != SessionMode.NOTEBOOK and not os.environ.get("MPLBACKEND"):
            os.environ["MPLBACKEND"] = "module://positron.matplotlib_backend"

        return super().init_gui_pylab()

    def close(self):
        # Stop the control thread if it's still alive. This is also attempted in super().close(),
        # but that doesn't timeout on join() so can hang forever if the control thread is stuck.
        # See https://github.com/posit-dev/positron/issues/7142.
        if self.control_thread and self.control_thread.is_alive():
            self.log.debug("Closing control thread")
            self.control_thread.stop()
            self.control_thread.join(timeout=5)
            # If the thread is still alive after 5 seconds, log a warning and drop the reference.
            # This leaves the thread dangling, but since it's a daemon thread it won't stop the
            # process from exiting.
            if self.control_thread.is_alive() and self.control_thread.daemon:
                self.log.warning("Control thread did not exit after 5 seconds, dropping it")
                self.control_thread = None

        super().close()

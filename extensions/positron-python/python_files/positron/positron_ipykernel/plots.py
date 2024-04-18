#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
#

from __future__ import annotations

import base64
import logging
import uuid
from typing import Callable, List, Optional, Protocol

from .plot_comm import PlotBackendMessageContent, PlotFrontendEvent, PlotResult, RenderRequest
from .positron_comm import CommMessage, PositronComm
from .session_mode import SessionMode
from .utils import JsonRecord

logger = logging.getLogger(__name__)


MIME_TYPE = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
    "jpeg": "image/jpeg",
}


class Plot:
    """
    The backend representation of a frontend plot instance.

    Paramaters
    ----------
    comm
        The communication channel to the frontend plot instance.
    render
        A callable that renders the plot. See `plot_comm.RenderRequest` for parameter details.
    close_callback
        A callback that is called after the plot comm is closed.
    """

    def __init__(
        self,
        comm: PositronComm,
        render: Renderer,
        close_callback: Optional[Callable[[], None]] = None,
    ) -> None:
        self._comm = comm
        self._render = render
        self._close_callback = close_callback

        self._closed = False

        self._comm.on_msg(self._handle_msg, PlotBackendMessageContent)

    @property
    def closed(self) -> bool:
        """
        Whether the plot is closed.
        """
        return self._closed

    def close(self) -> None:
        """
        Close the plot.
        """
        if self._closed:
            return

        self._closed = True
        self._comm.close()
        if self._close_callback:
            self._close_callback()

    def show(self) -> None:
        """
        Show the plot.
        """
        self._comm.send_event(PlotFrontendEvent.Show, {})

    def update(self) -> None:
        """
        Notify the frontend that the plot needs to be rerendered.
        """
        self._comm.send_event(PlotFrontendEvent.Update, {})

    def _handle_msg(self, msg: CommMessage[PlotBackendMessageContent], raw_msg: JsonRecord) -> None:
        request = msg.content.data
        if isinstance(request, RenderRequest):
            self._handle_render(
                request.params.width,
                request.params.height,
                request.params.pixel_ratio,
                request.params.format,
            )
        else:
            logger.warning(f"Unhandled request: {request}")

    def _handle_render(
        self,
        width_px: int,
        height_px: int,
        pixel_ratio: float,
        format: str,
    ) -> None:
        rendered = self._render(width_px, height_px, pixel_ratio, format)
        data = base64.b64encode(rendered).decode()
        result = PlotResult(data=data, mime_type=MIME_TYPE[format]).dict()
        self._comm.send_result(data=result)


class Renderer(Protocol):
    """
    A callable that renders a plot. See `plot_comm.RenderRequest` for parameter details.
    """

    def __call__(self, width_px: int, height_px: int, pixel_ratio: float, format: str) -> bytes: ...


class PlotsService:
    """
    The plots service is responsible for managing `Plot` instances.

    Paramaters
    ----------
    target_name
        The name of the target for plot comms, as defined in the frontend.
    session_mode
        The session mode that the kernel was started in.
    """

    def __init__(self, target_name: str, session_mode: SessionMode):
        self._target_name = target_name
        self._session_mode = session_mode

        self._plots: List[Plot] = []

    def create_plot(self, render: Renderer, close_callback: Callable[[], None]) -> Plot:
        """
        Create a plot.

        See Also:
        ---------
        Plot
        """
        comm_id = str(uuid.uuid4())
        logger.info(f"Creating plot with comm {comm_id}")
        plot_comm = PositronComm.create(self._target_name, comm_id)
        plot = Plot(plot_comm, render, close_callback)
        self._plots.append(plot)
        return plot

    def close_plot(self, plot: Plot) -> None:
        """
        Close a plot.

        Parameters
        ----------
        plot
            The plot to close.
        """
        if plot.closed:
            return
        plot.close()
        self._plots.remove(plot)

    def shutdown(self) -> None:
        """
        Shutdown the plots service.
        """
        for plot in list(self._plots):
            self.close_plot(plot)

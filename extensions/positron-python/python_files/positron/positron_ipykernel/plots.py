#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import base64
import logging
import uuid
from typing import List, Optional, Protocol, Tuple

from .plot_comm import (
    GetIntrinsicSizeRequest,
    IntrinsicSize,
    PlotBackendMessageContent,
    PlotFrontendEvent,
    PlotResult,
    PlotSize,
    PlotUnit,
    RenderRequest,
)
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
    intrinsic_size
        The intrinsic size of the plot in inches, if known.
    """

    def __init__(
        self,
        comm: PositronComm,
        render: Renderer,
        intrinsic_size: Optional[Tuple[int, int]] = None,
    ) -> None:
        self._comm = comm
        self._render = render
        self._intrinsic_size = intrinsic_size

        self._closed = False

        self._comm.on_msg(self._handle_msg, PlotBackendMessageContent)
        self._comm.on_close(self._handle_close)

    @property
    def closed(self) -> bool:
        """
        Whether the plot is closed.
        """
        return self._closed

    def _open(self) -> None:
        """
        Re-open the plot after it's been closed.
        """
        if not self._closed:
            return

        self._comm.open()
        self._closed = False

    def close(self) -> None:
        """
        Close the plot.
        """
        if self._closed:
            return
        self._closed = True
        self._comm.close()

    def show(self) -> None:
        """
        Show the plot.
        """
        if self._closed:
            # No need to send a show event since opening the comm will trigger a render from the frontend.
            self._open()
        else:
            self._comm.send_event(PlotFrontendEvent.Show, {})

    def update(self) -> None:
        """
        Notify the frontend that the plot needs to be rerendered.
        """
        if self._closed:
            # No need to send an update event since opening the comm will trigger a render from the frontend.
            self._open()
        else:
            self._comm.send_event(PlotFrontendEvent.Update, {})

    def _handle_msg(self, msg: CommMessage[PlotBackendMessageContent], raw_msg: JsonRecord) -> None:
        request = msg.content.data
        if isinstance(request, RenderRequest):
            self._handle_render(
                request.params.size,
                request.params.pixel_ratio,
                request.params.format,
            )
        if isinstance(request, GetIntrinsicSizeRequest):
            self._handle_get_intrinsic_size()
        else:
            logger.warning(f"Unhandled request: {request}")

    def _handle_render(
        self,
        size: Optional[PlotSize],
        pixel_ratio: float,
        format: str,
    ) -> None:
        rendered = self._render(size, pixel_ratio, format)
        data = base64.b64encode(rendered).decode()
        result = PlotResult(data=data, mime_type=MIME_TYPE[format]).dict()
        self._comm.send_result(data=result)

    def _handle_get_intrinsic_size(self) -> None:
        if self._intrinsic_size is None:
            result = None
        else:
            result = IntrinsicSize(
                width=self._intrinsic_size[0],
                height=self._intrinsic_size[1],
                unit=PlotUnit.Inches,
                source="Matplotlib",
            ).dict()
        self._comm.send_result(data=result)

    def _handle_close(self, msg: JsonRecord) -> None:
        self.close()


class Renderer(Protocol):
    """
    A callable that renders a plot. See `plot_comm.RenderRequest` for parameter details.
    """

    def __call__(self, size: Optional[PlotSize], pixel_ratio: float, format: str) -> bytes: ...


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

    def create_plot(self, render: Renderer, intrinsic_size: Optional[Tuple[int, int]]) -> Plot:
        """
        Create a plot.

        Parameters
        ----------
        render
            A callable that renders the plot. See `plot_comm.RenderRequest` for parameter details.
        intrinsic_size
            The intrinsic size of the plot in inches.

        See Also
        --------
        Plot
        """
        comm_id = str(uuid.uuid4())
        logger.info(f"Creating plot with comm {comm_id}")
        plot_comm = PositronComm.create(self._target_name, comm_id)
        plot = Plot(plot_comm, render, intrinsic_size)
        self._plots.append(plot)
        return plot

    def shutdown(self) -> None:
        """
        Shutdown the plots service.
        """
        for plot in list(self._plots):
            plot.close()
            self._plots.remove(plot)

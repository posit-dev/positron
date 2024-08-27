#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from __future__ import annotations

import base64
import logging
import uuid
from typing import Dict, List, Optional, Protocol, Tuple, Union, cast

from .plot_comm import (
    CreateNewPlotClientRequest,
    GetIntrinsicSizeRequest,
    IntrinsicSize,
    PlotBackendMessageContent,
    PlotClientView,
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
    plot_id
        The unique identifier of the backend plot.
    comm
        The communication channel to the frontend plot instance.
    render
        A callable that renders the plot. See `plot_comm.RenderRequest` for parameter details.
    intrinsic_size
        The intrinsic size of the plot in inches.
    """

    def __init__(
        self,
        plot_id: str,
        comm: PositronComm,
        render: Renderer,
        intrinsic_size: Tuple[int, int],
        client_view: PlotClientView,
    ) -> None:
        self.plot_id = plot_id
        self._comm = comm
        self._render = render
        self._intrinsic_size = intrinsic_size
        self._client_view = client_view

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

        self._comm.open({"clientView": self._client_view})
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
        if isinstance(request, CreateNewPlotClientRequest):
            self._handle_create_new_plot_client(request.params.client_view)
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

    def _handle_create_new_plot_client(self, client_view: str) -> None:
        from .positron_ipkernel import PositronIPyKernel
        plots_service = cast(PositronIPyKernel, PositronIPyKernel.instance()).plots_service
        plots_service.create_plot(self._render, self._intrinsic_size, self.plot_id, client_view)

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

        self._plots: Dict[str, List[Plot]] = {}

    def get_plot_clients(self, plot_id: str) -> List[Plot]:
        """
        Get all the plot clients for a plot.

        Parameters
        ----------
        plot_id
            The unique identifier of the plot.

        Returns
        -------
        List[Plot]
            The plot clients.
        """
        return self._plots.get(plot_id, [])

    def create_plot(self, render: Renderer, intrinsic_size: Tuple[int, int], plot_id: str, client_view: PlotClientView = PlotClientView.View) -> Plot:
        """
        Create a plot.

        Parameters
        ----------
        render
            A callable that renders the plot. See `plot_comm.RenderRequest` for parameter details.
        intrinsic_size
            The intrinsic size of the plot in inches.
        plot_id
            The plot id.
        client_view
            The type of plot to create. If not provided, the plot will be created as a view plot.

        See Also
        --------
        Plot
        """
        comm_id = str(uuid.uuid4())
        logger.info(f"Creating plot with comm {comm_id}")

        plot_comm = PositronComm.create(self._target_name, comm_id, {"clientView": client_view})
        plot = Plot(plot_id, plot_comm, render, intrinsic_size, client_view)
        plot_clients = self._plots.get(plot_id)

        if (plot_clients is None):
            plot_clients = []
            self._plots[plot_id] = plot_clients
        plot_clients.append(plot)
        return plot

    def shutdown(self) -> None:
        """
        Shutdown the plots service.
        """
        for plot_clients in self._plots.values():
            for plot_client in plot_clients:
                plot_client.close()
        self._plots.clear()

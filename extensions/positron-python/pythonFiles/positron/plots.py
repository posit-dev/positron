#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import codecs
import logging
import pickle
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple, cast

import comm
from IPython.core.formatters import DisplayFormatter
from IPython.core.interactiveshell import InteractiveShell

logger = logging.getLogger(__name__)


# Synchronize the models below with:
#     src/vs/workbench/services/languageRuntime/common/languageRuntimePlotClient.ts


@dataclass
class PlotClientMessageRender:
    """
    A message used to request that a plot render at a specific size.
    """

    width: Optional[int] = field(
        metadata={"description": "The width of the plot, in logical pixels"}, default=None
    )
    height: Optional[int] = field(
        metadata={"description": "The height of the plot, in logical pixels"}, default=None
    )
    pixel_ratio: Optional[float] = field(
        metadata={
            "description": """The pixel ratio of the display device; typically 1 for standard displays,
2 for retina/high DPI displays, etc."""
        },
        default=None,
    )
    msg_type: Literal["render"] = "render"


@dataclass
class LanguageRuntimeCommMessage:
    """
    A message used to send data to the language runtime plot client.
    """

    comm_id: str = field(
        metadata={
            "description": "The unique ID of the client comm ID for which the message is intended"
        }
    )
    # NOTE: When we add more data types, we'll need to use a `Union` and `Field(discriminator='msg_type')`
    data: Dict[str, Any] = field(metadata={"description": "The data from the back-end"})


@dataclass
class PlotClientMessageImage:
    """
    A message used to send rendered plot output.
    """

    data: str = field(
        metadata={
            "description": """The data for the plot image, as a base64-encoded string. We need
to send the plot data as a string because the underlying image file
exists only on the machine running the language runtime process."""
        }
    )
    mime_type: str = field(
        metadata={
            "description": """The MIME type of the image data, e.g. `image/png`. This is used to
determine how to display the image in the UI."""
        }
    )
    msg_type: str = "image"


@dataclass
class PlotClientMessageError:
    """
    A message used to send an error message.
    """

    message: str = field(metadata={"description": "The error message"})
    msg_type: str = "error"


# Matplotlib Default Figure Size
DEFAULT_WIDTH_IN = 6.4
DEFAULT_HEIGHT_IN = 4.8
BASE_DPI = 96


class PositronDisplayPublisherHook:
    def __init__(self, target_name: str):
        self.comms: Dict[str, comm.base_comm.BaseComm] = {}
        self.figures: Dict[str, str] = {}
        self.target_name = target_name
        self.fignums: List[int] = []

    def __call__(self, msg, *args, **kwargs) -> Optional[dict]:
        if msg["msg_type"] == "display_data":
            # If there is no image for our display, don't create a
            # positron.plot comm and let the parent deal with the msg.
            data = msg["content"]["data"]
            if "image/png" not in data:
                return msg

            # Otherwise, try to pickle the current figure so that we
            # can restore the context for future renderings. We construct
            # a new plot comm to advise the client of the new figure.
            pickled = self._pickle_current_figure()
            if pickled is not None:
                id = str(uuid.uuid4())
                self.figures[id] = pickled

                # Creating a comm per plot figure allows the client
                # to request new renderings of each plot at a later time,
                # e.g. on resizing the plots view
                self._create_comm(id)

                # Returning None implies our hook has processed the message
                # and it stops the parent from sending the display_data via
                # the standard iopub channel
                return None

        return msg

    def _create_comm(self, comm_id: str) -> None:
        """
        Create a new plot comm with the given id.
        """
        plot_comm = comm.create_comm(target_name=self.target_name, comm_id=comm_id)
        self.comms[comm_id] = plot_comm
        plot_comm.on_msg(self._receive_message)

    def _receive_message(self, raw_msg) -> None:
        """
        Handle client messages to render a plot figure.
        """
        try:
            msg = LanguageRuntimeCommMessage(**raw_msg["content"])
        except TypeError as exception:
            logger.warning(f"Ignoring invalid plot client message input: {exception}")
            return

        comm_id = msg.comm_id
        data = msg.data
        try:
            data = PlotClientMessageRender(**data)
        except TypeError:
            pass

        if isinstance(data, PlotClientMessageRender):
            figure_comm = self.comms.get(comm_id, None)
            if figure_comm is None:
                logger.warning(f"Plot figure comm {comm_id} not found")
                return

            pickled = self.figures.get(comm_id, None)
            if pickled is None:
                output = asdict(PlotClientMessageError(message=f"Figure {comm_id} not found"))
                figure_comm.send(output)
                return

            width_px = data.width or 0
            height_px = data.height or 0
            pixel_ratio = data.pixel_ratio or 1.0

            if width_px != 0 and height_px != 0:
                format_dict, md_dict = self._resize_pickled_figure(
                    pickled, width_px, height_px, pixel_ratio
                )
                data = format_dict["image/png"]
                output = asdict(PlotClientMessageImage(data=data, mime_type="image/png"))
                figure_comm.send(data=output, metadata=md_dict)

    def shutdown(self) -> None:
        """
        Shutdown plot comms and release any resources.
        """
        for figure_comm in self.comms.values():
            try:
                figure_comm.close()
            except Exception:
                pass
        self.comms.clear()
        self.figures.clear()

    # -- Private Methods --

    def _pickle_current_figure(self) -> Optional[str]:
        pickled = None
        figure = None

        # Delay importing matplotlib until the kernel and shell has been initialized
        # otherwise the graphics backend will be reset to the gui
        import matplotlib.pyplot as plt

        # We turn off interactive mode before accessing the plot context
        was_interactive = plt.isinteractive()
        plt.ioff()

        # Check to see if there are any figures left in stack to display
        # If not, get the number of figures to display from matplotlib
        if len(self.fignums) == 0:
            self.fignums = plt.get_fignums()

        # Get the current figure, remove from it from being called next hook
        if len(self.fignums) > 0:
            figure = plt.figure(self.fignums.pop(0))

        # Pickle the current figure
        if figure is not None and not self._is_figure_empty(figure):
            pickled = codecs.encode(pickle.dumps(figure), "base64").decode()

        if was_interactive:
            plt.ion()

        return pickled

    def _resize_pickled_figure(
        self,
        pickled: str,
        new_width_px: int = 614,
        new_height_px: int = 460,
        pixel_ratio: float = 1.0,
        formats: list = ["image/png"],
    ) -> Tuple[dict, dict]:
        # Delay importing matplotlib until the kernel and shell has been
        # initialized otherwise the graphics backend will be reset to the gui
        import matplotlib.pyplot as plt

        # Turn off interactive mode before, including before unpickling a
        # figures (otherwise it will cause and endless loop of plot changes)
        was_interactive = plt.isinteractive()
        plt.ioff()

        figure = pickle.loads(codecs.decode(pickled.encode(), "base64"))

        # Adjust the DPI based on pixel_ratio to accommodate high
        # resolution displays...
        dpi = BASE_DPI * pixel_ratio
        figure.set_dpi(dpi)

        # ... but use base DPI to convert to inch based dimensions.
        width_in, height_in = figure.get_size_inches()
        new_width_in = new_width_px / BASE_DPI
        new_height_in = new_height_px / BASE_DPI

        # Try to determine if the figure had an explicit width or height set.
        if width_in == DEFAULT_WIDTH_IN and height_in == DEFAULT_HEIGHT_IN:
            # If default values are still set, apply new size, even if this
            # resets the aspect ratio
            width_in = new_width_in
            height_in = new_height_in
        else:
            # Preserve the existing aspect ratio, constraining the scale
            # based on the shorter dimension
            if width_in < height_in:
                height_in = height_in * (new_width_in / width_in)
                width_in = new_width_in
            else:
                width_in = width_in * (new_height_in / height_in)
                height_in = new_height_in

        figure.set_size_inches(width_in, height_in)

        display_formatter = cast(DisplayFormatter, InteractiveShell.instance().display_formatter)
        format_dict, md_dict = display_formatter.format(figure, include=formats, exclude=[])

        plt.close(figure)

        if was_interactive:
            plt.ion()

        return (format_dict, md_dict)

    def _is_figure_empty(self, figure):
        children = figure.get_children()
        if len(children) < 1:
            return True

        for child in children:
            if child.get_visible():
                return False

        return True

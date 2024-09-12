#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

from unittest.mock import Mock

from positron_ipykernel.positron_ipkernel import PositronShell

from ..conftest import TestSession

MIME_TYPE_POSITRON_WEBVIEW_FLAG = "application/positron-webview-load.v0+json"


def test_bokeh_mime_tagging(
    shell: PositronShell, mock_display_pub: Mock, enable_bokeh_output_notebook: None
):
    """
    Test to make sure that the send message function in bokeh is patched to append a mime-type
    on messages that the front-end will use to know that the data coming over should be replayed in
    multiple steps.
    """
    shell.run_cell(
        """\
from bokeh.plotting import figure, show
p = figure(title="Simple line example", x_axis_label='x', y_axis_label='y')
p.line([1, 2, 3, 4, 5], [6, 7, 2, 4, 5], legend_label="Temp.", line_width=2)
show(p)
"""
    )

    calls = mock_display_pub.publish.call_args_list

    # Assert that one of the calls has the MIME_TYPE_POSITRON_WEBVIEW_FLAG key in it along with a
    # text/html key
    assert any(
        MIME_TYPE_POSITRON_WEBVIEW_FLAG in call.kwargs["data"]
        and "text/html" in call.kwargs["data"]
        for call in calls
    )


def test_model_repr_html_disabled(shell: PositronShell, session: TestSession):
    """
    Test to make sure that the text/html mime type is excluded from Bokeh Model subclass instances.
    This is used to prevent the awkward behavior of simple text showing up in the plots pane when a
    user builds a bokeh plot command line-by-line in the console.
    """

    shell.run_cell(
        """\
from bokeh.plotting import figure, show
p = figure(title="Simple line example", x_axis_label='x', y_axis_label='y')
p
"""
    )

    # Assert that none of the messages have a text/html mime type
    assert not any("text/html" in message["content"]["data"] for message in session.messages)

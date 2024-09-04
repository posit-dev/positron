def _positron_no_access(filename: str):
    return True


def bokeh_no_access():
    try:
        from bokeh.io import util

        util._no_access = _positron_no_access
    except ImportError:
        pass

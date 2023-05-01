#
# Copyright (C) 2023 Posit Software, PBC. All rights reserved.
#

import logging
import uuid
from typing import Any

from .dataviewer import DataColumn, DataSet
from .utils import get_qualname


class PositronInspector:

    def get_kind(self, value) -> str:
        pass

    def get_child_names(self, value) -> list:
        pass

    def has_child(self, value, child_name) -> bool:
        pass

    def get_child_info(self, value, child_name) -> (str, Any):
        pass

    def get_display_value(self, value) -> str:
        pass

    def get_display_type(self, value) -> str:
        pass

    def equals(self, value1, value2) -> bool:
        pass

    def copy(self, value) -> Any:
        pass

    def to_dataset(self, value, title: str) -> DataSet:
        pass

    def to_html(self, value) -> str:
        pass

    def to_tsv(self, value) -> str:
        pass


class PandasDataFrameInspector(PositronInspector):

    CLASS_QNAME = 'pandas.core.frame.DataFrame'

    def get_kind(self, value) -> str:
        if value is not None:
            return 'table'
        else:
            return 'empty'

    def get_child_names(self, value) -> list:
        try:
            return value.columns.values.tolist()
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            column = value[child_name]
            display_type = type(column).__name__
            values = column.values.tolist()

            # Include size information if we have it
            if hasattr(column, 'size'):
                size = column.size
            else:
                size = len(values)

            display_type = f'{display_type} [{size}]'
        except Exception:
            logging.warning('Unable to get Pandas child: %s', child_name, exc_info=True)

        return (display_type, values)

    def get_display_value(self, value) -> str:
        type_name = type(value).__name__
        shape = value.shape
        return f'{type_name}: [{shape[0]} rows x {shape[1]} columns]'

    def get_display_type(self, value) -> str:

        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f' [{shape[0]}x{shape[1]}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_dataset(self, value, title: str) -> DataSet:
        columns = []
        for column_name in self.get_child_names(value):
            column = value[column_name]
            column_type = type(column).__name__
            column_data = column.values.tolist()
            columns.append(DataColumn(column_name, column_type, column_data))

        return DataSet(str(uuid.uuid4()), title, columns)

    def to_html(self, value) -> str:
        return value.to_html()

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep='\t')

class PandasSeriesInspector(PositronInspector):

    CLASS_QNAME = 'pandas.core.series.Series'

    def get_kind(self, value) -> str:
        if value is not None:
            return 'table'
        else:
            return 'empty'

    def get_child_names(self, value) -> list:
        try:
            return map(str, list(range(value.size)))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            item = value.iat[int(child_name)]
            display_type = type(item).__name__
            return (display_type, item)
        except Exception:
            logging.warning('Unable to get Series child: %s', child_name, exc_info=True)
        return ('unknown', [])

    def get_display_value(self, value) -> str:
        return str(value)

    def get_display_type(self, value) -> str:

        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f' [{length}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.equals(value2)

    def copy(self, value) -> Any:
        return value.copy()

    def to_html(self, value) -> str:
        # TODO: Support HTML
        return self.to_tsv(value)

    def to_tsv(self, value) -> str:
        return value.to_csv(path_or_buf=None, sep='\t')


class PolarsInspector(PositronInspector):

    CLASS_QNAME = 'polars.dataframe.frame.DataFrame'

    def get_kind(self, value) -> str:
        if value is not None:
            return 'table'
        else:
            return 'empty'

    def get_child_names(self, value) -> list:
        try:
            return value.columns
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            column = value.get_column(child_name)
            display_type = type(column).__name__
            return (display_type, column.to_list())
        except Exception:
            logging.warning('Unable to get Polars child: %s', child_name, exc_info=True)
            return ('unknown', [])

    def get_display_value(self, value) -> str:
        type_name = type(value).__name__
        shape = value.shape
        return f'{type_name}: [{shape[0]} rows x {shape[1]} columns]'

    def get_display_type(self, value) -> (int, int):

        display_type = type(value).__name__
        shape = value.shape
        display_type = display_type + f' [{shape[0]}x{shape[1]}]'

        return display_type

    def equals(self, value1, value2) -> bool:
        return value1.frame_equal(value2)

    def copy(self, value) -> Any:
        return value.clone()

    def to_dataset(self, value, title: str) -> DataSet:
        columns = []
        for column_name in self.get_child_names(value):
            column = value.get_column(column_name)
            column_type = type(column).__name__
            column_data = column.to_list()
            columns.append(DataColumn(column_name, column_type, column_data))

        return DataSet(str(uuid.uuid4()), title, columns)

    def to_html(self, value) -> str:
        return value._repr_html_()

    def to_tsv(self, value) -> str:
        return value.write_csv(file=None, separator='\t')


class NumpyNdarrayInspector(PositronInspector):

    CLASS_QNAME = 'numpy.ndarray'

    def get_kind(self, value) -> str:
        if value is not None:
            return 'table'
        else:
            return 'empty'

    def get_child_names(self, value) -> list:
        try:
            return map(str, list(range(len(value))))
        except Exception:
            return []

    def has_child(self, value, child_name) -> bool:
        return child_name in self.get_child_names(value)

    def get_child_info(self, value, child_name) -> (str, Any):
        try:
            child = value[int(child_name)]
            child_display_type = type(child).__name__
            return (child_display_type, child)
        except Exception:
            logging.warning('Unable to get ndarray child: %s', child_name, exc_info=True)
            return ('unknown', [])

    def get_display_value(self, value) -> str:
        return str(value)

    def get_display_type(self, value) -> str:
        display_type = type(value).__name__
        length = len(value)
        display_type = display_type + f' [{length}]'

        return display_type

    def equals(self, value1, value2) -> bool:

        # Try to use numpy's array_equal
        try:
            import numpy as np
            return np.array_equal(value1, value2)
        except Exception as err:
            logging.warning("numpy equals %s", err, exc_info=True)

        # Fallback to comparing the raw bytes
        if value1.shape != value2.shape:
            return False
        return value1.tobytes() == value2.tobytes()

    def copy(self, value) -> Any:
        return value.copy()

INSPECTORS = {PandasDataFrameInspector.CLASS_QNAME: PandasDataFrameInspector(),
              PandasSeriesInspector.CLASS_QNAME: PandasSeriesInspector(),
              PolarsInspector.CLASS_QNAME: PolarsInspector(),
              NumpyNdarrayInspector.CLASS_QNAME: NumpyNdarrayInspector()}

def is_inspectable(value) -> bool:
    qualname = get_qualname(value)
    if qualname in INSPECTORS.keys():
        return True
    return False

def get_inspector(value) -> PositronInspector:
    qualname = get_qualname(value)
    return INSPECTORS.get(qualname, None)

import pandas as pd
import os

def get_data_from_excel():
    df = pd.read_excel(
        io=os.path.join(os.getcwd(), 'data-files', 'supermarkt_sales', 'supermarkt_sales.xlsx'),
        engine="openpyxl",
        sheet_name="Sales",
        skiprows=3,
        usecols="B:R",
        nrows=1000,
    )
    # Add 'hour' column to dataframe
    df["hour"] = pd.to_datetime(df["Time"], format="%H:%M:%S").dt.hour
    return df

df = get_data_from_excel()

import os
import sqlite3
import pandas as pd
data_file_path = os.path.join(os.getcwd(), 'data-files', 'chinook', 'chinook.db')
conn = sqlite3.connect(data_file_path)
cur = conn.cursor()
cur.execute('select * from albums')
rows = cur.fetchall()
df = pd.DataFrame(rows)
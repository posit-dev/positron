library(arrow)
library(dplyr)

# Build the file path (similar to os.path.join in Python)
data_file_path <- file.path(getwd(), "data-files", "flights", "flights.parquet")

# Read the original file
df <- read_parquet(data_file_path)

# Repeat the DataFrame 15 times ~ 5 million rows
df_5mil <- bind_rows(replicate(15, df, simplify = FALSE))

# Verify the size
cat("Number of rows in the expanded DataFrame:", nrow(df_5mil), "\n")
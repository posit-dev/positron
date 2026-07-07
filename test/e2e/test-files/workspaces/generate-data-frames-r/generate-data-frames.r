library(tidyverse)
library(arrow)

# seems like a reasonable upper limit on an m3 with 36Gb
num_rows <- 30000
num_cols <- 30000

# Create a data frame with random integers
data <- replicate(num_cols, sample(0:99, num_rows, replace = TRUE))

# Convert the matrix to a data frame and assign column names
df <- as.data.frame(data)
colnames(df) <- paste0('col', 1:num_cols)

file_path <- file.path(getwd(), 'data-files', '30kX30k.parquet')

# don't add to github:
write_parquet(df, file_path)
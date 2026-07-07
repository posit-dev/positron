library(arrow)
library(dplyr)

Sys.setenv(TZ='GMT')
df3 <- read_parquet(file.path(getwd(), "data-files", "20x1000", "parquet1kx20.parquet"))
df3_large <- df3[rep(seq_len(nrow(df3)), times = 1000), ]
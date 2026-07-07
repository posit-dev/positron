library(readxl)
library(dplyr)
library(lubridate)

Sys.setenv(TZ='GMT')

get_data_from_excel <- function() {
  # Construct the file path
  file_path <- file.path(getwd(), 'data-files', 'supermarkt_sales', 'supermarkt_sales.xlsx')
  
  # Read the Excel file
  df <- read_excel(
    path = file_path,
    sheet = "Sales",
    skip = 3,  # Skip the first 3 rows
    col_names = TRUE,  # Ensure the first row after skip is treated as headers
    col_types = c("text", "text", "text", "text", "text", "text", "numeric", "numeric", "numeric", "numeric", "date", "date", "text", "numeric", "numeric", "numeric", "numeric" )
  )
  
  # Select columns B to R (which are columns 1 to 17 in R)
  df <- df %>%
    select(1:17)
  
  # Convert the Time column to hours
  df <- df %>%
    mutate(hour = hour(Time))
  
  return(df)
}

df2 <- get_data_from_excel()
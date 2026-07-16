gen_word <- function(input, output, session) {
  
  
  # https://www.wordexample.com/list/most-common-nouns-english
  dt = read.csv('most-common-nouns-english.csv')
  
  words = toupper(dt[nchar(as.character(dt[,1])) > 2,1])
  
  word_ = sample(words,1)
  
  dt_word = data.frame(letter = unlist(strsplit(word_, "")),
                       guessed = '_',
                       stringsAsFactors = FALSE)
  
  return(dt_word)
}


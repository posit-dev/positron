import streamlit as st
x = st.slider('x')
st.write(x, 'squared is', x * x)
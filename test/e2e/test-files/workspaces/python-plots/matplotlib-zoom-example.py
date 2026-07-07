import seaborn as sns
import matplotlib.pyplot as plt

# Load the tips dataset
tips = sns.load_dataset("tips")

# Create a scatter plot with facets
sns.relplot(
    data=tips,
    x="total_bill",
    y="tip",
    hue="time",
    col="day",
    col_wrap=2,
    height=4,
    aspect=1.2,
)

# Customize the plot
plt.suptitle("Tips vs Total Bill by Time of Day and Day of Week", y=1.02)

# Show the plot
plt.show()
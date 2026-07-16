# wget "https://datasets.cellxgene.cziscience.com/981bcf57-30cb-4a85-b905-e04373432fef.h5ad"
# note that the above file is greater than 9Gb and download is time consuming
import scanpy as sc
test=sc.read_h5ad("981bcf57-30cb-4a85-b905-e04373432fef.h5ad")
test
sc.set_figure_params(dpi=80,dpi_save=300)
sc.pl.umap(test,color=['ENSG00000081237','ENSG00000119888','ENSG00000261371','ENSG00000164692','ENSG00000107796'],use_raw=True,legend_loc="on data")
sc.pl.umap(test,color=['ENSG00000081237','ENSG00000119888','ENSG00000261371','ENSG00000164692','ENSG00000107796'],use_raw=True,legend_loc="on data")
sc.pl.umap(test,color=['ENSG00000081237','ENSG00000119888','ENSG00000261371','ENSG00000164692','ENSG00000107796'],use_raw=True,legend_loc="on data")
sc.pl.umap(test,color=['ENSG00000081237','ENSG00000119888','ENSG00000261371','ENSG00000164692','ENSG00000107796'],use_raw=True,legend_loc="on data")
testdf=test.obs # Generate a table
---
name: "INTERNAL: Python maintenance"
about: Checklist for performing monthly maintenance for positron-python
---

## New version number

``

## Checklist

- [ ] Merge upstream changes
- [ ] If needed, match CI changes from upstream merge into Positron's `.github/workflows/positron-python-ci.yml`
- [ ] Run [**Build Python Environment Tools Release** workflow in the `positron-builds` repo](https://github.com/posit-dev/positron-builds/actions/workflows/build-python-env-tools.yml) to check for and build latest PET releases
- [ ] If new PET release, update version number in `package.json`, under `positron -> pet`
- [ ] Update `python_files/posit/uv.lock` by running `uv lock` in the `python_files/posit` folder
- [ ] Run `scripts/pip-compile-ipykernel.py` to update `python_files/ipykernel_requirements/{py3,cp3,cpx}-requirements.txt`
- [ ] Follow the instructions in `python_files/positron_requirements/requirements.in` to update `python_files/positron_requirements/requirements.txt`

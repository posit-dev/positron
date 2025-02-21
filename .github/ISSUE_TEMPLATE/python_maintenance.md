---
name: "INTERNAL: Python maintenance"
about: Checklist for performing monthly maintenance for positron-python
---

## New version number

## Checklist

- [ ] Merge upstream changes
- [ ] If needed, match CI changes from upstream merge into Positron's `.github/workflows/positron-python-ci.yml`
- [ ] Run [**Build Python Environment Tools Release** workflow in the `positron-pet-builds` repo](https://github.com/posit-dev/positron-pet-builds/actions/workflows/release.yml) to check for and build latest PET releases
- [ ] If new PET release, update version number in `package.json`, under `positron -> pet`
- [ ] Update dependencies in `build/pinned-test-requirements.txt`

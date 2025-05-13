#!/usr/bin/env sh

perl -pi -e 's/Failed to install Visual Studio Code update./Failed to install Positron update.          /g' inno_updater.exe
perl -pi -e 's/Please verify there are no Visual Studio Code processes still executing./Please verify there are no Positron processes still executing.          /g' inno_updater.exe
perl -pi -e 's/Visual Studio Code is updating.../Positron is updating...          /g' inno_updater.exe
perl -pi -e 's/Visual Studio Code/Positron          /g' inno_updater.exe

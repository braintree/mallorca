#!/bin/bash
nvm_version="0.10.21"
nvm_location="/var/lib/jenkins/.nvm/v$nvm_version/bin"

source ~/.nvm/nvm.sh

if [ ! -d nvm_location ]; then
    nvm install $nvm_version
  fi

nvm use $nvm_version
npm install .
npm test

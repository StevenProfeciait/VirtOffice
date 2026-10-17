#!/bin/bash
# Refresh VirtOffice agents.json from the TEVA board every 3 minutes.
while true; do /usr/bin/python3 /Users/stevenayensu/Documents/GitHub/VirtOffice/scripts/teva_sync.py; sleep 180; done

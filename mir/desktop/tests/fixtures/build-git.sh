#!/usr/bin/env bash
# Test-only release checkout without network access.
if [[ "$*" == *' clone '* ]]; then
    destination=${*: -1}
    mkdir -p "$destination/tools/server/public"
    printf 'test UI' > "$destination/tools/server/public/index.html"
else
    printf '1111111111111111111111111111111111111111\n'
fi

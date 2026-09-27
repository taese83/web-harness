#!/usr/bin/env bash
# 빈 작업 공간에 브라운필드 티켓 프로젝트 시드를 깔고 git 기준점을 만든다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp -R "$here/../seeds/brownfield-ticket-project/." .
git init -q
git add -A
git -c user.email=eval@example.invalid -c user.name=eval commit -q -m seed

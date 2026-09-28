#!/usr/bin/env bash
# 빈 작업 공간에 기획·수용 기준이 결박된 브라운필드 시드를 깔고 git 기준점을 만든다(light 레인 전제).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp -R "$here/../seeds/brownfield-planned-project/." .
git init -q
git add -A
git -c user.email=eval@example.invalid -c user.name=eval commit -q -m seed

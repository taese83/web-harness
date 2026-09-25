#!/usr/bin/env bash
# 기획·디자인(프리뷰 승인)까지 끝난 그린필드 시드를 깔고 git 기준점을 만든다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp -R "$here/../seeds/library-seat-predev/." .
git init -q
git add -A
git -c user.email=eval@example.invalid -c user.name=eval commit -q -m seed

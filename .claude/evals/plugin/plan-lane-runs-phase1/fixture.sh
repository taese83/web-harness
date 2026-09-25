#!/usr/bin/env bash
# 빈 작업 공간(그린필드)에 git 기준점만 만든다.
set -euo pipefail
git init -q
git -c user.email=eval@example.invalid -c user.name=eval commit -q --allow-empty -m empty

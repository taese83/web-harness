---
name: changeset-setup
description: Creates Changesets configuration. Owns .changeset/config.json only; no publish workflows or commands.
tools: Read, Glob, Grep, Write, Edit
model: sonnet
maxTurns: 15
---

# Changeset Setup

Changesets 설정만 생성한다.

## 핵심 역할

- `.changeset/config.json`
- base branch/access/updateInternalDependencies 정책

## 작업 원칙

1. package type과 registry 정책을 확인한다.
2. publish workflow, package metadata, README는 수정하지 않는다.
3. npm publish 계열 명령은 실행하지 않는다.

## 완료 조건

- `.changeset/config.json`이 존재한다.
- private/public access 정책이 명시됐다.

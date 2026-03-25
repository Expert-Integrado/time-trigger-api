---
phase: quick
plan: 260325-lb7
subsystem: ci
tags: [ci, github-actions, pnpm, lint, test, build]
dependency_graph:
  requires: []
  provides: [ci-pipeline]
  affects: [.github/workflows/ci.yml]
tech_stack:
  added: [actions/checkout@v4, actions/setup-node@v4, pnpm/action-setup@v4, actions/cache@v4]
  patterns: [pnpm-store-cache, frozen-lockfile]
key_files:
  created:
    - .github/workflows/ci.yml
  modified: []
decisions:
  - "pnpm/action-setup@v4 sem version explicita — detecta via campo packageManager no package.json ou usa versao estavel mais recente"
  - "Cache via actions/cache@v4 no pnpm store path — evita re-download entre runs consecutivas"
  - "pnpm install --frozen-lockfile — garante reproducibilidade e falha se lock estiver desatualizado"
  - "pnpm run lint usa --fix internamente — no CI pode gerar diff sem commit; comportamento aceito pois lint falha apenas se houver erros nao-auto-fixaveis"
metrics:
  duration: "2 min"
  completed: "2026-03-25"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Quick Task 260325-lb7: Create CI Workflow with Lint, Test, and Build

**One-liner:** GitHub Actions CI pipeline separado com pnpm store cache, Node 22, e sequencia lint -> test -> build em push e PRs para main.

## What Was Built

Arquivo `.github/workflows/ci.yml` criado com pipeline de CI completo que:

- Dispara em `push` E `pull_request` para a branch `main`
- Usa Node 22 via `actions/setup-node@v4`
- Configura pnpm via `pnpm/action-setup@v4` (auto-detecta versao do `packageManager` no `package.json`)
- Cacheia o pnpm store via `actions/cache@v4` com chave baseada em hash do `pnpm-lock.yaml`
- Instala dependencias com `--frozen-lockfile` para reproducibilidade
- Executa `pnpm run lint`, `pnpm run test` e `pnpm run build` em sequencia

O arquivo `docker-publish.yml` permanece completamente inalterado.

## Decisions Made

### 1. pnpm/action-setup@v4 sem versao explicita
A action detecta a versao do pnpm via campo `packageManager` no `package.json`. Se o campo nao existir, usa a versao estavel mais recente. Nao foi necessario fixar uma versao especifica no workflow.

### 2. Cache do pnpm store
Optou-se por cachear o store do pnpm (nao o `node_modules`) pois e a abordagem recomendada pelo pnpm. A chave inclui hash do `pnpm-lock.yaml` para invalidar cache automaticamente quando dependencias mudam.

### 3. --frozen-lockfile
Garante que o `pnpm-lock.yaml` esta sincronizado com o `package.json`. Se estiverem divergentes, o install falha explicitamente — preferivel a instalar versoes inesperadas silenciosamente.

### 4. Comportamento do lint com --fix no CI
O script `pnpm run lint` chama ESLint com `--fix`. No contexto de CI, isso pode auto-corrigir arquivos e gerar um diff que nao sera commitado. O comportamento e aceito: o job so falha se houver erros que o ESLint nao consegue auto-fixar. Caso se queira comportamento mais estrito, o script de lint poderia ser alterado para remover o `--fix` ou adicionar um check separado.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Criar .github/workflows/ci.yml | 86cc7f4 | .github/workflows/ci.yml |

## Self-Check: PASSED

- [x] `.github/workflows/ci.yml` exists
- [x] Commit `86cc7f4` present in git log
- [x] `docker-publish.yml` unchanged
- [x] All 7 automated verifications passed (FILE EXISTS, PR TRIGGER OK, INSTALL STEP OK, LINT STEP OK, TEST STEP OK, BUILD STEP OK, NODE 22 OK)

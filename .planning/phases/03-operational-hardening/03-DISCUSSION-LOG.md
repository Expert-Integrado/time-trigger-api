# Phase 3: Operational Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 03-Operational Hardening
**Areas discussed:** Docker config, Health endpoint, Paralelismo, CI/CD

---

## Docker Config

| Option | Description | Selected |
|--------|-------------|----------|
| node:22-alpine | Imagem leve (~50MB) | |
| node:22-slim | Debian slim (~80MB), mais compatível | ✓ |
| Você decide | Melhor opção pro contexto | |

**User's choice:** node:22-slim

| Option | Description | Selected |
|--------|-------------|----------|
| Sim (Recomendado) | Multi-stage build | ✓ |
| Não | Single stage | |

**User's choice:** Multi-stage build

| Option | Description | Selected |
|--------|-------------|----------|
| Sim | docker-compose.yml com env_file, restart, healthcheck | ✓ |
| Só Dockerfile | Sem compose | |

**User's choice:** Sim, com docker-compose.yml

---

## Health Endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Stats detalhados | lastCycleAt, dbsScanned, eligible, runsDispatched, errors, uptime | |
| Só status | { status: 'ok', uptime: 123 } | ✓ |
| Você decide | | |

**User's choice:** Só status — mínimo pra Docker HEALTHCHECK

| Option | Description | Selected |
|--------|-------------|----------|
| 3000 (padrão NestJS) | Porta fixa | |
| Configurável via PORT | PORT env var com default 3000 | ✓ |

**User's choice:** Configurável via PORT

---

## Paralelismo

| Option | Description | Selected |
|--------|-------------|----------|
| Sem limite | Promise.allSettled em todos os DBs | ✓ |
| Limite configurável | MAX_CONCURRENT_DBS env var | |
| Limite fixo | Fixar em 10 concorrentes | |

**User's choice:** Sem limite

---

## CI/CD

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions | Build + push pro GHCR | ✓ |
| GitLab CI | Build + push pro GitLab Registry | |

**User's choice:** GitHub Actions com push pra GitHub Container Registry

## Claude's Discretion

- Dockerfile optimization (layer caching, COPY ordering)
- GitHub Actions workflow structure
- Health controller implementation
- Promise.allSettled refactoring approach

## Deferred Ideas

None

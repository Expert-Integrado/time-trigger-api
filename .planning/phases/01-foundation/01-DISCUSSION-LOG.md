# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 01-Foundation
**Areas discussed:** Env & Config, DB Discovery, Logging

---

## Env & Config

| Option | Description | Selected |
|--------|-------------|----------|
| Milissegundos | Ex: CRON_INTERVAL=10000 (10 segundos) — simples, direto | ✓ |
| Segundos | Ex: CRON_INTERVAL=10 — mais legível, converte pra ms internamente | |
| Cron expression | Ex: CRON_INTERVAL=*/10 * * * * * — flexível mas complexo | |

**User's choice:** Milissegundos
**Notes:** Formato mais direto, sem conversão necessária.

| Option | Description | Selected |
|--------|-------------|----------|
| Horário de Brasília | morningLimit=9 significa 9h BRT | ✓ |
| UTC | morningLimit=9 significa 9h UTC | |
| Não sei | Preciso verificar | |

**User's choice:** Horário de Brasília
**Notes:** Confirmado que valores no MongoDB são em horário local brasileiro.

| Option | Description | Selected |
|--------|-------------|----------|
| Só essas duas | MONGODB_URI e CRON_INTERVAL | |
| Adicionar TZ | TZ=America/Sao_Paulo como env var configurável | ✓ |
| Quero mais | Listar mais variáveis | |

**User's choice:** Adicionar TZ
**Notes:** TZ como env var para timezone configurável.

---

## DB Discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Só coleções | Aceita qualquer banco com runs + webhooks + vars | ✓ |
| Também por prefixo | Só bancos com 'sdr-' ou 'n8n-' | |
| Lista configurável | Lista de bancos via env var | |

**User's choice:** Só coleções
**Notes:** Simples e automático — sem filtro por nome.

| Option | Description | Selected |
|--------|-------------|----------|
| A cada ciclo | Lista bancos toda vez que o cron roda | ✓ |
| No startup | Lista uma vez e mantém em memória | |
| Intervalo fixo | Re-lista a cada X minutos | |

**User's choice:** A cada ciclo
**Notes:** Pega novos bancos automaticamente sem precisar reiniciar.

---

## Logging

| Option | Description | Selected |
|--------|-------------|----------|
| NestJS Logger padrão | Logger nativo, texto colorido no dev | ✓ |
| JSON estruturado | Pino ou Winston com output JSON | |
| Você decide | O que funcionar melhor | |

**User's choice:** NestJS Logger padrão
**Notes:** Sem dependência extra.

| Option | Description | Selected |
|--------|-------------|----------|
| Resumido | 1 linha por ciclo com contadores | ✓ |
| Detalhado | 1 linha por DB + resumo | |
| Verbose | Loga cada operação | |

**User's choice:** Resumido
**Notes:** 1 linha por ciclo: DBs scanned, eligible, errors.

## Claude's Discretion

- Module structure (MongoService, DatabaseScanService, ConfigModule)
- Error handling patterns for MongoDB connection failures
- Exact log format and message wording

## Deferred Ideas

None

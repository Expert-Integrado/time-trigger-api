# Phase 10: Message-Run Dependency - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 10-message-run-dependency
**Areas discussed:** Origem do botIdentifier, processingStartedAt no retry, Onde mora o check, Log de runs bloqueados

---

## Origem do botIdentifier

| Option | Description | Selected |
|--------|-------------|----------|
| Campo no documento de run | O run tem botIdentifier como campo próprio — a query usa run.botIdentifier + run.chatDataId | ✓ |
| Do vars (já disponível no ciclo) | Usa o botIdentifier lido do vars para todos os runs daquele database | |

**User's choice:** Campo no documento de run
**Notes:** botIdentifier e chatDataId são campos do próprio run document — a query usa ambos diretamente.

---

## processingStartedAt no retry

| Option | Description | Selected |
|--------|-------------|----------|
| Ambos os caminhos | processingStartedAt gravado onde quer que a mudança ocorra — tanto no sucesso imediato quanto no retry | ✓ |
| Só o caminho principal | processingStartedAt só no sucesso imediato — retry não tem o timestamp | |

**User's choice:** Ambos os caminhos
**Notes:** DEP-01 sem exceções. O campo é usado pela fase 11 (timeout recovery), então precisa estar presente independentemente do caminho que resultou no "processing".

---

## Onde mora o check

| Option | Description | Selected |
|--------|-------------|----------|
| MessageCheckService separado | Serviço isolado, injetável, testável de forma unitária independente | ✓ |
| Inline em processDatabaseRuns | Uma chamada a db.collection('messages').findOne(...) direto no loop | |

**User's choice:** MessageCheckService separado
**Notes:** Segue o padrão arquitetural do projeto e facilita testes isolados.

---

## Log de runs bloqueados

| Option | Description | Selected |
|--------|-------------|----------|
| Por run individual | Log por run: '[dbName] Run {id} blocked — message still processing (chatDataId: X)' | ✓ |
| Resumo ao final do ciclo | Contador acumulado: '[dbName] X runs blocked by processing messages' | |
| Claude decide | Sem preferência | |

**User's choice:** Por run individual
**Notes:** Nível warn, granularidade por run para facilitar diagnóstico em produção.

---

## Claude's Discretion

- Posicionamento exato do check dentro do loop (antes/depois do rate limit check)
- Comportamento quando botIdentifier ou chatDataId ausentes no run document
- Número exato de testes unitários por cenário

## Deferred Ideas

Nenhuma.

# Phase 9: Rate Limiting - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Adicionar contadores de rate limit por-database por-ciclo nas três funções `processDatabase*` do `RunDispatchService`. Cada tipo de dispatch (runs, FUP, messages) tem seu próprio limite configurável via env var. Quando o limite é atingido para um database, os itens restantes são pulados e o ciclo completa sem erro.

Requirements: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05, RATE-06, RATE-07

</domain>

<decisions>
## Implementation Decisions

### Interface de retorno dos métodos dispatch

- **D-01:** `WebhookDispatchService.dispatch()`, `dispatchFup()`, e `dispatchMessage()` passam a retornar `Promise<boolean>` — `true` se o `findOneAndUpdate` atômico retornou um documento (claim bem-sucedido), `false` caso contrário
- **D-02:** O counter no `processDatabase*` incrementa **apenas** quando o método retorna `true` — satisfaz RATE-06 exato (claims atômicos falhos não consomem quota)
- **D-03:** A lógica de retry (setTimeout fire-and-forget) continua retornando void internamente — o claim assíncrono do retry acontece após o ciclo, portanto naturalmente fora do scope do counter

### Contadores por dispatch type

- **D-04:** Cada chamada `processDatabase*` cria variáveis `let counter = 0` locais ao método — já escopo por-database por-ciclo (RATE-01, RATE-07)
- **D-05:** `processDatabaseRuns` terá **dois contadores independentes**: um para runs (`counterRuns`) e um para FUPs (`counterFup`) — refletem `RATE_LIMIT_RUNS` e `RATE_LIMIT_FUP` separadamente
- **D-06:** Quando `counter >= limit`, o loop faz `break` e para de iterar os itens restantes (não `continue`) — satisfaz RATE-05

### Env vars

- **D-07:** `RATE_LIMIT_RUNS`, `RATE_LIMIT_FUP`, `RATE_LIMIT_MESSAGES` são **opcionais com default 10** — se ausentes no `.env`, usa `parseInt(process.env.RATE_LIMIT_RUNS ?? '10', 10)`
- **D-08:** Segue o que o requirements doc documenta `(default: 10)` — menos atrito no deploy que o padrão fail-fast dos CRON_INTERVAL_*
- **D-09:** Valores lidos no `validateEnv()` / ConfigService existente e passados para `RunDispatchService` via injeção

### Logging

- **D-10:** Ao final de cada `processDatabase*`, sempre loga 1 linha por dispatch type: `[dbName] Runs: X/Y dispatched` (mesmo quando X=0)
- **D-11:** Quando o limite é atingido, loga um `warn` adicional antes do break: `[dbName] Rate limit reached for runs (10/10) — skipping remaining items`

### Claude's Discretion

- Estrutura exata da assinatura dos tipos (se `Promise<boolean>` ou wrapper com mais info)
- Ordem dos guards (check limit antes ou depois de buscar os documentos do MongoDB)
- Exato formato da string de log

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — RATE-01 through RATE-07 acceptance criteria
- `.planning/ROADMAP.md` §Phase 9 — Phase goal, success criteria, plan breakdown

### Codebase (leitura obrigatória antes de modificar)
- `src/dispatch/run-dispatch.service.ts` — `processDatabaseRuns`, `processDatabaseFup`, `processDatabaseMessages` onde os counters entram; `runRunsCycle/runFupCycle/runMessagesCycle` que leem env vars
- `src/dispatch/webhook-dispatch.service.ts` — `dispatch`, `dispatchFup`, `dispatchMessage` que mudarão para retornar `Promise<boolean>`
- `src/dispatch/run-dispatch.service.spec.ts` — testes existentes que precisam ser atualizados para interface nova

</canonical_refs>

<code_context>
## Existing Code Insights

### Padrão atual dos métodos dispatch (serão modificados)
- `WebhookDispatchService.dispatch(db, run, url): Promise<void>` — posta primeiro, depois findOneAndUpdate se sucesso
- `WebhookDispatchService.dispatchFup(db, fup, url): Promise<void>` — mesmo padrão
- `WebhookDispatchService.dispatchMessage(db, message, url): Promise<void>` — mesmo padrão
- Todos têm retry fire-and-forget via `setTimeout(retryFn, 60_000)` — esse retry NÃO conta para o rate limit

### Loops que receberão os counters
- `processDatabaseRuns`: loops separados `for (const run of runs)` e `for (const fup of fups)` — dois counters independentes (`counterRuns`, `counterFup`)
- `processDatabaseFup`: `for (const fup of fups)` — um counter `counterFup`
- `processDatabaseMessages`: `for (const message of messages)` — um counter `counterMessages`

### Padrão de env vars existente
- `CRON_INTERVAL_RUNS/FUP/MESSAGES` — required, fail-fast (process.exit(1) se ausentes)
- `RATE_LIMIT_RUNS/FUP/MESSAGES` — opcional, default 10 (decisão D-07)

</code_context>

<specifics>
## Specific Ideas

- O requirements diz explicitamente "Rate limit counter increments only after a successful dispatch (findOneAndUpdate returned a document)" — a mudança de `void` para `boolean` é o veículo para isso
- `processDatabaseRuns` atualmente despacha tanto runs quanto FUPs no mesmo método (herança da v1.4); os dois tipos têm limits independentes, então precisam de dois contadores separados
- O log "Runs: X/Y dispatched" deve aparecer mesmo quando X=0 — facilita diagnóstico de por que nada foi despachado

</specifics>

<deferred>
## Deferred Ideas

Nenhuma — discussão manteve-se dentro do escopo da fase.

</deferred>

---

*Phase: 09-rate-limiting*
*Context gathered: 2026-03-30*

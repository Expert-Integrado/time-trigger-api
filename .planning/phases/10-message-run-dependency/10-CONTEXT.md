# Phase 10: Message-Run Dependency - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Antes de despachar um run, verificar se existe alguma mensagem com `messageStatus: "processing"` com o mesmo `botIdentifier` + `chatDataId` do run. Se existir, o run é pulado e permanece em `"waiting"` para o próximo ciclo. Também: ao marcar uma mensagem como `"processing"`, gravar o campo `processingStartedAt` com o timestamp atual.

Requirements: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05

</domain>

<decisions>
## Implementation Decisions

### Origem dos campos para o dependency check

- **D-01:** `botIdentifier` vem do **documento de run** diretamente (`run.botIdentifier`) — não do `vars`. O run tem ambos os campos necessários: `botIdentifier` + `chatDataId`
- **D-02:** A query do MongoDB usa `{ botIdentifier: run.botIdentifier, chatDataId: run.chatDataId, messageStatus: 'processing' }` — sempre ambos os campos (DEP-04)
- **D-03:** Somente `"processing"` bloqueia runs — mensagens em `"pending"` não entram no filtro (DEP-05)

### processingStartedAt

- **D-04:** `processingStartedAt` é gravado em **ambos os caminhos** de `dispatchMessage`: sucesso imediato E no retry (setTimeout 60s)
- **D-05:** É adicionado ao `$set` do `findOneAndUpdate` junto com `messageStatus: 'processing'` — operação atômica. Ex: `{ $set: { messageStatus: 'processing', processingStartedAt: new Date() } }`
- **D-06:** O retry fire-and-forget também inclui `processingStartedAt` — garante que mensagens recuperadas via retry tenham o campo para timeout recovery (fase 11)

### Arquitetura: MessageCheckService

- **D-07:** Criar `MessageCheckService` como serviço NestJS separado (`src/dispatch/message-check.service.ts`) — injetável, testável de forma independente, coeso com o escopo de queries na coleção `messages`
- **D-08:** `MessageCheckService` expõe um método `hasProcessingMessage(db: Db, botIdentifier: string, chatDataId: string): Promise<boolean>` — retorna `true` se existe mensagem bloqueante, `false` caso contrário
- **D-09:** `RunDispatchService` recebe `MessageCheckService` via injeção de dependência (padrão NestJS estabelecido no projeto)

### Logging de runs bloqueados

- **D-10:** Log por run individual quando bloqueado: `[dbName] Run {id} blocked — message still processing (chatDataId: X, botIdentifier: Y)`
- **D-11:** Nível `warn` para runs bloqueados — sinaliza que o ciclo não conseguiu despachar o run, útil para diagnóstico em produção

### Claude's Discretion

- Posicionamento exato do check dentro do loop (antes ou depois do rate limit check) — coerência com o fluxo de guarda existente
- Se `botIdentifier` ou `chatDataId` estiverem ausentes no run document: skip silencioso ou log de aviso
- Número de testes unitários por cenário

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs
- `.planning/PROJECT.md` — Core value, constraints, decisões chave
- `.planning/REQUIREMENTS.md` — DEP-01 a DEP-05 critérios de aceitação
- `.planning/ROADMAP.md` §Phase 10 — Goal, success criteria, plan breakdown

### Codebase (leitura obrigatória antes de modificar)
- `src/dispatch/run-dispatch.service.ts` — `processDatabaseRuns` onde o check entra; estrutura atual dos loops de runs
- `src/dispatch/webhook-dispatch.service.ts` — `dispatchMessage` onde `processingStartedAt` é adicionado ao `$set`
- `src/dispatch/run-dispatch.service.spec.ts` — padrões de testes existentes, estrutura de mocks
- `docs/vars-schema.md` — Schema do documento vars (botIdentifier, timeTrigger)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WebhookDispatchService.dispatchMessage`: já retorna `Promise<boolean>`, tem dois pontos onde `messageStatus: 'processing'` é setado (main + retry) — ambos precisam receber `processingStartedAt`
- `RunDispatchService`: já lê `vars` e `webhooks` no início de `processDatabaseRuns`; loop `for (const run of runs)` é onde o check de dependência entra

### Established Patterns
- Serviços NestJS com `@Injectable()` e injeção via constructor `private readonly`
- Rate limit check antes do dispatch (`if (counterRuns >= this.rateLimitRuns) break`) — dependency check entra no mesmo estilo de guarda
- Logs com prefixo `[dbName]` e níveis `log`/`warn`

### Integration Points
- `RunDispatchService` precisa receber `MessageCheckService` via injeção — atualizar `DispatchModule` para registrar o novo serviço
- `MessageCheckService` aceita `Db` (instância por chamada) — sem estado interno, sem dependência de `MongoService` diretamente no serviço

</code_context>

<specifics>
## Specific Ideas

- O requirements diz "dependency filter always uses both `botIdentifier` AND `chatDataId` — never one field alone" (DEP-04) — a assinatura `hasProcessingMessage(db, botIdentifier, chatDataId)` reflete isso explicitamente
- `processingStartedAt` é o campo que a fase 11 usa para calcular timeout — gravar em ambos os caminhos garante que mensagens do retry também são elegíveis para recovery

</specifics>

<deferred>
## Deferred Ideas

Nenhuma — discussão manteve-se dentro do escopo da fase.

</deferred>

---

*Phase: 10-message-run-dependency*
*Context gathered: 2026-03-30*

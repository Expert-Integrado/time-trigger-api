# Vars Schema — Time Trigger API

Campos que devem existir na coleção `vars` de cada banco para o Time Trigger funcionar.

## Env Vars da API

Variáveis de ambiente necessárias para iniciar o serviço:

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `MONGODB_URI` | Sim | String de conexão MongoDB (replica set) |
| `CRON_INTERVAL_RUNS` | Sim | Intervalo em ms para ciclo de runs + FUPs (ex: 30000) |
| `CRON_INTERVAL_FUP` | Sim | Intervalo em ms para ciclo independente de FUPs (ex: 15000) |
| `CRON_INTERVAL_MESSAGES` | Sim | Intervalo em ms para ciclo de mensagens pendentes (ex: 5000) |
| `TZ` | Sim | Timezone para cálculo de morningLimit/nightLimit (use `America/Sao_Paulo`) |
| `PORT` | Não | Porta HTTP (padrão: 3000) |
| `TARGET_DATABASES` | Não | Filtro de bancos (`*` ou lista separada por vírgula) |

> **Nota:** A variável `CRON_INTERVAL` (usada em versões anteriores) foi removida na v1.4. Use as 3 variáveis independentes acima.

## Campos Obrigatórios

```json
{
  "botIdentifier": "sdr4blue",

  "timeTrigger": {
    "enabled": true,
    "morningLimit": 8,
    "nightLimit": 20,
    "allowedDays": [1, 2, 3, 4, 5]
  }
}
```

## Descrição dos Campos

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `timeTrigger.enabled` | boolean | Sim | `true` = processa runs e FUPs desse cliente, `false` = ignora |
| `timeTrigger.morningLimit` | number | Sim | Hora mínima pra disparar (ex: 8 = 8h da manhã) |
| `timeTrigger.nightLimit` | number | Sim | Hora máxima pra disparar (ex: 20 = 20h) |
| `timeTrigger.allowedDays` | number[] | Sim | Dias da semana permitidos (0=Domingo, 1=Segunda ... 6=Sábado) |

## Valores dos Dias

| Número | Dia |
|--------|-----|
| 0 | Domingo |
| 1 | Segunda |
| 2 | Terça |
| 3 | Quarta |
| 4 | Quinta |
| 5 | Sexta |
| 6 | Sábado |

## Exemplos

### Comercial (seg-sex, 8h-20h)
```json
{
  "timeTrigger": {
    "enabled": true,
    "morningLimit": 8,
    "nightLimit": 20,
    "allowedDays": [1, 2, 3, 4, 5]
  }
}
```

### 24/7 (todos os dias, sem limite de horário)
```json
{
  "timeTrigger": {
    "enabled": true,
    "morningLimit": 0,
    "nightLimit": 24,
    "allowedDays": [0, 1, 2, 3, 4, 5, 6]
  }
}
```

### Desativado
```json
{
  "timeTrigger": {
    "enabled": false,
    "morningLimit": 0,
    "nightLimit": 0,
    "allowedDays": []
  }
}
```

### Seg-Sáb, 9h-18h
```json
{
  "timeTrigger": {
    "enabled": true,
    "morningLimit": 9,
    "nightLimit": 18,
    "allowedDays": [1, 2, 3, 4, 5, 6]
  }
}
```

## Comportamento da API

### Runs Dispatch
- Coleção: `runs`
- Query: `runStatus: "waiting"` AND `waitUntil <= Date.now()`
- Webhook: `"Processador de Runs"` (da coleção `webhooks`)
- Sucesso: `runStatus` → `"queued"`, `queuedAt` = timestamp atual
- Retry: 1x após 1 min, falha mantém `runStatus: "waiting"`

### FUP Dispatch
- Coleção: `fup`
- Query: `status: "on"` AND `nextInteractionTimestamp <= Date.now()`
- Webhook: `"Gerenciador follow up"` (da coleção `webhooks`)
- Sucesso: `status` → `"queued"`
- Retry: 1x após 1 min, falha mantém `status: "on"`

### Controles do timeTrigger (aplicam a runs E FUPs)
- Se `timeTrigger` não existir no vars → **ignora o banco** (não processa nada)
- Se `enabled: false` → **ignora o banco**
- Se hora atual < `morningLimit` ou >= `nightLimit` → **pula runs e FUPs**
- Se dia da semana não está no `allowedDays` → **pula runs e FUPs**
- Lê vars **a cada ciclo** (mudanças aplicam imediatamente)

## Webhooks Necessários

A coleção `webhooks` de cada banco precisa ter um documento com a seguinte estrutura:

### Campos usados pelo Time Trigger API

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `"botIdentifier"` | Sim | Identificador do bot/cliente |
| `"Processador de Runs"` | Sim* | URL para dispatch de runs |
| `"Gerenciador follow up"` | Sim* | URL para dispatch de FUPs |

\* Se ausente, o dispatch correspondente é pulado (com log de warning), mas o outro continua funcionando.

### Exemplo completo do documento webhooks

```json
{
  "botIdentifier": "sdrEdunations",
  "Ação na plataforma de origem": "https://webhook-edunations.hostexpert.com.br/webhook/ExecutaAcaoPlataforma",
  "Chat": "https://webhook-edunations.hostexpert.com.br/webhook/ChatObject",
  "Processa mensagem": "https://webhook-edunations.hostexpert.com.br/webhook/ProcessaMensagem",
  "FUP": "https://webhook-edunations.hostexpert.com.br/webhook/FollowUp",
  "Analisador de perfil": "https://webhook-edunations.hostexpert.com.br/webhook/AnalisadorPerfil",
  "Processador de Runs": "https://webhook-edunations.hostexpert.com.br/webhook/processadorDeRuns",
  "Gerenciador follow up": "https://webhook-edunations.hostexpert.com.br/webhook/GerenciadorFollowup",
  "Function Calling": "https://webhook-edunations.hostexpert.com.br/webhook/FunctionCalling",
  "Thread Analyzer": "https://webhook-edunations.hostexpert.com.br/webhook/ThreadAnalyser",
  "Agendador de lembretes": "https://webhook-edunations.hostexpert.com.br/webhook/AgendadorLembretes",
  "Mensagem programada": "https://webhook-edunations.hostexpert.com.br/webhook/MensagemProgramada",
  "getAvailableTimes": "https://webhook-edunations.hostexpert.com.br/webhook/getAvailableTimes",
  "scheduleMeeting": "https://webhook-edunations.hostexpert.com.br/webhook/scheduleMeeting",
  "rescheduleMeeting": "https://webhook-edunations.hostexpert.com.br/webhook/rescheduleMeeting",
  "evaluateLead": "https://webhook-edunations.hostexpert.com.br/webhook/evaluate_lead"
}
```

> **Nota:** O Time Trigger API só lê `"Processador de Runs"` e `"Gerenciador follow up"`. Os demais campos são usados por outros sistemas.

## Env Var: TARGET_DATABASES

Além do vars, a API aceita uma env var pra filtrar bancos:

| Valor | Comportamento |
|-------|--------------|
| `*` ou ausente | Processa todos os bancos elegíveis |
| `sdr-4blue,dev` | Processa só esses bancos (lista separada por vírgula) |

O filtro do `TARGET_DATABASES` é aplicado **antes** de ler o vars. Se o banco não está na lista, nem chega a verificar o vars.

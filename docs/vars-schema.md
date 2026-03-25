# Vars Schema — Time Trigger API

Campos que devem existir na coleção `vars` de cada banco para o Time Trigger funcionar.

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
| `timeTrigger.enabled` | boolean | Sim | `true` = processa runs desse cliente, `false` = ignora |
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

- Se `timeTrigger` não existir no vars → **ignora o banco** (não processa)
- Se `enabled: false` → **ignora o banco**
- Se hora atual < `morningLimit` ou >= `nightLimit` → **pula os runs**
- Se dia da semana não está no `allowedDays` → **pula os runs**
- Lê vars **a cada ciclo** (mudanças aplicam imediatamente)

## Env Var: TARGET_DATABASES

Além do vars, a API aceita uma env var pra filtrar bancos:

| Valor | Comportamento |
|-------|--------------|
| `*` ou ausente | Processa todos os bancos elegíveis |
| `sdr-4blue,dev` | Processa só esses bancos (lista separada por vírgula) |

O filtro do `TARGET_DATABASES` é aplicado **antes** de ler o vars. Se o banco não está na lista, nem chega a verificar o vars.

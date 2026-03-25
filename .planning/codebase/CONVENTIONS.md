# Coding Conventions

**Analysis Date:** 2026-03-25

## Naming Patterns

**Files:**
- Controllers: `[feature].controller.ts` - e.g., `app.controller.ts`
- Services: `[feature].service.ts` - e.g., `app.service.ts`
- Modules: `[feature].module.ts` - e.g., `app.module.ts`
- Specs: `[feature].spec.ts` for unit tests - e.g., `app.controller.spec.ts`
- E2E specs: `[feature].e2e-spec.ts` for integration tests

**Classes:**
- Controllers: PascalCase with `Controller` suffix - e.g., `AppController`
- Services: PascalCase with `Service` suffix - e.g., `AppService`
- Modules: PascalCase with `Module` suffix - e.g., `AppModule`

**Functions:**
- camelCase for all method names - e.g., `getHello()`, `appService.getHello()`
- Private properties use `private` access modifier with camelCase

**Variables:**
- camelCase for all variable names - e.g., `appService`, `appController`
- Constructor dependency injection uses `private readonly` for services - e.g., `constructor(private readonly appService: AppService)`

**Types:**
- Interfaces and classes use PascalCase
- Exported from separate `.ts` files using consistent naming

## Code Style

**Formatting:**
- Prettier v3.4.2 enforces formatting
- Single quotes for all strings (`singleQuote: true`)
- Trailing commas on all multi-line structures (`trailingComma: "all"`)
- Run `npm run format` to auto-format code

**Linting:**
- ESLint v9.18.0 with TypeScript support via typescript-eslint
- Config file: `eslint.config.mjs`
- Run `npm run lint` to check and fix issues
- Key disabled/relaxed rules:
  - `@typescript-eslint/no-explicit-any`: off (allows `any` type)
  - `@typescript-eslint/no-floating-promises`: warn (async calls should be awaited)
  - `@typescript-eslint/no-unsafe-argument`: warn (flexible with unsafe arguments)

## Import Organization

**Order:**
1. NestJS framework imports (`@nestjs/common`, `@nestjs/core`, etc.)
2. Local service/controller imports
3. No specific blank line separation observed in minimal codebase

**Path Aliases:**
- No path aliases configured in current tsconfig.json
- All imports use relative paths

## Error Handling

**Patterns:**
- NestJS built-in exception handling via `@nestjs/common`
- Decorators handle HTTP error responses automatically
- No explicit error try/catch blocks in the minimal scaffolding

## Logging

**Framework:** `console` (standard Node.js logging)

**Patterns:**
- No logging patterns established in current codebase
- NestJS logger available via `@nestjs/common` Logger class for future use

## Comments

**When to Comment:**
- Minimal commenting in current codebase
- Code clarity prioritized over comments

**JSDoc/TSDoc:**
- Not currently used in codebase
- No formal documentation standards enforced

## Function Design

**Size:** Functions kept minimal and focused on single responsibility

**Parameters:** Dependency injection via NestJS constructor pattern

**Return Values:**
- Controllers return typed values (e.g., `string`)
- Services return simple types

## Module Design

**Exports:**
- Classes exported as `export class ClassName`
- Modules export module class only
- Services/Controllers registered via `@Module` decorator

**Barrel Files:**
- Not used in current structure
- Direct imports from specific files

## Decorator Usage

**NestJS Decorators:**
- `@Controller()`: Applied to controller classes
- `@Injectable()`: Applied to service classes
- `@Module()`: Applied to module classes with `imports`, `controllers`, `providers` configuration
- `@Get()`: Applied to route handler methods
- Constructor parameters use `private readonly` with type annotations

## TypeScript Configuration

**Compiler Options:**
- Target: ES2023
- Module: nodenext
- Strict null checks enabled
- Decorator metadata and experimental decorators enabled
- Source maps enabled for debugging

---

*Convention analysis: 2026-03-25*

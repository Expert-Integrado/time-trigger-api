<!-- GSD:project-start source:PROJECT.md -->
## Project

**Time Trigger API**

A cron-based API that monitors multiple MongoDB databases, detects runs ready for execution (`runStatus: "waiting"` with `waitUntil` in the past), validates time-of-day constraints, and dispatches them to webhook endpoints. Each MongoDB database represents a different client/bot, and the API automatically discovers and processes all eligible databases.

**Core Value:** Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

### Constraints

- **Tech stack**: NestJS 11, MongoDB native driver, TypeScript — already initialized
- **Deployment**: Must run in Docker container
- **Configuration**: All runtime config via environment variables (`.env`)
- **Performance**: Must handle dozens of databases efficiently without blocking
- **Reliability**: No duplicate dispatches — once a run is marked `queued`, it should not be sent again
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7.3 - All source code and configuration
- JavaScript - ESLint configuration (`eslint.config.mjs`)
- JSON - Configuration files and package manifests
## Runtime
- Node.js (version constraint in `package.json` via `@types/node` ^22.10.7)
- pnpm (inferred from `pnpm-lock.yaml` and README.md instructions)
- Lockfile: `pnpm-lock.yaml` present
## Frameworks
- NestJS ^11.0.1 - Full-stack framework for building scalable server-side applications
- `@nestjs/cli` ^11.0.0 - NestJS command-line interface
- `@nestjs/schematics` ^11.0.0 - Schematic templates for NestJS scaffolding
- Jest 30.0.0 - Test runner and assertion framework
- ts-loader 9.5.2 - TypeScript loader for webpack
- ts-node 10.9.2 - TypeScript execution engine for Node.js
- tsconfig-paths 4.2.0 - Path mapping resolution for TypeScript
- source-map-support 0.5.21 - Stack trace mapping for transpiled code
## Key Dependencies
- reflect-metadata 0.2.2 - Polyfill for decorator metadata (required by NestJS decorators)
- rxjs 7.8.1 - Reactive programming library for async operations
- `@types/express` 5.0.0 - Express framework types
- `@types/jest` 30.0.0 - Jest test framework types
- `@types/node` 22.10.7 - Node.js built-in module types
- `@types/supertest` 6.0.2 - Supertest library types
## Code Quality Tools
- ESLint 9.18.0 - JavaScript/TypeScript linter
- Prettier 3.4.2 - Code formatter
- eslint-config-prettier 10.0.1 - ESLint configuration to disable conflicting rules
- Recommended configs from `@eslint/js` and `typescript-eslint`
- Prettier integration via `eslint-plugin-prettier/recommended`
- Key rules: `@typescript-eslint/no-explicit-any` off, `@typescript-eslint/no-floating-promises` warn
- Single quotes: enabled
- Trailing commas: all
## Configuration Files
- `tsconfig.json` - Main TypeScript compiler options
- `tsconfig.build.json` - Build-specific TypeScript configuration
- `nest-cli.json` - NestJS CLI configuration
- Configuration embedded in `package.json`
## Platform Requirements
- Node.js (latest LTS or 22.x recommended based on `@types/node` ^22.10.7)
- pnpm package manager
- Node.js (runtime)
- Environment variable: `PORT` (optional, defaults to 3000)
- Distribution directory: `dist/`
- Entry point: `dist/main.js`
- Production start: `node dist/main`
## Scripts
- `pnpm run start` - Run application
- `pnpm run start:dev` - Watch mode with hot reload
- `pnpm run start:debug` - Debug mode with inspector
- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run start:prod` - Run compiled application
- `pnpm run format` - Format code with Prettier
- `pnpm run lint` - Lint and fix code with ESLint
- `pnpm run test` - Run unit tests
- `pnpm run test:watch` - Watch mode for tests
- `pnpm run test:cov` - Run tests with coverage report
- `pnpm run test:debug` - Debug tests with Node inspector
- `pnpm run test:e2e` - Run end-to-end tests
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Controllers: `[feature].controller.ts` - e.g., `app.controller.ts`
- Services: `[feature].service.ts` - e.g., `app.service.ts`
- Modules: `[feature].module.ts` - e.g., `app.module.ts`
- Specs: `[feature].spec.ts` for unit tests - e.g., `app.controller.spec.ts`
- E2E specs: `[feature].e2e-spec.ts` for integration tests
- Controllers: PascalCase with `Controller` suffix - e.g., `AppController`
- Services: PascalCase with `Service` suffix - e.g., `AppService`
- Modules: PascalCase with `Module` suffix - e.g., `AppModule`
- camelCase for all method names - e.g., `getHello()`, `appService.getHello()`
- Private properties use `private` access modifier with camelCase
- camelCase for all variable names - e.g., `appService`, `appController`
- Constructor dependency injection uses `private readonly` for services - e.g., `constructor(private readonly appService: AppService)`
- Interfaces and classes use PascalCase
- Exported from separate `.ts` files using consistent naming
## Code Style
- Prettier v3.4.2 enforces formatting
- Single quotes for all strings (`singleQuote: true`)
- Trailing commas on all multi-line structures (`trailingComma: "all"`)
- Run `npm run format` to auto-format code
- ESLint v9.18.0 with TypeScript support via typescript-eslint
- Config file: `eslint.config.mjs`
- Run `npm run lint` to check and fix issues
- Key disabled/relaxed rules:
## Import Organization
- No path aliases configured in current tsconfig.json
- All imports use relative paths
## Error Handling
- NestJS built-in exception handling via `@nestjs/common`
- Decorators handle HTTP error responses automatically
- No explicit error try/catch blocks in the minimal scaffolding
## Logging
- No logging patterns established in current codebase
- NestJS logger available via `@nestjs/common` Logger class for future use
## Comments
- Minimal commenting in current codebase
- Code clarity prioritized over comments
- Not currently used in codebase
- No formal documentation standards enforced
## Function Design
- Controllers return typed values (e.g., `string`)
- Services return simple types
## Module Design
- Classes exported as `export class ClassName`
- Modules export module class only
- Services/Controllers registered via `@Module` decorator
- Not used in current structure
- Direct imports from specific files
## Decorator Usage
- `@Controller()`: Applied to controller classes
- `@Injectable()`: Applied to service classes
- `@Module()`: Applied to module classes with `imports`, `controllers`, `providers` configuration
- `@Get()`: Applied to route handler methods
- Constructor parameters use `private readonly` with type annotations
## TypeScript Configuration
- Target: ES2023
- Module: nodenext
- Strict null checks enabled
- Decorator metadata and experimental decorators enabled
- Source maps enabled for debugging
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Controller-Service-Module layered architecture
- Dependency injection via NestJS decorators (@Injectable, @Controller)
- Single application module bootstrapping pattern
- Express-based HTTP server under the hood
- Modular design supporting feature-based expansion
## Layers
- Purpose: Handle incoming HTTP requests and route to services
- Location: `src/app.controller.ts`
- Contains: Route handlers decorated with HTTP method decorators (@Get, @Post, etc.)
- Depends on: AppService (injected)
- Used by: Express framework (via NestJS platform)
- Purpose: Encapsulate business logic and domain operations
- Location: `src/app.service.ts`
- Contains: Injectable services with core functionality
- Depends on: Other services, external integrations (if any)
- Used by: Controllers for request handling
- Purpose: Define application module structure and dependency composition
- Location: `src/app.module.ts`
- Contains: @Module decorator with controllers and providers
- Depends on: Controllers and Services it imports
- Used by: NestFactory during application bootstrap
## Data Flow
- No global state management required in current architecture
- AppService is instantiated once per application (singleton by default in NestJS)
- Request-scoped state flows through controller method parameters
## Key Abstractions
- Purpose: Encapsulate related controllers and services into cohesive units
- Examples: `src/app.module.ts` (root module)
- Pattern: @Module decorator with imports, controllers, providers properties
- Purpose: Encapsulate reusable business logic
- Examples: `src/app.service.ts`
- Pattern: @Injectable() decorator marks class for dependency injection
- Purpose: Define HTTP endpoints and request routing
- Examples: `src/app.controller.ts`
- Pattern: @Controller() class with HTTP method decorators (@Get, @Post, etc.)
## Entry Points
- Location: `src/main.ts`
- Triggers: Node.js process start
- Responsibilities: Create NestJS application instance, configure port, start HTTP listener
- Location: `src/app.controller.ts` - `getHello()` method
- Triggers: GET request to `/`
- Responsibilities: Return "Hello World!" string via AppService
## Error Handling
- Unhandled exceptions caught by NestJS global exception filter
- HTTP errors return appropriate status codes
- Synchronous operations in current codebase (no async error handling needed yet)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

## Git Commit Guidelines

**MANDATORY**: All commits must follow the Conventional Commits specification with emojis.

### Commit Message Format

```
<emoji> <type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types with Emojis

| Emoji | Type | When to use |
|-------|------|-------------|
| ✨ | **feat** | A new feature |
| 🐛 | **fix** | A bug fix |
| 📝 | **docs** | Documentation only changes |
| 💄 | **style** | Code style/formatting (whitespace, semicolons, etc) |
| ♻️ | **refactor** | Code change that neither fixes a bug nor adds a feature |
| ⚡️ | **perf** | Performance improvements |
| ✅ | **test** | Adding or updating tests |
| 🔧 | **chore** | Changes to build process or auxiliary tools |
| 🏗️ | **build** | Changes that affect the build system or dependencies |
| 🤖 | **ci** | Changes to CI configuration files and scripts |
| ⏪️ | **revert** | Reverts a previous commit |
| 🔒️ | **security** | Security improvements or fixes |

### Examples

```bash
✨ feat: add endpoint to search chats by botIdentifier

🐛 fix(mongodb): resolve connection timeout in service

📝 docs: update API endpoint examples in README

♻️ refactor(database): simplify database iteration logic

⚡️ perf: optimize message query improving time by 30%

✅ test: add unit tests for authentication service

🔧 chore: configure lint-staged and husky for pre-commit

🏗️ build: adjust GitHub Actions workflow for production

🔒️ security: validate JWT tokens before processing requests
```

### Important Rules

**NEVER** include these lines in commits:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

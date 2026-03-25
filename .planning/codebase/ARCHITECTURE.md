# Architecture

**Analysis Date:** 2026-03-25

## Pattern Overview

**Overall:** NestJS MVC (Model-View-Controller) with dependency injection

**Key Characteristics:**
- Controller-Service-Module layered architecture
- Dependency injection via NestJS decorators (@Injectable, @Controller)
- Single application module bootstrapping pattern
- Express-based HTTP server under the hood
- Modular design supporting feature-based expansion

## Layers

**HTTP Layer (Controllers):**
- Purpose: Handle incoming HTTP requests and route to services
- Location: `src/app.controller.ts`
- Contains: Route handlers decorated with HTTP method decorators (@Get, @Post, etc.)
- Depends on: AppService (injected)
- Used by: Express framework (via NestJS platform)

**Business Logic Layer (Services):**
- Purpose: Encapsulate business logic and domain operations
- Location: `src/app.service.ts`
- Contains: Injectable services with core functionality
- Depends on: Other services, external integrations (if any)
- Used by: Controllers for request handling

**Module Layer:**
- Purpose: Define application module structure and dependency composition
- Location: `src/app.module.ts`
- Contains: @Module decorator with controllers and providers
- Depends on: Controllers and Services it imports
- Used by: NestFactory during application bootstrap

## Data Flow

**HTTP Request Flow:**

1. Request arrives at HTTP server (Express via NestJS platform)
2. NestJS router matches request to handler in `AppController`
3. Controller method calls injected `AppService` instance
4. Service executes business logic and returns result
5. Controller returns response to client

**Module Initialization:**

1. `main.ts` calls `NestFactory.create(AppModule)`
2. NestFactory reads AppModule metadata from `@Module()` decorator
3. Dependency injection container resolves providers (AppService)
4. Injects dependencies into controllers (AppController)
5. Express server starts listening on PORT (env var, default 3000)

**State Management:**
- No global state management required in current architecture
- AppService is instantiated once per application (singleton by default in NestJS)
- Request-scoped state flows through controller method parameters

## Key Abstractions

**Module Pattern:**
- Purpose: Encapsulate related controllers and services into cohesive units
- Examples: `src/app.module.ts` (root module)
- Pattern: @Module decorator with imports, controllers, providers properties

**Service Pattern:**
- Purpose: Encapsulate reusable business logic
- Examples: `src/app.service.ts`
- Pattern: @Injectable() decorator marks class for dependency injection

**Controller Pattern:**
- Purpose: Define HTTP endpoints and request routing
- Examples: `src/app.controller.ts`
- Pattern: @Controller() class with HTTP method decorators (@Get, @Post, etc.)

## Entry Points

**Application Bootstrap:**
- Location: `src/main.ts`
- Triggers: Node.js process start
- Responsibilities: Create NestJS application instance, configure port, start HTTP listener

**HTTP Root Endpoint:**
- Location: `src/app.controller.ts` - `getHello()` method
- Triggers: GET request to `/`
- Responsibilities: Return "Hello World!" string via AppService

## Error Handling

**Strategy:** Exception handling via NestJS built-in exception filters

**Patterns:**
- Unhandled exceptions caught by NestJS global exception filter
- HTTP errors return appropriate status codes
- Synchronous operations in current codebase (no async error handling needed yet)

## Cross-Cutting Concerns

**Logging:** Console-based logging (not implemented in current code - available via NestJS Logger)

**Validation:** Request validation (not implemented in current code - can use @nestjs/class-validator)

**Authentication:** Not currently implemented (can be added via NestJS guards and middleware)

---

*Architecture analysis: 2026-03-25*

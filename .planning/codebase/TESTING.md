# Testing Patterns

**Analysis Date:** 2026-03-25

## Test Framework

**Runner:**
- Jest v30.0.0
- Config: `package.json` (jest section) and `test/jest-e2e.json`
- Uses `ts-jest` for TypeScript transformation

**Assertion Library:**
- Jest built-in expect assertions

**Run Commands:**
```bash
npm test              # Run all unit tests
npm run test:watch   # Watch mode for unit tests
npm run test:cov     # Generate coverage report
npm run test:debug   # Debug tests with inspector
npm run test:e2e     # Run end-to-end tests only
```

## Test File Organization

**Location:**
- Unit tests co-located with source: `src/**/*.spec.ts`
- E2E tests in separate directory: `test/**/*.e2e-spec.ts`

**Naming:**
- Unit tests: `[feature].spec.ts` - e.g., `app.controller.spec.ts`
- E2E tests: `[feature].e2e-spec.ts` - e.g., `app.e2e-spec.ts`

**Structure:**
```
src/
├── app.controller.ts
├── app.controller.spec.ts
├── app.service.ts
├── app.module.ts
└── main.ts

test/
├── jest-e2e.json
└── app.e2e-spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
```

**Patterns:**
- `describe()` blocks group related tests by feature/component
- `beforeEach()` sets up fresh test module for each test
- NestJS Test utilities: `Test.createTestingModule()` builds test container
- `app.get<Type>(Type)` retrieves tested component from module

## E2E Test Structure

**Integration Testing Pattern:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
```

**Key Patterns:**
- Imports full `AppModule` for integration testing
- `supertest` library for HTTP assertions
- Chainable request methods: `.get()`, `.expect(statusCode)`, `.expect(body)`
- Returns promise from request chain for Jest async handling

## Mocking

**Framework:** NestJS Testing Module handles dependency injection for mocking

**Patterns:**
- Unit tests provide actual implementations via `Test.createTestingModule()`
- Services/dependencies injectable for replacement with mocks if needed
- No external mocking library (sinon, jest.mock) currently in use

**What to Mock:**
- External API calls
- Database operations
- External service dependencies

**What NOT to Mock:**
- NestJS framework internals
- Constructor injection (use real instances for unit tests)

## Fixtures and Factories

**Test Data:**
- Not established in current codebase
- Tests use inline test data (e.g., `'Hello World!'`)

**Location:**
- No fixtures directory
- Create in `test/fixtures/` or `src/__fixtures__/` when needed

## Coverage

**Requirements:** No specific coverage target enforced

**View Coverage:**
```bash
npm run test:cov
```

Coverage report generated to `coverage/` directory.

## Test Types

**Unit Tests:**
- Location: `src/**/*.spec.ts`
- Scope: Test individual components (controllers, services)
- Approach: Create test module with actual dependencies, assert output
- Example: `src/app.controller.spec.ts` tests `AppController.getHello()`

**Integration Tests:**
- Location: `test/**/*.e2e-spec.ts`
- Scope: Test full HTTP request/response cycle
- Approach: Start NestApplication, use supertest for HTTP requests
- Example: `test/app.e2e-spec.ts` tests GET / endpoint

**E2E Tests:**
- Framework: Jest + supertest
- Configured in: `test/jest-e2e.json`
- Run separately: `npm run test:e2e`

## Jest Configuration

**Unit Test Config (package.json):**
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "collectCoverageFrom": ["**/*.(t|j)s"],
  "coverageDirectory": "../coverage",
  "testEnvironment": "node"
}
```

**E2E Test Config (test/jest-e2e.json):**
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  }
}
```

## Async Testing

**Pattern:**
```typescript
// Return promise chain for async operations
it('/ (GET)', () => {
  return request(app.getHttpServer())
    .get('/')
    .expect(200)
    .expect('Hello World!');
});

// Or use async/await (not shown in current tests)
it('should work', async () => {
  const result = await service.someAsync();
  expect(result).toBe(expected);
});
```

## Common Test Assertions

**HTTP Status Codes:**
```typescript
.expect(200)  // Assert response status
.expect(404)
.expect(500)
```

**Response Body:**
```typescript
.expect('Hello World!')  // Assert exact response body
```

---

*Testing analysis: 2026-03-25*

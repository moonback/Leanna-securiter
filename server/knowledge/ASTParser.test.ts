import test from 'node:test';
import assert from 'node:assert/strict';
import { astParser } from './ASTParser.js';
import { astCallGraph } from './ASTCallGraph.js';

test('ASTParser: extracts functions, classes and calls accurately', async () => {
  const code = `
    export interface User {
      id: string;
      name: string;
    }

    export class UserService {
      private helper(val: number): string {
        return String(val);
      }

      async getUser(id: string, opt?: boolean): Promise<User> {
        this.helper(42);
        return { id, name: 'Alice' };
      }
    }

    export const calculate = (a: number, b: number = 0): number => {
      return a + b;
    };
  `;

  const result = await astParser.parseFile(code, 'server/services/UserService.ts', '.ts');

  assert.equal(result.language, 'typescript');
  assert.equal(result.usedFallback, false);
  assert.ok(result.functions.length >= 3, 'Should find at least 3 functions/methods');

  const helperFn = result.functions.find(f => f.name === 'helper');
  assert.ok(helperFn, 'Should find helper method');
  assert.equal(helperFn.className, 'UserService');
  assert.equal(helperFn.isMethod, true);

  const getUserFn = result.functions.find(f => f.name === 'getUser');
  assert.ok(getUserFn, 'Should find getUser method');
  assert.equal(getUserFn.isAsync, true);
  assert.equal(getUserFn.params.length, 2);
  assert.equal(getUserFn.params[0].name, 'id');
  assert.equal(getUserFn.params[1].optional, true);

  const calcFn = result.functions.find(f => f.name === 'calculate');
  assert.ok(calcFn, 'Should find calculate arrow function');
  assert.equal(calcFn.isArrow, true);
  assert.equal(calcFn.isExported, true);

  const userServiceClass = result.classes.find(c => c.name === 'UserService');
  assert.ok(userServiceClass, 'Should find UserService class');

  assert.ok(result.calls.length >= 1, 'Should find calls');
  const thisCall = result.calls.find(c => c.callee === 'helper');
  assert.ok(thisCall, 'Should find this.helper call');
  assert.equal(thisCall.calleeObject, 'this');
});

test('ASTCallGraph: builds call graph and queries callers/callees', async () => {
  const code = `
    class A {
      step1() {
        this.step2();
      }
      step2() {
        console.log("done");
      }
    }
  `;

  const result = await astParser.parseFile(code, 'src/testA.ts', '.ts');
  const allMap = new Map([['src/testA.ts', result]]);
  astCallGraph.updateFile(result, allMap);

  const callees = astCallGraph.getCallees('step1', 'src/testA.ts', 'A');
  assert.ok(callees.length >= 1, 'step1 should call at least one function');
  const step2Call = callees.find(c => c.calleeName === 'step2');
  assert.ok(step2Call, 'step1 should call step2');

  const callers = astCallGraph.getCallers('step2', 'src/testA.ts', 'A');
  assert.ok(callers.length >= 1, 'step2 should have at least one caller');
  assert.equal(callers[0].callerId, 'testA#A.step1');
});

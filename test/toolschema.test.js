import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ToolSchemaError } from '../dist/index.js';

describe('ToolSchemaError JS compatibility', () => {
  test('should be instanceof ToolSchemaError', () => {
    // Verify we don't need to explicitly Object.setPrototypeOf(this, ToolSchemaError.prototype);
    assert.ok(new ToolSchemaError(new Error(), 0) instanceof ToolSchemaError)
  })
})

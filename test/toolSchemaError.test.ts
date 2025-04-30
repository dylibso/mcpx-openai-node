import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ToolSchemaError } from '../src/openai.ts';

describe('ToolSchemaError', () => {
  describe('parse', () => {
    test('should return original error if not a tool schema error', () => {
      const originalError = new Error('Not a schema error');
      assert.strictEqual(ToolSchemaError.parse(originalError, []), originalError);
    });

    test('should return original error if error type is not invalid_request_error', () => {
      const originalError = { 
        error: { 
          type: 'other_error', 
          code: 'invalid_function_parameters',
          param: 'tools[0].function.parameters',
          message: 'Some error message' 
        }
      };
      assert.strictEqual(ToolSchemaError.parse(originalError, []), originalError);
    });

    test('should return original error if code is not invalid_function_parameters', () => {
      const originalError = { 
        error: { 
          type: 'invalid_request_error', 
          code: 'other_error',
          param: 'tools[0].function.parameters',
          message: 'Some error message' 
        }
      };
      assert.strictEqual(ToolSchemaError.parse(originalError, []), originalError);
    });

    test('should return original error if param does not match the tools pattern', () => {
      const originalError = { 
        error: { 
          type: 'invalid_request_error', 
          code: 'invalid_function_parameters',
          param: 'not_tools_pattern',
          message: 'Some error message' 
        }
      };
      assert.strictEqual(ToolSchemaError.parse(originalError, []), originalError);
    });

    test('should return a ToolSchemaError when conditions are met', () => {
      const originalError = { 
        error: {
          type: 'invalid_request_error',
          param: 'tools[2].function.parameters',
          code: 'invalid_function_parameters',
          message: 'The parameters for function tools[2].function.parameters are invalid'
        },
        message: 'Original error message'
      };

      const tools = [
        { function:{name: 'tool1'} },
        { function:{name: 'tool2'} },
        { function:{name: 'tool3'} },
      ] as any[];


      const result = ToolSchemaError.parse(originalError, tools);
      
      assert.ok(result instanceof ToolSchemaError);
      assert.strictEqual(result.originalError, originalError);
      assert.strictEqual(result.toolIndex, 2);
      assert.strictEqual(result.toolName, 'tool3');
      assert.strictEqual(result.message, "Invalid schema for tool #2: 'tool3'\nCaused by: Original error message");
    });
  });

  describe('constructor', () => {
    test('should set originalError and toolIndex properties', () => {
      const originalError = new Error('Test error');
      const toolIndex = 3;
      
      const error = new ToolSchemaError(originalError, toolIndex, 'tool4');
      
      assert.strictEqual(error.originalError, originalError);
      assert.strictEqual(error.toolIndex, toolIndex);
      assert.strictEqual(error.toolName, 'tool4');
    });

    test('should include the error message from the original error', () => {
      const originalError = new Error('Test error message');
      const toolIndex = 1;
      
      const error = new ToolSchemaError(originalError, toolIndex, 'MyTool');

      assert.ok(error.message.includes(originalError.message));
    });

    test('should properly maintain instanceof checks', () => {
      const originalError = new Error('Test error');
      const toolIndex = 0;
      
      const error = new ToolSchemaError(originalError, toolIndex, 'MyTool');
      
      assert.ok(error instanceof ToolSchemaError);
      assert.ok(error instanceof Error);
    });
  });
});
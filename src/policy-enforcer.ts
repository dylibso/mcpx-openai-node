import { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types";

interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

// A policy can inspect both the call and the result
export type PolicyFunction = (
  call: CallToolRequest,
  context: PolicyContext,
  result?: CallToolResult,
) => Promise<PolicyResult>;

// Shared context that policies can use to track state
export class PolicyContext {
  private state = new Map<string, any>();

  get(key: string): any {
    return this.state.get(key);
  }

  set(key: string, value: any): void {
    this.state.set(key, value);
  }
}

export class PolicyEnforcer {
  private beforePolicies: Map<string, PolicyFunction[]> = new Map();
  private afterPolicies: Map<string, PolicyFunction[]> = new Map();
  private context = new PolicyContext();

  // Add a policy to run before the function call
  addBeforePolicy(functionName: string, policy: PolicyFunction) {
    const policies = this.beforePolicies.get(functionName) || [];
    policies.push(policy);
    this.beforePolicies.set(functionName, policies);
  }

  // Add a policy to run after the function call
  addAfterPolicy(functionName: string, policy: PolicyFunction) {
    const policies = this.afterPolicies.get(functionName) || [];
    policies.push(policy);
    this.afterPolicies.set(functionName, policies);
  }

  async wrapCall(
    call: CallToolRequest,
    executor: (call: CallToolRequest) => Promise<CallToolResult>
  ): Promise<any> {
    // NOTE: hack to normalized name
    const normalizedName = call.params.name.replace(/^.*?_/, '')
    const beforePolicies = this.beforePolicies.get(normalizedName) || [];
    for (const policy of beforePolicies) {
      const result = await policy(call, this.context);
      if (!result.allowed) {
        throw new Error(`Policy violation: ${result.reason}`);
      }
    }

    // execute the tool call
    const result = await executor(call);

    const afterPolicies = this.afterPolicies.get(normalizedName) || [];
    for (const policy of afterPolicies) {
      const policyResult = await policy(call, this.context, result);
      if (!policyResult.allowed) {
        throw new Error(`Policy violation: ${policyResult.reason}`);
      }
    }

    return result;
  }
}

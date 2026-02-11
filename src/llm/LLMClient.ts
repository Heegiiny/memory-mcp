import OpenAI from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  Response,
  ResponseInput,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import { debugLog, startTimer, logError } from '../utils/logger.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  responseId: string;
  content: string | null;
  toolCalls?: ToolCall[];
  finishReason: string;
  tokenUsage?: TokenUsage;
}

/**
 * LLMClient
 * Wrapper around OpenAI SDK for chat completions and tool calling
 */
export class LLMClient {
  private openai: OpenAI;
  private defaultModel: string;
  private defaultAnalysisModel: string;
  private useChatCompletions: boolean; // Ollama and local models: use Chat Completions API for better tool calling

  constructor(
    apiKey: string,
    defaultModel = 'gpt-5-mini',
    analysisModel = 'gpt-5-mini',
    baseURL?: string
  ) {
    const config: { apiKey: string; baseURL?: string } = { apiKey };
    if (baseURL) config.baseURL = baseURL;
    this.openai = new OpenAI(config);
    this.defaultModel = process.env.MEMORY_MODEL || defaultModel;
    this.defaultAnalysisModel = process.env.MEMORY_ANALYSIS_MODEL || analysisModel;
    this.useChatCompletions = !!baseURL;
  }

  /**
   * Convert our ChatMessage format to Responses API input format
   */
  private toResponseInput(messages: ChatMessage[]): ResponseInput {
    const input: ResponseInput = [];

    for (const message of messages) {
      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          throw new Error('Tool messages must include tool_call_id');
        }
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: message.content ?? '',
        });
        continue;
      }

      input.push({
        role: message.role,
        content: message.content ?? '',
      } as ResponseInputItem);

      if (message.role === 'assistant' && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          input.push({
            type: 'function_call',
            id: toolCall.id,
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
        }
      }
    }

    return input;
  }

  /**
   * Convert our ToolDef format to Responses API tool format
   */
  private toResponseTools(tools: ToolDef[]): ResponseCreateParamsNonStreaming['tools'] {
    return tools.map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    }));
  }

  /**
   * Convert to Chat Completions format (for Ollama / local models)
   */
  private toChatCompletionsTools(tools: ToolDef[]) {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private toChatCompletionsMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content ?? '',
        });
        continue;
      }
      const m: Record<string, unknown> = { role: msg.role, content: msg.content ?? '' };
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        m.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      result.push(m);
    }
    return result;
  }

  /**
   * Extract content and tool calls from Responses API output
   */
  private extractResponseContent(response: Response): {
    content: string | null;
    toolCalls?: ToolCall[];
  } {
    const toolCalls: ToolCall[] = [];

    for (const item of response.output) {
      if (item.type === 'function_call') {
        toolCalls.push({
          id: item.id ?? item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      }
    }

    return {
      content: response.output_text?.length ? response.output_text : null,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  /**
   * Chat Completions API path for Ollama / local models (better tool calling support)
   */
  private async chatWithToolsViaChatCompletions(
    messages: ChatMessage[],
    tools: ToolDef[],
    options: {
      model: string;
      maxTokens?: number;
      jsonMode?: boolean;
    },
    timer: ReturnType<typeof startTimer>
  ): Promise<LLMResponse> {
    const { model } = options;
    const apiMessages = this.toChatCompletionsMessages(messages) as Parameters<
      OpenAI['chat']['completions']['create']
    >[0]['messages'];
    const apiTools = tools.length ? this.toChatCompletionsTools(tools) : undefined;

    try {
      debugLog('operation', 'LLM request (chat completions)', {
        model,
        messageCount: messages.length,
        toolCount: tools.length,
      });

      const response = await this.openai.chat.completions.create({
        model,
        messages: apiMessages,
        tools: apiTools,
        tool_choice: apiTools ? 'auto' : undefined,
        max_tokens: options.maxTokens,
        response_format: options.jsonMode ? { type: 'json_object' } : undefined,
      });

      const choice = response.choices?.[0];
      const msg = choice?.message;
      const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
      }));

      const tokenUsage: TokenUsage | undefined = response.usage
        ? {
            inputTokens: response.usage.prompt_tokens || 0,
            outputTokens: response.usage.completion_tokens || 0,
            totalTokens: response.usage.total_tokens || 0,
          }
        : undefined;

      timer.end({
        meta: {
          model,
          finishReason: choice?.finish_reason ?? 'completed',
          toolCallCount: toolCalls.length,
          hasContent: !!msg?.content,
          status: 'success',
          ...(tokenUsage && {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
          }),
        },
      });

      return {
        responseId: response.id ?? '',
        content: msg?.content ?? null,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason: choice?.finish_reason ?? 'completed',
        tokenUsage,
      };
    } catch (error) {
      timer.end({
        meta: { model, status: 'error', error: (error as Error).message },
      });
      throw new Error(`LLM request failed: ${(error as Error).message}`);
    }
  }

  /**
   * Chat completion with tool calling support using Responses API
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    options: {
      model?: string;
      maxTokens?: number;
      previousResponseId?: string;
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
      verbosity?: 'low' | 'medium' | 'high';
      jsonMode?: boolean;
    } = {}
  ): Promise<LLMResponse> {
    const model = options.model ?? this.defaultModel;
    const timer = startTimer('llm-client', 'chat-with-tools', 'info');

    if (this.useChatCompletions) {
      return this.chatWithToolsViaChatCompletions(messages, tools, { ...options, model }, timer);
    }

    const reasoningEffort =
      options.reasoningEffort ??
      (process.env.MEMORY_MODEL_REASONING_EFFORT as
        | 'none'
        | 'low'
        | 'medium'
        | 'high'
        | undefined) ??
      'none';
    const verbosity =
      options.verbosity ??
      (process.env.MEMORY_MODEL_VERBOSITY as 'low' | 'medium' | 'high' | undefined) ??
      'medium';

    const requestBody: ResponseCreateParamsNonStreaming = {
      model,
      tools: tools.length ? this.toResponseTools(tools) : undefined,
      reasoning: { effort: reasoningEffort },
      text: {
        verbosity: verbosity,
        ...(options.jsonMode && { format: { type: 'json_object' } }),
      },
      ...(options.maxTokens && { max_output_tokens: options.maxTokens }),
      input: this.toResponseInput(messages),
      ...(options.previousResponseId && { previous_response_id: options.previousResponseId }),
    };

    try {
      debugLog('operation', 'LLM request', {
        model,
        messageCount: messages.length,
        toolCount: tools.length,
      });

      const response = await this.openai.responses.create(requestBody);
      const parsed = this.extractResponseContent(response);

      const tokenUsage: TokenUsage | undefined = response.usage
        ? {
            inputTokens: response.usage.input_tokens || 0,
            outputTokens: response.usage.output_tokens || 0,
            totalTokens: response.usage.total_tokens || 0,
          }
        : undefined;

      timer.end({
        meta: {
          model,
          finishReason: response.incomplete_details?.reason ?? response.status ?? 'completed',
          toolCallCount: parsed.toolCalls?.length || 0,
          hasContent: !!parsed.content,
          status: 'success',
          ...(tokenUsage && {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
          }),
        },
      });

      debugLog('operation', 'LLM response', {
        finishReason: response.incomplete_details?.reason ?? response.status ?? 'completed',
        toolCallCount: parsed.toolCalls?.length || 0,
        hasContent: !!parsed.content,
      });

      return {
        responseId: response.id,
        content: parsed.content,
        toolCalls: parsed.toolCalls,
        finishReason: response.incomplete_details?.reason ?? response.status ?? 'completed',
        tokenUsage,
      };
    } catch (error) {
      timer.end({
        meta: {
          model,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      });

      const err = error as Error;
      logError('llm-client', 'chat-with-tools:error', {
        message: 'LLM API request failed',
        error: err,
        meta: { model },
      });

      throw new Error(`LLM request failed: ${err.message}`);
    }
  }

  /**
   * Simple chat without tool calling (useful for analysis tasks)
   */
  async simpleChat(
    systemPrompt: string,
    userContent: string,
    options: {
      model?: string;
      maxTokens?: number;
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
      verbosity?: 'low' | 'medium' | 'high';
    } = {}
  ): Promise<string> {
    const model = options.model ?? this.defaultAnalysisModel;
    const timer = startTimer('llm-client', 'simple-chat', 'info');

    if (this.useChatCompletions) {
      try {
        const response = await this.openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: options.maxTokens,
        });
        const content = response.choices?.[0]?.message?.content ?? '';
        timer.end({ meta: { model, status: 'success' } });
        return content;
      } catch (error) {
        timer.end({ meta: { model, status: 'error', error: (error as Error).message } });
        throw new Error(`LLM request failed: ${(error as Error).message}`);
      }
    }

    const reasoningEffort = options.reasoningEffort ?? 'none';
    const verbosity = options.verbosity ?? 'low';

    const requestBody: ResponseCreateParamsNonStreaming = {
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      reasoning: { effort: reasoningEffort },
      text: { verbosity: verbosity },
      ...(options.maxTokens && { max_output_tokens: options.maxTokens }),
    };

    try {
      debugLog('operation', 'LLM request (simple chat)', {
        model,
        messageCount: 2,
        toolCount: 0,
      });

      const response = await this.openai.responses.create(requestBody);

      // Extract token usage if available
      const tokenUsage: TokenUsage | undefined = response.usage
        ? {
            inputTokens: response.usage.input_tokens || 0,
            outputTokens: response.usage.output_tokens || 0,
            totalTokens: response.usage.total_tokens || 0,
          }
        : undefined;

      timer.end({
        meta: {
          model,
          finishReason: response.incomplete_details?.reason ?? response.status ?? 'completed',
          hasContent: !!response.output_text,
          status: 'success',
          ...(tokenUsage && {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
          }),
        },
      });

      debugLog('operation', 'LLM response (simple chat)', {
        finishReason: response.incomplete_details?.reason ?? response.status ?? 'completed',
        hasContent: !!response.output_text,
      });

      return response.output_text || '';
    } catch (error) {
      timer.end({
        meta: {
          model,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        },
      });

      const err = error as Error;
      logError('llm-client', 'simple-chat:error', {
        message: 'LLM API request failed',
        error: err,
        meta: { model },
      });

      throw new Error(`LLM request failed: ${err.message}`);
    }
  }

  /**
   * Get the default model for agent operations
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Get the default model for analysis operations
   */
  getAnalysisModel(): string {
    return this.defaultAnalysisModel;
  }

  /**
   * Expand a query into semantic variations for improved recall accuracy.
   * Uses a fast model (gpt-5-mini) to generate alternative phrasings of the same query.
   *
   * @param query - The original user query to expand
   * @param count - Number of variations to generate (default: 2)
   * @returns Promise resolving to array of query variations (does not include original query)
   *
   * @example
   * ```typescript
   * const variations = await llmClient.expandQuery("What are the email rules?", 2);
   * // Returns: ["email style guide formatting", "email communication preferences"]
   * ```
   */
  async expandQuery(query: string, count: number = 2): Promise<string[]> {
    const systemPrompt = `You are a query expansion assistant. Given a user query, generate ${count} alternative phrasings that capture the same semantic intent using different keywords.

Focus on:
- Synonyms and related terms
- Different ways to express the same concept
- Domain-specific terminology variations
- More specific or more general phrasings

Return ONLY a JSON array of strings with ${count} variations. Do not include explanations or the original query.

Example:
User: "What are the email rules?"
Assistant: ["email style guide formatting preferences", "email communication template structure"]`;

    try {
      let content: string;
      if (this.useChatCompletions) {
        const response = await this.openai.chat.completions.create({
          model: this.defaultAnalysisModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          response_format: { type: 'json_object' },
        });
        content = response.choices?.[0]?.message?.content ?? '{"variations": []}';
      } else {
        const response = await this.openai.responses.create({
          model: this.defaultAnalysisModel,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          reasoning: { effort: 'none' },
          text: { verbosity: 'low', format: { type: 'json_object' } },
        });
        content = response.output_text || '{"variations": []}';
      }
      const parsed = JSON.parse(content);

      // Handle both array and object responses
      let variations: string[];
      if (Array.isArray(parsed)) {
        variations = parsed;
      } else if (parsed.variations && Array.isArray(parsed.variations)) {
        variations = parsed.variations;
      } else {
        console.error('Query expansion returned unexpected format:', content);
        return [];
      }

      // Validate and filter variations
      const validVariations = variations
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
        .slice(0, count);

      return validVariations;
    } catch (error) {
      console.error('Query expansion failed:', error);
      // Return empty array on failure - caller will fall back to original query only
      return [];
    }
  }
}

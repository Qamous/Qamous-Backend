import { Injectable } from '@nestjs/common';
import { ChatGroq } from '@langchain/groq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiModel } from '../../dtos/rag.dto';
import { BaseMessage } from '@langchain/core/messages';

interface GenerateParams {
  prompt: string;
  model: AiModel;
  language: 'arabic' | 'franco-arabic';
}

@Injectable()
export class ModelService {
  private groq: ChatGroq;
  private gemini: GoogleGenerativeAI;
  private readonly languagePrompts = {
    'arabic': 'Respond in Arabic (العربية). Use only Arabic script.',
    'franco-arabic': 'Respond with both English and Franco-Arabic transliterations. For each Arabic word, provide its Franco-Arabic (3arabizi) version in parentheses. For example: "Hello (mar7aba)".',
  };

  constructor() {
    this.initializeModels();
  }

  private initializeModels() {
    this.groq = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: 'mixtral-8x7b-32768',
    });

    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  async generateResponse(params: GenerateParams): Promise<{ response: string; sources: string[] }> {
    const { prompt, model, language } = params;
    const langPrompt: string = this.languagePrompts[language];
    const fullPrompt: string = `${langPrompt}\n\n${prompt}`;

    try {
      switch (model) {
        case 'groq':
          return this.generateGroqResponse(fullPrompt);
        case 'gemini':
          return this.generateGeminiResponse(fullPrompt);
        case 'groq-3':
        case 'gemini-pro':
        case 'gpt4':
        case 'mistral':
          throw new Error(`Model ${model} not implemented yet`);
        default:
          throw new Error(`Unsupported model: ${model}`);
      }
    } catch (error) {
      console.error(`Error generating response with ${model}:`, error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  // In model.service.ts
  private async generateGroqResponse(prompt: string): Promise<{ response: string; sources: string[] }> {
    const systemPrompt = {
      role: 'system',
      content: 'You are a helpful assistant that provides accurate information about Arabic words and expressions. Only use and reference words that are explicitly provided in the context. Do not make up or include citations for words not in the provided dictionary terms.'
    };

    const response = await this.groq.invoke([
      systemPrompt,
      {
        role: 'user',
        content: prompt,
      },
    ]);

    return {
      response: this.extractTextFromMessage(response),
      sources: [] // Empty array since sources are handled by RagService
    };
  }

  private async generateGeminiResponse(prompt: string): Promise<{ response: string; sources: string[] }> {
    const model = this.gemini.getGenerativeModel({ model: 'gemini-pro' });
    const systemPrompt = 'Only use and reference words that are explicitly provided in the context. Do not make up or include citations for words not in the provided dictionary terms.\n\n';

    const result = await model.generateContent(systemPrompt + prompt);
    return {
      response: result.response.text(),
      sources: [] // Empty array since sources are handled by RagService
    };
  }

  private extractSources(content: string): string[] {
    // Update regex to capture markdown links
    const sourceRegex = /\[.*?\]\((www\.qamous\.org\/word\/\d+)\)/g;
    const matches = content.matchAll(sourceRegex);
    return [...new Set(Array.from(matches, m => m[1]))];
  }

  private extractTextFromMessage(message: BaseMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .map(content => {
          if (typeof content === 'string') {
            return content;
          }
          if ('text' in content) {
            return content.text;
          }
          return '';
        })
        .join(' ');
    }

    return '';
  }
}
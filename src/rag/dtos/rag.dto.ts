export type AiModel = 'groq' | 'gemini' | 'groq-3'| 'gemini-pro' | 'gpt4' | 'mistral';

export class RagRequest {
  query: string;
  model: AiModel;
  preferredLanguage?: 'arabic' | 'franco-arabic';
}

export class RagResponse {
  response: string;
  sources: string[];
  definitions?: {
    word: string;
    meaning: string;
    example?: string;
  }[];
}


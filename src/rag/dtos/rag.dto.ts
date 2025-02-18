export type AiModel = 'groq' | 'gemini' | 'gpt4' | 'mistral';

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


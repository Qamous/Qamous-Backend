import { Injectable } from '@nestjs/common';
import { InjectRepository } from "@nestjs/typeorm";
import { Word } from "../../../typeorm/entities/word";
import { Repository } from "typeorm";
import { Definition } from "../../../typeorm/entities/definition";
import { In } from 'typeorm';
import { RagRequest, RagResponse } from "../../dtos/rag.dto";
import { VectorStoreService } from "../vector-store/vector-store.service";
import { ModelService } from "../model/model.service";

interface CitedWord {
  id: number;
  arabicWord: string;
  definition: string;
  example?: string;
}

@Injectable()
export class RagService {
  constructor(
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(Definition)
    private definitionRepository: Repository<Definition>,
    private modelService: ModelService,
    private vectorStore: VectorStoreService,
  ) {}

  async processQuery(request: RagRequest): Promise<RagResponse> {
    // 1. Extract words from the query
    const words = this.extractWords(request.query);

    // 2. Look up known words and their definitions
    const knownWords = await this.findKnownWords(words);

    // 3. Create a map of known words for easy lookup
    const wordMap = new Map(knownWords.map(word => [word.arabicWord, word]));

    // 4. Retrieve the context vector for the query
    const vectorContext = await this.vectorStore.retrieveContext(request.query);

    // 5. Build an augmented context for the model
    const augmentedContext = this.buildAugmentedContext(
      request.query,
      knownWords,
      vectorContext
    );

    const { response } = await this.modelService.generateResponse({
      prompt: augmentedContext,
      model: request.model,
      language: request.preferredLanguage || 'arabic'
    });

    // Extract actually used words from the response and create citations
    const citedWords = this.extractUsedWords(response, wordMap);

    return {
      response: this.formatMarkdownResponse(response, citedWords),
      sources: citedWords.map(word => `www.qamous.org/word/${word.id}`),
      definitions: citedWords.map(word => ({
        word: word.arabicWord,
        meaning: word.definition,
        example: word.example
      }))
    };
  }

  private extractUsedWords(response: string, wordMap: Map<string, Word>): CitedWord[] {
    const citedWords: CitedWord[] = [];
    const usedWords = new Set<string>();

    // Get all Arabic words from the response
    const arabicWordRegex = /[\u0600-\u06FF]+/g;
    const words = response.match(arabicWordRegex) || [];

    words.forEach(word => {
      if (!usedWords.has(word) && wordMap.has(word)) {
        const dbWord = wordMap.get(word);
        usedWords.add(word);
        citedWords.push({
          id: dbWord.id,
          arabicWord: dbWord.arabicWord,
          definition: dbWord.definitions[0]?.definition || '',
          example: dbWord.definitions[0]?.example
        });
      }
    });

    return citedWords;
  }

  private formatMarkdownResponse(response: string, citedWords: CitedWord[]): string {
    let formattedResponse = response;

    // Replace words with their linked versions
    citedWords.forEach(word => {
      const wordRegex = new RegExp(`(?<![\\u0600-\\u06FF])${word.arabicWord}(?![\\u0600-\\u06FF])`, 'g');
    });

    // Add references section if there are cited words
    if (citedWords.length > 0) {
      formattedResponse += '\n\n### المراجع والتعريفات\n';
      citedWords.forEach(word => {
        formattedResponse += `- **[${word.arabicWord}](www.qamous.org/word/${word.id})**: ${word.definition}\n`;
        if (word.example) {
          formattedResponse += `  مثال: ${word.example}\n`;
        }
      });
    }

    return formattedResponse;
  }

  private buildAugmentedContext(
    query: string,
    knownWords: Word[],
    vectorContext: string
  ): string {
    const definitions = knownWords
      .map(word => `- ${word.arabicWord}: ${word.definitions[0]?.definition || 'No definition available'}`)
      .join('\n');

    return `
Query: ${query}

Available Dictionary Terms:
${definitions}

Related Context:
${vectorContext}

Instructions:
1. Provide a response in markdown format
2. Only use words from our dictionary when they are relevant
3. Do not make up or include citations for words not in our dictionary
4. Use Arabic language
5. Focus on accuracy and cultural relevance
`;
  }

  private extractWords(text: string): string[] {
    // Handle both Arabic and Latin characters
    return text.match(/[\u0600-\u06FF\w]+/g) || [];
  }

  private async findKnownWords(words: string[]): Promise<Word[]> {
    return this.wordRepository.find({
      where: [
        { arabicWord: In(words) },
        { francoArabicWord: In(words) }
      ],
      relations: ['definitions'],
      take: 10 // Limit results for performance
    });
  }
}

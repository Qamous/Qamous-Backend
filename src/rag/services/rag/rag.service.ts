import { Injectable } from '@nestjs/common';
import { InjectRepository } from "@nestjs/typeorm";
import { Word } from "../../../typeorm/entities/word";
import { Like, Repository } from "typeorm";
import { Definition } from "../../../typeorm/entities/definition";
import { In } from 'typeorm';
import { RagRequest, RagResponse } from "../../dtos/rag.dto";
import { VectorStoreService } from "../vector-store/vector-store.service";
import { ModelService } from "../model/model.service";

interface CitedWord {
  id: number;
  arabicWord: string;
  francoArabicWord?: string;
  arabicDefinition?: string;
  englishDefinition?: string;
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
    const words: string[] = this.extractWords(request.query);

    // 2. Look up known words and their definitions
    const knownWords: Word[] = await this.findKnownWords(words);
    console.log("knownWords: ", knownWords);

    // 3. Create a map of known words for easy lookup
    const wordMap: Map<string, Word> = new Map(knownWords.map(word => [word.arabicWord, word]));
    console.log("wordMap: ", wordMap);

    // 4. Retrieve the context vector for the query
    const vectorContext: string = await this.vectorStore.retrieveContext(request.query);
    console.log("vectorContext: ", vectorContext);

    // 5. Build an augmented context for the model
    const augmentedContext: string = this.buildAugmentedContext(
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
    const citedWords: CitedWord[] = this.extractUsedWords(response, wordMap);

    return {
      response: this.formatMarkdownResponse(response, citedWords, request.preferredLanguage || 'arabic'),
      sources: citedWords.map(word => `www.qamous.org/word/${word.id}`),
      definitions: citedWords.map(word => ({
        word: word.arabicWord,
        // Give preference to the requested language, but fallback to the other language if not available
        meaning: request.preferredLanguage === 'arabic' ? (word.arabicDefinition || word.englishDefinition) : (word.englishDefinition || word.arabicDefinition),
        example: word.example
      }))
    };
  }

  private extractUsedWords(response: string, wordMap: Map<string, Word>): CitedWord[] {
    const citedWords: CitedWord[] = [];
    const usedWords = new Set<string>();

    // Get all Arabic words from the response
    const arabicWordRegex: RegExp = /[\u0600-\u06FF]+/g;
    const words: RegExpMatchArray | [] = response.match(arabicWordRegex) || [];


    words.forEach(word => {
      if (!usedWords.has(word) && wordMap.has(word)) {
        const dbWord: Word = wordMap.get(word);
        const englishDef: Definition = dbWord.definitions.find(d => !d.isArabic);
        const arabicDef: Definition = dbWord.definitions.find(d => d.isArabic);
        usedWords.add(word);
        citedWords.push({
          id: dbWord.id,
          arabicWord: dbWord.arabicWord,
          francoArabicWord: dbWord.francoArabicWord || undefined,
          arabicDefinition: arabicDef?.definition || undefined,
          englishDefinition: englishDef?.definition || undefined,
          example: dbWord.definitions[0]?.example
        });
      }
    });

    return citedWords;
  }

  private formatMarkdownResponse(response: string, citedWords: CitedWord[], preferredLanguage: 'arabic' | 'franco-arabic'): string {
    let formattedResponse: string = response;
    if (citedWords.length > 0) {
      if (preferredLanguage === 'arabic') {
        formattedResponse += '\n\n### المراجع والتعريفات\n';
        citedWords.forEach(word => {
          formattedResponse += `- **[${word.arabicWord}](/word/${word.id})**: ${word.arabicDefinition || word.englishDefinition} ${!word.arabicDefinition ? '(التعريف العربي غير متوفر على قاموس، لا تتردد في إضافته!)' : ''}\n`;
          // Current examples are in English, so we don't include them TODO: Add Arabic examples
          // if (word.example) {
          //   formattedResponse += `  مثال: ${word.example}\n`;
          // }
        });
      } else { // franco-arabic
        formattedResponse += '\n\n### References and Definitions\n';
        citedWords.forEach(word => {
          // Include both Arabic and Franco-Arabic versions
          formattedResponse += `- **[${word.arabicWord}](/word/${word.id})** (${word.francoArabicWord}): ${word.englishDefinition || word.arabicDefinition} ${!word.englishDefinition ? '(English definition not available on Qamous, feel free to add it!)' : ''}\n`;
          if (word.example) {
            formattedResponse += `  Example: ${word.example}\n`;
          }
        });
        console.log(formattedResponse);
      }
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
2. Use words from our dictionary when they are relevant
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
    // Create LIKE patterns for each word
    const likePatterns = words.map(word => `%${word}%`);

    return this.wordRepository.find({
      where: [
        { arabicWord: In(words) },         // Exact matches
        { francoArabicWord: In(words) },   // Exact matches
        ...likePatterns.map(pattern => ({  // Partial matches
          arabicWord: Like(pattern)
        })),
        ...likePatterns.map(pattern => ({  // Partial matches
          francoArabicWord: Like(pattern)
        }))
      ],
      relations: ['definitions'],
      take: 10 // Limit results for performance
    });
  }
}

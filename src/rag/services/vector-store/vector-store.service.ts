import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Document } from '@langchain/core/documents';
import { Word } from '../../../typeorm/entities/word';
import { Definition } from '../../../typeorm/entities/definition';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private vectorStore: MemoryVectorStore;
  private embeddings: GoogleGenerativeAIEmbeddings;

  constructor(
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(Definition)
    private definitionRepository: Repository<Definition>,
  ) {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: 'embedding-001',
    });
  }

  async onModuleInit() {
    await this.initializeVectorStore();
  }

  private async initializeVectorStore() {
    // Fetch all words and definitions
    const words = await this.wordRepository.find({
      relations: ['definitions'],
    });

    // Create documents from words and definitions
    const documents = words.flatMap(word => {
      const docs: Document[] = [];

      // Add word document
      docs.push(new Document({
        pageContent: `Word: ${word.arabicWord} (${word.francoArabicWord})`,
        metadata: {
          type: 'word',
          id: word.id,
          wordId: word.id,
          arabicWord: word.arabicWord,
          source: `www.qamous.org/word/${word.id}`
        }
      }));

      // Add definition documents
      word.definitions?.forEach(def => {
        docs.push(new Document({
          pageContent: `${word.arabicWord}: ${def.definition}${def.example ? `\nExample: ${def.example}` : ''}`,
          metadata: {
            type: 'definition',
            id: def.id,
            wordId: word.id,
            source: `www.qamous.org/word/${word.id}`  // Update the source format
          }
        }));
      });

      return docs;
    });

    // Initialize vector store
    this.vectorStore = await MemoryVectorStore.fromDocuments(
      documents,
      this.embeddings
    );
  }

  async retrieveContext(query: string): Promise<string> {
    try {
      const results = await this.vectorStore.similaritySearch(query, 3);
      return results
        .map(doc => {
          const source = doc.metadata.source;
          const arabicWord = doc.metadata.arabicWord;
          return `[${arabicWord}](${source}) ${doc.pageContent}`;
        })
        .join('\n\n');
    } catch (error) {
      console.error('Error retrieving context:', error);
      return '';
    }
  }

  async addDocument(content: string, metadata: Record<string, any>) {
    const doc = new Document({ pageContent: content, metadata });
    await this.vectorStore.addDocuments([doc]);
  }

  async refreshStore() {
    await this.initializeVectorStore();
  }
}


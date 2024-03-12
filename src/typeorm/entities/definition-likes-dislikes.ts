import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class DefinitionLikesDislikes {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  definitionID: string;

  @Column()
  userID: string;

  @Column()
  liked: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

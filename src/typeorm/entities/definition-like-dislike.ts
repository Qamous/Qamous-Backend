import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'definition-likes-dislikes' })
export class DefinitionLikeDislike {
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

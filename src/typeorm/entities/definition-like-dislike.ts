import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'definition-likes-dislikes' })
export class DefinitionLikeDislike {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  definitionID: number;

  @Column()
  userID: number;

  @Column()
  liked: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Definition } from './definition';
import { User } from './user';

@Entity({ name: 'definition-likes-dislikes' })
export class DefinitionLikeDislike {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Definition)
  @JoinColumn({ name: 'definitionId' })
  definition: Definition;

  @ManyToOne(() => User, (user) => user.definitions)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: false })
  definitionId: number;

  @Column({ nullable: false })
  userId: number;

  @Column()
  liked: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

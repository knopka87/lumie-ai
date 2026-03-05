// migration file: src/db/migrations-enhanced.ts

import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class EnhancedDatabaseSchema20260305103150 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(new Table({
            name: 'user_profile',
            columns: [
                { name: 'id', type: 'int', isPrimary: true, isGenerated: true },
                { name: 'user_id', type: 'int' },
                { name: 'profile_data', type: 'json' },
                { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
                { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
            ]
        }));

        await queryRunner.createTable(new Table({
            name: 'conversation_sessions',
            columns: [
                { name: 'id', type: 'int', isPrimary: true, isGenerated: true },
                { name: 'user_profile_id', type: 'int' },
                { name: 'session_data', type: 'json' },
                { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
                { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
            ]
        }));

        await queryRunner.createTable(new Table({
            name: 'message_embeddings',
            columns: [
                { name: 'id', type: 'int', isPrimary: true, isGenerated: true },
                { name: 'conversation_session_id', type: 'int' },
                { name: 'embedding_data', type: 'json' },
                { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
                { name: 'updated_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
            ]
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('message_embeddings');
        await queryRunner.dropTable('conversation_sessions');
        await queryRunner.dropTable('user_profile');
    }
}